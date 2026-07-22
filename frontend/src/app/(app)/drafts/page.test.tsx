import { http, HttpResponse } from "msw";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { server } from "@/test/server";
import type { Draft } from "@/lib/types";
import DraftsPage from "./page";

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.search,
}));

const drafts: Draft[] = [
  {
    id: "draft-1",
    workspace_id: "workspace-1",
    platform: "instagram",
    status: "draft",
    concept: "Launch story",
    caption: "A behind-the-scenes launch update",
    hook: "Come behind the scenes",
    cta: "Follow along",
    hashtags: ["launch"],
    alt_text: "Launch workspace",
    media_prompt: "A workshop",
    created_at: "2026-07-17T12:00:00Z",
  },
  {
    id: "draft-2",
    workspace_id: "workspace-1",
    platform: "linkedin",
    status: "approved",
    concept: "Engineering notes",
    caption: "What we learned while shipping",
    hook: "Three lessons",
    cta: "Read more",
    hashtags: ["engineering"],
    alt_text: "Engineering notebook",
    media_prompt: "A notebook",
    created_at: "2026-07-18T12:00:00Z",
  },
];

describe("DraftsPage", () => {
  beforeEach(() => {
    navigation.search = new URLSearchParams();
    localStorage.setItem("rf_role", "owner");
  });

  it("loads drafts over HTTP and filters them through accessible controls", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);

    expect(await screen.findByText("Launch story")).toBeVisible();
    expect(screen.getByText("Engineering notes")).toBeVisible();

    await user.type(screen.getByRole("searchbox", { name: "Search drafts" }), "engineering");
    expect(screen.queryByText("Launch story")).not.toBeInTheDocument();
    expect(screen.getByText("Engineering notes")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear draft search" }));
    expect(screen.getByText("Launch story")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /filters/i }));
    expect(screen.queryByRole("button", { name: "TikTok" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "YouTube" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approved" }));
    expect(screen.queryByText("Launch story")).not.toBeInTheDocument();
    expect(screen.getByText("Engineering notes")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Reset all filters" }));
    expect(screen.getByText("Launch story")).toBeVisible();
    expect(screen.getByText(/2 of 2 drafts/)).toBeVisible();
  });

  it("deletes a draft only after confirmation and updates the rendered list", async () => {
    let deletedId = "";
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.delete("http://127.0.0.1:8080/v1/drafts/:id", ({ params }) => {
        deletedId = String(params.id);
        return HttpResponse.json({ status: "deleted", id: params.id });
      }),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);
    await screen.findByText("Launch story");

    const deleteButtons = screen.getAllByRole("button", { name: "Delete draft" });
    await user.click(deleteButtons[0]);
    expect(screen.getByText("Delete this draft?")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByText("Launch story")).not.toBeInTheDocument());
    expect(deletedId).toBe("draft-1");
    expect(screen.getByText(/1 of 1 draft/)).toBeVisible();
  });

  it("keeps a failed deletion visible and reports the API error", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.delete("http://127.0.0.1:8080/v1/drafts/draft-1", () =>
        HttpResponse.json({ detail: "Draft is locked by a publishing job" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);

    await screen.findByText("Launch story");
    await user.click(screen.getAllByRole("button", { name: "Delete draft" })[0]);
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Draft is locked by a publishing job");
    expect(screen.getByText("Launch story")).toBeVisible();
    expect(screen.getByText("Delete this draft?")).toBeVisible();
  });

  it("creates an all-pending review link and copies its public frontend URL", async () => {
    let shareBody: unknown;
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.post("http://127.0.0.1:8080/v1/share", async ({ request }) => {
        shareBody = await request.json();
        return HttpResponse.json({ share_id: "share-123", url: "/v1/share/share-123", expires_at: "2030-01-01T00:00:00Z", draft_count: 1 });
      }),
    );
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<DraftsPage />);

    await user.click(await screen.findByRole("button", { name: "Share pending" }));
    const link = await screen.findByRole("textbox", { name: "Share review link" });
    expect(link).toHaveValue(`${window.location.origin}/share/share-123`);
    expect(link).not.toHaveValue(expect.stringContaining("/v1/share/"));
    expect(shareBody).toEqual({ expires_hours: 72 });

    await user.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/share-123`));
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  });

  it("surfaces review-link creation and clipboard failures", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.post("http://127.0.0.1:8080/v1/share", () =>
        HttpResponse.json({ detail: "No pending drafts are available" }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    const view = render(<DraftsPage />);

    await user.click(await screen.findByRole("button", { name: "Share pending" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pending drafts are available");
    expect(screen.queryByRole("textbox", { name: "Share review link" })).not.toBeInTheDocument();

    view.unmount();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) },
    });
    server.use(
      http.post("http://127.0.0.1:8080/v1/share", () =>
        HttpResponse.json({ share_id: "share-456", url: "/share/share-456", expires_at: "2030-01-01T00:00:00Z", draft_count: 1 }),
      ),
    );
    render(<DraftsPage />);
    await user.click(await screen.findByRole("button", { name: "Share pending" }));
    await user.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Select and copy it manually");
  });

  it("refreshes after a completed generation job", async () => {
    let draftRequests = 0;
    let generationBody: unknown;
    const generated = { ...drafts[0], id: "draft-3", concept: "Generated follow-up" };
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => {
        draftRequests += 1;
        return HttpResponse.json(draftRequests === 1 ? drafts : [...drafts, generated]);
      }),
      http.post("http://127.0.0.1:8080/v1/drafts/generate", async ({ request }) => {
        generationBody = await request.json();
        return HttpResponse.json({ id: "job-1" });
      }),
      http.get("http://127.0.0.1:8080/v1/jobs/job-1", () => HttpResponse.json({ status: "completed", error_message: null })),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);

    await user.click(await screen.findByRole("button", { name: "Generate" }));
    const dialog = screen.getByRole("dialog", { name: "Generate drafts" });
    expect(screen.getByRole("combobox", { name: "Platform" })).toHaveValue("instagram");
    expect(screen.getByRole("spinbutton", { name: "Draft count" })).toHaveValue(2);
    expect(screen.getByRole("textbox", { name: "Objective" })).toHaveValue("increase engagement");
    await user.selectOptions(screen.getByRole("combobox", { name: "Platform" }), "linkedin");
    await user.clear(screen.getByRole("spinbutton", { name: "Draft count" }));
    await user.type(screen.getByRole("spinbutton", { name: "Draft count" }), "3");
    await user.clear(screen.getByRole("textbox", { name: "Objective" }));
    await user.type(screen.getByRole("textbox", { name: "Objective" }), "announce a product launch");
    await user.type(screen.getByRole("textbox", { name: "Brief (optional)" }), "Focus on migration lessons");
    await user.click(screen.getByRole("button", { name: "Start generation" }));

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(generationBody).toEqual({ platform: "linkedin", objective: "announce a product launch", count: 3, brief: "Focus on migration lessons" });
    expect(await screen.findByText("Generated follow-up")).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("stops polling and exposes a generation job failure", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.post("http://127.0.0.1:8080/v1/drafts/generate", () => HttpResponse.json({ id: "job-2" })),
      http.get("http://127.0.0.1:8080/v1/jobs/job-2", () => HttpResponse.json({ status: "failed", error_message: "Provider quota exhausted" })),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);

    await user.click(await screen.findByRole("button", { name: "Generate" }));
    await user.click(screen.getByRole("button", { name: "Start generation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider quota exhausted");
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("recovers from a transient job-status failure", async () => {
    let polls = 0;
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.post("http://127.0.0.1:8080/v1/drafts/generate", () => HttpResponse.json({ id: "job-3" })),
      http.get("http://127.0.0.1:8080/v1/jobs/job-3", () => {
        polls += 1;
        return polls === 1
          ? HttpResponse.json({ detail: "Temporary job-store outage" }, { status: 503 })
          : HttpResponse.json({ status: "completed", error_message: null });
      }),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);
    await user.click(await screen.findByRole("button", { name: "Generate" }));
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Start generation" }));
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(polls).toBe(2);
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("bounds a generation poll that never reaches a terminal state", async () => {
    let polls = 0;
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.post("http://127.0.0.1:8080/v1/drafts/generate", () => HttpResponse.json({ id: "job-4" })),
      http.get("http://127.0.0.1:8080/v1/jobs/job-4", () => {
        polls += 1;
        return HttpResponse.json({ status: "running", error_message: null });
      }),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);
    await user.click(await screen.findByRole("button", { name: "Generate" }));
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Start generation" }));
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(polls).toBe(40);
    expect(screen.getByRole("alert")).toHaveTextContent("Draft generation is taking too long");
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("validates generation inputs and excludes unsupported platforms", async () => {
    let starts = 0;
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.post("http://127.0.0.1:8080/v1/drafts/generate", () => {
        starts += 1;
        return HttpResponse.json({ id: "unexpected" });
      }),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);

    await user.click(await screen.findByRole("button", { name: "Generate" }));
    expect(screen.queryByRole("option", { name: "TikTok" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "YouTube" })).not.toBeInTheDocument();
    const count = screen.getByRole("spinbutton", { name: "Draft count" });
    await user.clear(count);
    await user.type(count, "0");
    await user.click(screen.getByRole("button", { name: "Start generation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("whole number from 1 to 7");

    await user.clear(count);
    await user.type(count, "2");
    await user.clear(screen.getByRole("textbox", { name: "Objective" }));
    await user.click(screen.getByRole("button", { name: "Start generation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Objective is required");
    expect(starts).toBe(0);
  });

  it("keeps generation values visible when the start request fails", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
      http.post("http://127.0.0.1:8080/v1/drafts/generate", () =>
        HttpResponse.json({ detail: "Generation provider is unavailable" }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    render(<DraftsPage />);

    await user.click(await screen.findByRole("button", { name: "Generate" }));
    await user.type(screen.getByRole("textbox", { name: "Brief (optional)" }), "Preserve this brief");
    await user.click(screen.getByRole("button", { name: "Start generation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Generation provider is unavailable");
    expect(screen.getByRole("dialog", { name: "Generate drafts" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Brief (optional)" })).toHaveValue("Preserve this brief");
    expect(screen.getByRole("button", { name: "Start generation" })).toBeEnabled();
  });

  it("continues polling after React StrictMode replays the mount effect", async () => {
    let completed = false;
    const generated = { ...drafts[0], id: "draft-strict", concept: "Strict mode result" };
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(completed ? [...drafts, generated] : drafts)),
      http.post("http://127.0.0.1:8080/v1/drafts/generate", () => HttpResponse.json({ id: "job-strict" })),
      http.get("http://127.0.0.1:8080/v1/jobs/job-strict", () => {
        completed = true;
        return HttpResponse.json({ status: "completed", error_message: null });
      }),
    );
    const user = userEvent.setup();
    render(<StrictMode><DraftsPage /></StrictMode>);

    await user.click(await screen.findByRole("button", { name: "Generate" }));
    await user.click(screen.getByRole("button", { name: "Start generation" }));

    expect(await screen.findByText("Strict mode result")).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("renders content as read-only for viewers", async () => {
    localStorage.setItem("rf_role", "viewer");
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json(drafts)),
    );
    render(<DraftsPage />);

    expect(await screen.findByText("Launch story")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share pending" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete draft" })).not.toBeInTheDocument();
  });

  it("renders an API failure instead of an empty content state", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () =>
        HttpResponse.json({ detail: "Draft service unavailable" }, { status: 503 }),
      ),
    );
    render(<DraftsPage />);

    expect(await screen.findByText("Draft service unavailable")).toBeVisible();
    expect(screen.queryByText("No drafts yet.")).not.toBeInTheDocument();
  });
});
