import { create } from "zustand";
import { apiFetch } from "./api";
import type { Draft, Workspace } from "./types";

// === Types ===

export type AgentState = "idle" | "scouting" | "analyzing" | "creating" | "publishing" | "error";

export interface ActivityEvent {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface HeartbeatStatus {
  last_run: string | null;
  next_run: string;
  interval_hours: number;
  last_result?: Record<string, unknown>;
}

export interface DraftCounts {
  pending: number;
  approved: number;
  published: number;
  total: number;
}

export interface Readiness {
  systems: Record<string, { ready: boolean; label: string; model?: string; group?: string }>;
  platforms: Record<string, { ready: boolean; label: string }>;
  features: Record<string, boolean>;
  setup_complete: boolean;
  summary: {
    systems_ready: number;
    systems_total: number;
    platforms_ready: number;
    platforms_total: number;
    features_available: number;
    features_total: number;
  };
}

// === Store ===

interface AppStore {
  agentState: AgentState;
  heartbeat: HeartbeatStatus | null;
  heartbeatEnabled: boolean;

  drafts: Draft[];
  draftCounts: DraftCounts;

  events: ActivityEvent[];

  workspace: Workspace | null;

  readiness: Readiness | null;

  initialized: boolean;

  refresh: () => Promise<void>;
  refreshDrafts: () => Promise<void>;
  refreshReadiness: () => Promise<void>;
  startPolling: () => () => void;
}

function deriveAgentState(events: ActivityEvent[]): AgentState {
  if (events.length === 0) return "idle";

  const newest = events[0];
  const age = Date.now() - new Date(newest.created_at).getTime();

  if (newest.event_type.includes("completed") || newest.event_type.includes("generated")) return "idle";
  if (newest.event_type.includes("failed")) return age < 60000 ? "error" : "idle";
  if (age > 120000) return "idle";

  if (newest.event_type === "heartbeat.scout.started") return "scouting";
  if (newest.event_type === "heartbeat.analyst.started") return "analyzing";
  if (newest.event_type === "heartbeat.creator.started") return "creating";
  if (newest.event_type === "job.started") return "creating";
  if (newest.event_type === "heartbeat.requested") return "scouting";
  if (newest.event_type === "job.queued") return "creating";

  return "idle";
}

function countDrafts(drafts: Draft[]): DraftCounts {
  return {
    pending: drafts.filter((d) => d.status === "draft" || d.status === "reviewed").length,
    approved: drafts.filter((d) => d.status === "approved" || d.status === "scheduled").length,
    published: drafts.filter((d) => d.status === "published").length,
    total: drafts.length,
  };
}

export const useAppStore = create<AppStore>((set, get) => ({
  agentState: "idle",
  heartbeat: null,
  heartbeatEnabled: false,
  drafts: [],
  draftCounts: { pending: 0, approved: 0, published: 0, total: 0 },
  events: [],
  workspace: null,
  readiness: null,
  initialized: false,

  refresh: async () => {
    try {
      const [drafts, events, heartbeat, workspace] = await Promise.all([
        apiFetch<Draft[]>("/v1/drafts"),
        apiFetch<ActivityEvent[]>("/v1/activity?limit=50"),
        apiFetch<HeartbeatStatus>("/v1/heartbeat/status"),
        apiFetch<Workspace>("/v1/workspace"),
      ]);

      let hbEnabled = false;
      try {
        const sn = (workspace.brand_profile?.style_notes || {}) as Record<string, unknown>;
        const hb = (sn.heartbeat || {}) as Record<string, unknown>;
        hbEnabled = hb.enabled === true;
      } catch { /* ignore */ }

      set({
        drafts,
        draftCounts: countDrafts(drafts),
        events,
        agentState: deriveAgentState(events),
        heartbeat,
        heartbeatEnabled: hbEnabled,
        workspace,
        initialized: true,
      });
    } catch {
      // Not authenticated or backend down
    }
  },

  refreshDrafts: async () => {
    try {
      const drafts = await apiFetch<Draft[]>("/v1/drafts");
      set({ drafts, draftCounts: countDrafts(drafts) });
    } catch { /* ignore */ }
  },

  refreshReadiness: async () => {
    try {
      const readiness = await apiFetch<Readiness>("/v1/readiness");
      set({ readiness });
    } catch { /* ignore */ }
  },

  startPolling: () => {
    // Initial load
    get().refresh();
    get().refreshReadiness();

    // Fast poll: drafts, events, heartbeat (10s)
    const fast = setInterval(() => {
      get().refresh();
    }, 10000);

    // Slow poll: readiness (30s)
    const slow = setInterval(() => {
      get().refreshReadiness();
    }, 30000);

    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  },
}));
