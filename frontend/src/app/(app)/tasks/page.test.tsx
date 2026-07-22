import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/server";
import TasksPage from "./page";

const events = [
  {
    id: "event-1",
    event_type: "heartbeat.completed",
    entity_type: "workspace",
    entity_id: "workspace-1",
    payload: { drafts_queued: 2, scout: { trends: ["agent systems"] } },
    created_at: new Date().toISOString(),
  },
  {
    id: "event-2",
    event_type: "draft.published",
    entity_type: "content_draft",
    entity_id: "draft-1",
    payload: { platform: "linkedin", url: "https://linkedin.example/post-1" },
    created_at: new Date().toISOString(),
  },
];

function installHandlers() {
  server.use(
    http.get("http://127.0.0.1:8080/v1/activity", () => HttpResponse.json(events)),
    http.get("http://127.0.0.1:8080/v1/heartbeat/status", () => HttpResponse.json({ last_run: null, next_run: "soon", interval_hours: 6 })),
  );
}

describe("TasksPage", () => {
  beforeEach(installHandlers);

  it("renders truthful queued counts and filters activity by user interaction", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    expect(await screen.findByRole("heading", { name: "Activity" })).toBeVisible();
    expect(screen.getByText("2 drafts queued")).toBeVisible();
    expect(screen.getByText("Trends: agent systems")).toBeVisible();
    expect(screen.getByRole("link", { name: /linkedin:/i })).toHaveAttribute("href", "https://linkedin.example/post-1");

    await user.click(screen.getByRole("button", { name: /Content/ }));
    expect(screen.getByText("Draft published")).toBeVisible();
    expect(screen.queryByText("Heartbeat completed")).not.toBeInTheDocument();
  });

  it("triggers a heartbeat explicitly and refreshes activity", async () => {
    let triggers = 0;
    server.use(
      http.post("http://127.0.0.1:8080/v1/heartbeat/trigger", () => {
        triggers += 1;
        return HttpResponse.json({ status: "queued" });
      }),
    );
    const user = userEvent.setup();
    render(<TasksPage />);

    await user.click(await screen.findByRole("button", { name: "Trigger Heartbeat" }));
    await waitFor(() => expect(triggers).toBe(1));
    expect(await screen.findByRole("button", { name: "Trigger Heartbeat" })).toBeEnabled();
  });

  it("announces a heartbeat trigger failure without an unhandled rejection", async () => {
    server.use(
      http.post("http://127.0.0.1:8080/v1/heartbeat/trigger", () =>
        HttpResponse.json({ detail: "A heartbeat is already queued" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    render(<TasksPage />);

    await user.click(await screen.findByRole("button", { name: "Trigger Heartbeat" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A heartbeat is already queued");
    expect(screen.getByRole("button", { name: "Trigger Heartbeat" })).toBeEnabled();
  });
});
