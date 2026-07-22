import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { server } from "@/test/server";
import SharedReviewPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "share-123" }),
}));

const sharedDraft = {
  id: "draft-1",
  platform: "linkedin",
  status: "draft",
  concept: "Staff launch",
  caption: "A concrete launch update.",
  hook: "We shipped it.",
  cta: "What would you add?",
  hashtags: ["staffengineering"],
  media_prompt: null,
};

describe("SharedReviewPage", () => {
  it("loads public drafts and displays the expiry without sending stored credentials", async () => {
    localStorage.setItem("rf_token", "private-owner-token");
    let authorization: string | null = "not requested";
    server.use(
      http.get("http://127.0.0.1:8080/v1/share/share-123", ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({
          share_id: "share-123",
          expires_at: "2030-01-02T15:30:00Z",
          drafts: [sharedDraft, { ...sharedDraft, id: "draft-2", status: "published", concept: "Already live" }],
        });
      }),
    );

    render(<SharedReviewPage />);

    expect(await screen.findByRole("heading", { name: "Staff launch" })).toBeVisible();
    expect(screen.getAllByText("A concrete launch update.")).toHaveLength(2);
    expect(screen.getAllByText("#staffengineering")).toHaveLength(2);
    expect(screen.getByText(/This review link expires/)).toBeVisible();
    expect(screen.getByText("Status: published")).toBeVisible();
    expect(screen.queryByText("Approved")).not.toBeInTheDocument();
    expect(authorization).toBeNull();
  });

  it("approves a draft only after an explicit click", async () => {
    let approvals = 0;
    server.use(
      http.get("http://127.0.0.1:8080/v1/share/share-123", () => HttpResponse.json({
        share_id: "share-123",
        expires_at: "2030-01-02T15:30:00Z",
        drafts: [sharedDraft],
      })),
      http.post("http://127.0.0.1:8080/v1/share/share-123/approve/draft-1", () => {
        approvals += 1;
        return HttpResponse.json({ status: "approved", draft_id: "draft-1" });
      }),
    );
    const user = userEvent.setup();
    render(<SharedReviewPage />);

    const approve = await screen.findByRole("button", { name: "Approve draft" });
    expect(approvals).toBe(0);
    await user.click(approve);

    await waitFor(() => expect(approvals).toBe(1));
    expect(await screen.findByText("Approved")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Approve draft" })).not.toBeInTheDocument();
  });

  it.each([
    [404, "Share link not found or expired"],
    [410, "Share link has expired"],
  ])("shows public API errors for an unavailable link (%s)", async (status, detail) => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/share/share-123", () =>
        HttpResponse.json({ detail }, { status }),
      ),
    );

    render(<SharedReviewPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(detail);
    expect(screen.queryByRole("button", { name: "Approve draft" })).not.toBeInTheDocument();
  });
});
