import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { useAppStore } from "./store";

function installRefreshHandlers(eventType = "heartbeat.scout.started") {
  server.use(
    http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json([
      { id: "1", status: "draft" },
      { id: "2", status: "reviewed" },
      { id: "3", status: "approved" },
      { id: "4", status: "scheduled" },
      { id: "5", status: "published" },
    ])),
    http.get("http://127.0.0.1:8080/v1/activity", () => HttpResponse.json([
      { id: "event-1", event_type: eventType, entity_type: "heartbeat", entity_id: "1", payload: {}, created_at: new Date().toISOString() },
    ])),
    http.get("http://127.0.0.1:8080/v1/heartbeat/status", () => HttpResponse.json({ last_run: null, next_run: "soon", interval_hours: 6 })),
    http.get("http://127.0.0.1:8080/v1/workspace", () => HttpResponse.json({
      id: "workspace-1",
      name: "Rebel Forge",
      slug: "rebel-forge",
      brand_profile: { style_notes: { heartbeat: { enabled: true } } },
    })),
  );
}

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it("refreshes the application atomically and derives counts and agent state", async () => {
    installRefreshHandlers();
    await useAppStore.getState().refresh();

    const state = useAppStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.lastRefreshedAt).toBeGreaterThan(0);
    expect(state.agentState).toBe("scouting");
    expect(state.heartbeatEnabled).toBe(true);
    expect(state.draftCounts).toEqual({ pending: 2, approved: 2, published: 1, total: 5 });
    expect(state.workspace?.name).toBe("Rebel Forge");
  });

  it("marks a recent failed event as an error", async () => {
    installRefreshHandlers("heartbeat.scout.failed");
    await useAppStore.getState().refresh();
    expect(useAppStore.getState().agentState).toBe("error");
  });

  it("keeps viewer-authorized workspace data when owner-only telemetry is forbidden", async () => {
    localStorage.setItem("rf_token", "viewer-token");
    localStorage.setItem("rf_role", "viewer");
    installRefreshHandlers();
    server.use(
      http.get("http://127.0.0.1:8080/v1/activity", () =>
        HttpResponse.json({ detail: "Owner token required" }, { status: 403 }),
      ),
      http.get("http://127.0.0.1:8080/v1/heartbeat/status", () =>
        HttpResponse.json({ detail: "Owner token required" }, { status: 403 }),
      ),
    );

    await useAppStore.getState().refresh();

    const state = useAppStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.draftCounts.total).toBe(5);
    expect(state.workspace?.name).toBe("Rebel Forge");
    expect(state.events).toEqual([]);
    expect(state.heartbeat).toBeNull();
    expect(localStorage.getItem("rf_token")).toBe("viewer-token");
  });

  it("loads readiness independently", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/readiness", () => HttpResponse.json({
        systems: {}, platforms: {}, features: { chat: true }, setup_complete: true,
        summary: { systems_ready: 1, systems_total: 1, platforms_ready: 0, platforms_total: 0, features_available: 1, features_total: 1 },
      })),
    );
    await useAppStore.getState().refreshReadiness();
    expect(useAppStore.getState().readiness).toMatchObject({ setup_complete: true, features: { chat: true } });
  });

  it("keeps its safe initial state when a refresh fails", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json({ detail: "offline" }, { status: 503 })),
      http.get("http://127.0.0.1:8080/v1/activity", () => HttpResponse.json({ detail: "offline" }, { status: 503 })),
      http.get("http://127.0.0.1:8080/v1/heartbeat/status", () => HttpResponse.json({ detail: "offline" }, { status: 503 })),
      http.get("http://127.0.0.1:8080/v1/workspace", () => HttpResponse.json({ detail: "offline" }, { status: 503 })),
    );
    await useAppStore.getState().refresh();
    expect(useAppStore.getState().initialized).toBe(false);
    expect(useAppStore.getState().drafts).toEqual([]);
  });
});
