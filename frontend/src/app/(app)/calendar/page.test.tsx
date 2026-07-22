import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import CalendarPage from "./page";

const calendarDraft = {
  id: "draft-1", workspace_id: "workspace-1", platform: "linkedin", status: "scheduled",
  concept: "Scheduled launch", caption: "Launch details", hook: "Hook", cta: "CTA",
  hashtags: ["launch"], alt_text: "", media_prompt: null,
  created_at: "2026-07-18T14:30:00-03:00",
};

describe("CalendarPage", () => {
  it("navigates months and opens an accessible hourly day view", async () => {
    server.use(http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json([calendarDraft])));
    const user = userEvent.setup();
    render(<CalendarPage />);

    expect(await screen.findByText("July 2026")).toBeVisible();
    const day = screen.getByRole("button", { name: "July 18, 2026, 1 content item" });
    await user.click(day);
    expect(screen.getByRole("dialog", { name: "July 18, 2026" })).toBeVisible();
    expect(screen.getAllByText("Scheduled launch")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Close day details" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("August 2026")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("July 2026")).toBeVisible();
    expect(screen.getByRole("button", { name: "July 1, 2026, no content" })).toBeDisabled();
  });

  it("reports a backend failure", async () => {
    server.use(http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json({ detail: "Calendar unavailable" }, { status: 503 })));
    render(<CalendarPage />);
    expect(await screen.findByText("Calendar unavailable")).toBeVisible();
  });
});
