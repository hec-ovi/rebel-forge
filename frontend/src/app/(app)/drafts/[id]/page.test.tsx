import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/server";
import DraftDetailPage from "./page";

const navigation = vi.hoisted(() => ({ push: vi.fn(), id: "draft-1" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: navigation.id }),
  useRouter: () => ({ push: navigation.push }),
}));

const draft = {
  id: "draft-1",
  platform: "linkedin",
  status: "draft",
  concept: "Engineering notes",
  caption: "Original post",
  hook: "A hook",
  cta: "Read more",
  hashtags: ["engineering"],
  alt_text: "",
  media_prompt: null,
  script: null,
  image_url: null,
  published_url: null,
  published_at: null,
  platform_post_id: null,
  created_at: "2026-07-18T12:00:00Z",
  updated_at: "2026-07-18T12:00:00Z",
};

describe("DraftDetailPage", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    localStorage.setItem("rf_role", "owner");
  });

  it("saves edited content through the API and returns to a clean draft state", async () => {
    let updateBody: unknown;
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts/draft-1", () => HttpResponse.json(draft)),
      http.put("http://127.0.0.1:8080/v1/drafts/draft-1", async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json({ ...draft, caption: "Updated post" });
      }),
    );
    const user = userEvent.setup();
    render(<DraftDetailPage />);

    const content = await screen.findByRole("textbox", { name: "Post content" });
    await user.clear(content);
    await user.type(content, "Updated post");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /save as draft/i }));

    await waitFor(() => expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument());
    expect(updateBody).toEqual({ caption: "Updated post" });
    expect(content).toHaveValue("Updated post");
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeEnabled();
  });

  it("approves a clean draft and renders its new status", async () => {
    let approveCalled = false;
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts/draft-1", () => HttpResponse.json(draft)),
      http.post("http://127.0.0.1:8080/v1/drafts/draft-1/approve", () => {
        approveCalled = true;
        return HttpResponse.json({ ...draft, status: "approved" });
      }),
    );
    const user = userEvent.setup();
    render(<DraftDetailPage />);

    await user.click(await screen.findByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(approveCalled).toBe(true));
    expect(await screen.findByRole("button", { name: /publish to linkedin/i })).toBeVisible();
  });

  it("blocks approval when X content exceeds its character limit", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts/draft-1", () =>
        HttpResponse.json({ ...draft, platform: "x", caption: "x".repeat(281), hashtags: [] }),
      ),
    );
    render(<DraftDetailPage />);

    expect(await screen.findByText("281/280")).toBeVisible();
    expect(screen.getByText(/exceeds x limit/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeDisabled();
  });

  it("shows backend validation errors without losing the draft", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts/draft-1", () => HttpResponse.json(draft)),
      http.post("http://127.0.0.1:8080/v1/drafts/draft-1/approve", () =>
        HttpResponse.json({ detail: "Draft is no longer editable" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    render(<DraftDetailPage />);

    await user.click(await screen.findByRole("button", { name: /^approve$/i }));
    expect(await screen.findByText("Draft is no longer editable")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Post content" })).toHaveValue("Original post");
  });

  it("renders draft content without mutation controls for viewers", async () => {
    localStorage.setItem("rf_role", "viewer");
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts/draft-1", () => HttpResponse.json(draft)),
    );
    render(<DraftDetailPage />);

    expect(await screen.findByText("Original post")).toBeVisible();
    expect(screen.getByText("Viewer access is read-only.")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Post content" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
  });
});
