import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/server";
import DashboardPage from "./page";

const approvedDraft = {
  id: "draft-1", workspace_id: "workspace-1", platform: "linkedin", status: "approved",
  concept: "Ready to publish", caption: "A reviewed post", hook: "Hook", cta: "CTA",
  hashtags: [], alt_text: "", media_prompt: null, created_at: "2026-07-18T12:00:00Z",
};

function installDashboardHandlers() {
  server.use(
    http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json([approvedDraft])),
    http.get("http://127.0.0.1:8080/v1/workspace", () => HttpResponse.json({ id: "workspace-1", name: "Staff Workspace", slug: "staff", brand_profile: { voice_summary: "Direct and concrete" } })),
  );
}

describe("DashboardPage", () => {
  beforeEach(() => localStorage.setItem("rf_role", "owner"));

  it("renders live draft counts and marks a successful publish", async () => {
    installDashboardHandlers();
    server.use(http.post("http://127.0.0.1:8080/v1/drafts/draft-1/publish", () => HttpResponse.json({ success: true, url: "https://linkedin.example/post" })));
    const user = userEvent.setup();
    render(<DashboardPage />);

    expect(await screen.findAllByText("Staff Workspace")).toHaveLength(2);
    expect(screen.getByText(/Direct and concrete/)).toBeVisible();
    expect(screen.getAllByText("Ready to publish")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByText("Published", { selector: "span.flex" });
    expect(screen.getAllByText("Published")).toHaveLength(2);
  });

  it("does not report publication when the API returns a business failure", async () => {
    installDashboardHandlers();
    server.use(http.post("http://127.0.0.1:8080/v1/drafts/draft-1/publish", () => HttpResponse.json({ success: false, error: "LinkedIn credentials are missing" })));
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByText("LinkedIn credentials are missing")).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("shows approved content without publish controls for viewers", async () => {
    localStorage.setItem("rf_role", "viewer");
    installDashboardHandlers();
    render(<DashboardPage />);

    expect(await screen.findByText("Read only")).toBeVisible();
    expect(screen.getAllByText("Ready to publish")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });
});
