"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Search,
  FileText,
  Bot,
  Heart,
  Send,
  Shield,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { apiFetch } from "@/lib/api";

interface ActivityEvent {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const eventIcons: Record<string, React.ReactNode> = {
  "heartbeat.completed": <Heart className="h-3.5 w-3.5 text-platform-instagram" />,
  "heartbeat.requested": <Zap className="h-3.5 w-3.5 text-warning" />,
  "heartbeat.scout.started": <Search className="h-3.5 w-3.5 text-agent-scouting" />,
  "heartbeat.scout.completed": <Search className="h-3.5 w-3.5 text-success" />,
  "heartbeat.scout.failed": <Search className="h-3.5 w-3.5 text-danger" />,
  "heartbeat.analyst.started": <Bot className="h-3.5 w-3.5 text-agent-analyzing" />,
  "heartbeat.analyst.completed": <Bot className="h-3.5 w-3.5 text-success" />,
  "heartbeat.analyst.failed": <Bot className="h-3.5 w-3.5 text-danger" />,
  "heartbeat.creator.started": <FileText className="h-3.5 w-3.5 text-agent-creating" />,
  "job.queued": <Clock className="h-3.5 w-3.5 text-info" />,
  "job.started": <Zap className="h-3.5 w-3.5 text-accent" />,
  "job.completed": <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
  "draft.generated": <FileText className="h-3.5 w-3.5 text-success" />,
  "draft.approved": <CheckCircle2 className="h-3.5 w-3.5 text-success" />,
  "draft.rejected": <XCircle className="h-3.5 w-3.5 text-danger" />,
  "draft.published": <Send className="h-3.5 w-3.5 text-info" />,
};

const eventLabels: Record<string, string> = {
  "heartbeat.completed": "Heartbeat completed",
  "heartbeat.requested": "Heartbeat requested",
  "heartbeat.scout.started": "Scout researching trends...",
  "heartbeat.scout.completed": "Scout finished",
  "heartbeat.scout.failed": "Scout failed",
  "heartbeat.analyst.started": "Analyst reviewing performance...",
  "heartbeat.analyst.completed": "Analyst finished",
  "heartbeat.analyst.failed": "Analyst failed",
  "heartbeat.creator.started": "Creator generating drafts...",
  "job.queued": "Job queued",
  "job.started": "Job started",
  "job.completed": "Job completed",
  "draft.generated": "Draft generated",
  "draft.approved": "Draft approved",
  "draft.rejected": "Draft rejected",
  "draft.published": "Draft published",
};

function getEventIcon(eventType: string) {
  if (eventType.startsWith("chat.tool.")) return <Bot className="h-3.5 w-3.5 text-agent-analyzing" />;
  return eventIcons[eventType] || <Shield className="h-3.5 w-3.5 text-muted-foreground" />;
}

function getEventLabel(eventType: string) {
  if (eventType.startsWith("chat.tool.")) return `Tool: ${eventType.replace("chat.tool.", "")}`;
  return eventLabels[eventType] || eventType;
}

function getEventAccent(eventType: string): string {
  if (eventType.includes("completed") || eventType.includes("generated") || eventType.includes("approved")) return "border-l-success";
  if (eventType.includes("failed") || eventType.includes("rejected")) return "border-l-danger";
  if (eventType.includes("started") || eventType.includes("requested")) return "border-l-warning";
  if (eventType.includes("queued")) return "border-l-info";
  if (eventType.startsWith("chat.tool.")) return "border-l-agent-analyzing";
  return "border-l-border";
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return "";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function PayloadSummary({ payload, eventType }: { payload: Record<string, unknown>; eventType: string }) {
  if (!payload || Object.keys(payload).length === 0) return null;

  if (eventType === "heartbeat.completed") {
    const drafts = (payload.drafts_created as number) || 0;
    const scout = payload.scout as Record<string, unknown> | undefined;
    const trends = Array.isArray(scout?.trends) ? (scout.trends as string[]) : [];
    return (
      <div className="text-[11px] text-muted-foreground space-y-0.5">
        <div>{drafts} drafts created</div>
        {trends.length > 0 && <div>Trends: {trends.slice(0, 3).join(", ")}</div>}
      </div>
    );
  }

  if (eventType.startsWith("chat.tool.")) {
    const args = payload.arguments as Record<string, unknown> | undefined;
    if (args) {
      const summary = Object.entries(args)
        .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
        .join(", ");
      return <div className="text-[11px] text-muted-foreground">{summary}</div>;
    }
  }

  if (eventType === "draft.generated") {
    return <div className="text-[11px] text-muted-foreground">Platform: {String(payload.platform || "")}</div>;
  }

  if (eventType === "draft.published") {
    const url = payload.url as string | undefined;
    const platform = payload.platform as string | undefined;
    if (url) return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent hover:underline truncate flex items-center gap-1">
        {platform && <span className="text-muted-foreground capitalize">{platform}:</span>}
        {url}
      </a>
    );
  }

  if (eventType.startsWith("job.")) {
    return <div className="text-[11px] text-muted-foreground">{String(payload.job_type || "")}</div>;
  }

  return null;
}

function isRecentlyActive(e: ActivityEvent): boolean {
  const age = Date.now() - new Date(e.created_at).getTime();
  if (age > 120000) return false; // older than 2 min = not active
  return e.event_type.endsWith(".started") || e.event_type === "job.queued" || e.event_type === "heartbeat.requested";
}

const tabConfig = [
  { id: "all", label: "All", filter: () => true },
  { id: "running", label: "Running", filter: isRecentlyActive },
  { id: "heartbeats", label: "Heartbeats", filter: (e: ActivityEvent) => e.event_type.startsWith("heartbeat.") },
  { id: "jobs", label: "Jobs", filter: (e: ActivityEvent) => e.event_type.startsWith("job.") },
  { id: "content", label: "Content", filter: (e: ActivityEvent) => e.event_type.startsWith("draft.") },
  { id: "tools", label: "Tools", filter: (e: ActivityEvent) => e.event_type.startsWith("chat.tool.") },
];

export default function TasksPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heartbeatStatus, setHeartbeatStatus] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [activityData, hbData] = await Promise.all([
        apiFetch<ActivityEvent[]>("/v1/activity?limit=100"),
        apiFetch<Record<string, unknown>>("/v1/heartbeat/status"),
      ]);
      setEvents(activityData);
      setHeartbeatStatus(hbData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <AlertCircle className="h-6 w-6 text-danger mx-auto" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const currentFilter = tabConfig.find((t) => t.id === activeTab)!;
  const filtered = events.filter(currentFilter.filter);

  return (
    <PageContainer>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Activity</h1>
            <p className="text-sm text-muted-foreground">
              Everything the system is doing and has done.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                await apiFetch("/v1/heartbeat/trigger", { method: "POST" });
                refresh();
              }}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 transition-opacity"
            >
              <Zap className="h-3.5 w-3.5" />
              Trigger Heartbeat
            </button>
            <button
              onClick={refresh}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {/* Heartbeat Status */}
        {heartbeatStatus && (
          <div className="rounded-xl border border-border/50 bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold mb-3">
              <Heart className="h-4 w-4 text-platform-instagram" />
              Heartbeat Status
            </h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs text-muted-foreground">Last run</span>
                <div className="font-medium mt-0.5">
                  {heartbeatStatus.last_run ? timeAgo(heartbeatStatus.last_run as string) : "Never"}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Next run</span>
                <div className="font-medium mt-0.5">{String(heartbeatStatus.next_run || "—")}</div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Interval</span>
                <div className="font-medium mt-0.5">{String(heartbeatStatus.interval_hours)}h</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1 overflow-x-auto">
          {tabConfig.map((tab) => {
            const count = events.filter(tab.filter).length;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                  activeTab === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activity-tab"
                    className="absolute inset-0 rounded-md bg-card shadow-sm"
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  />
                )}
                <span className="relative">{tab.label}</span>
                {count > 0 && (
                  <span className="relative rounded-full bg-accent/10 px-1.5 text-[11px] font-medium text-accent tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Events list */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card py-12 text-center">
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          </div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="space-y-1.5"
          >
            <AnimatePresence mode="popLayout">
              {filtered.map((event) => (
                <motion.div
                  key={event.id}
                  variants={staggerItem}
                  layout
                  exit={{ opacity: 0, x: -12 }}
                  className={`flex items-start gap-3 rounded-lg border border-border/30 ${getEventAccent(event.event_type)} border-l-[3px] bg-card px-3 py-2.5`}
                >
                  <div className="mt-0.5">{getEventIcon(event.event_type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{getEventLabel(event.event_type)}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                        {timeAgo(event.created_at)}
                      </span>
                    </div>
                    <PayloadSummary payload={event.payload} eventType={event.event_type} />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </PageContainer>
  );
}
