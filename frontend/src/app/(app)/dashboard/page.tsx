"use client";

import { useState } from "react";
import {
  CalendarDays,
  FileText,
  TrendingUp,
  Flame,
  Loader2,
  AlertCircle,
  Bot,
  Zap,
  CheckCircle2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { useDrafts, useWorkspace } from "@/hooks/use-api";

function timeAgo(dateStr?: string) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return "";
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DashboardPage() {
  const { drafts, loading: draftsLoading, error: draftsError } = useDrafts();
  const { workspace, loading: wsLoading } = useWorkspace();

  const pending = drafts.filter((d) => d.status === "draft");
  const approved = drafts.filter((d) => d.status === "approved");
  const scheduled = drafts.filter((d) => d.status === "scheduled");
  const published = drafts.filter((d) => d.status === "published");

  if (draftsLoading || wsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (draftsError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <AlertCircle className="h-6 w-6 text-danger mx-auto" />
          <p className="text-sm text-muted-foreground">{draftsError}</p>
          <p className="text-xs text-muted-foreground">
            Make sure the backend is running on port 8080
          </p>
        </div>
      </div>
    );
  }

  const stats = [
    {
      title: "Pending",
      value: pending.length,
      icon: FileText,
      description: "Awaiting approval",
      color: "text-warning",
      bg: "bg-warning/8",
    },
    {
      title: "Approved",
      value: approved.length,
      icon: TrendingUp,
      description: "Ready to publish",
      color: "text-success",
      bg: "bg-success/8",
    },
    {
      title: "Scheduled",
      value: scheduled.length,
      icon: CalendarDays,
      description: "Queued",
      color: "text-info",
      bg: "bg-info/8",
    },
    {
      title: "Published",
      value: published.length,
      icon: Flame,
      description: "Live",
      color: "text-accent",
      bg: "bg-accent/8",
    },
  ];

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Title */}
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          {workspace && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {workspace.name}
              {workspace.brand_profile?.voice_summary && (
                <span className="ml-1.5 text-xs">
                  — {workspace.brand_profile.voice_summary}
                </span>
              )}
            </p>
          )}
        </div>

        {/* Stats */}
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {stats.map((stat) => (
            <motion.div
              key={stat.title}
              variants={staggerItem}

              className="rounded-xl border border-border/50 bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {stat.title}
                </span>
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-lg ${stat.bg}`}
                >
                  <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold tabular-nums">
                {stat.value}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {stat.description}
              </p>
            </motion.div>
          ))}
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-2 items-start">
          {/* System Status */}
          <motion.div
            variants={staggerItem}
            initial="initial"
            animate="animate"
            className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="h-4 w-4 text-accent" />
              System Status
            </h2>
            {[
              { label: "Backend API", value: "Online", ok: true },
              { label: "Total Drafts", value: String(drafts.length), ok: true },
              { label: "Workspace", value: workspace?.name || "—", ok: !!workspace },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2"
              >
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="text-sm font-medium">{row.value}</span>
              </div>
            ))}
          </motion.div>

          {/* Pending Drafts */}
          <motion.div
            variants={staggerItem}
            initial="initial"
            animate="animate"
            className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-warning" />
              Pending Drafts
              {pending.length > 0 && (
                <span className="ml-auto rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning tabular-nums">
                  {pending.length}
                </span>
              )}
            </h2>
            {pending.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No pending drafts. Generate some or wait for the heartbeat.
              </p>
            ) : (
              <div className="space-y-2">
                {pending.map((draft) => (
                  <div
                    key={draft.id}
                    className="rounded-lg bg-muted/30 px-3 py-2 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium capitalize">
                        {draft.platform}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {timeAgo(draft.created_at)}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{draft.concept}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {draft.caption}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Approved Drafts — ready to publish */}
          {approved.length > 0 && (
            <motion.div
              variants={staggerItem}
              initial="initial"
              animate="animate"
              className="rounded-xl border border-border/50 bg-card p-4 space-y-3 lg:col-span-2"
            >
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Approved — Ready to Publish
                <span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success tabular-nums">
                  {approved.length}
                </span>
              </h2>
              <div className="space-y-2">
                {approved.map((draft) => (
                  <ApprovedDraftRow key={draft.id} draft={draft} />
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function ApprovedDraftRow({ draft }: { draft: { id: string; platform: string; concept: string; caption: string } }) {
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");

  const handlePublish = async () => {
    setPublishing(true);
    setError("");
    try {
      await apiFetch(`/v1/drafts/${draft.id}/publish?platform=${draft.platform}`, { method: "POST" });
      setPublished(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2 space-y-1">
      <div className="flex items-center justify-between">
        <span className="rounded bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success capitalize">
          {draft.platform}
        </span>
        {published ? (
          <span className="flex items-center gap-1 text-[11px] text-success font-medium">
            <CheckCircle2 className="h-3 w-3" />Published
          </span>
        ) : (
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {publishing ? "Publishing..." : "Publish"}
          </button>
        )}
      </div>
      <p className="text-sm font-medium">{draft.concept}</p>
      <p className="text-xs text-muted-foreground line-clamp-2">{draft.caption}</p>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
