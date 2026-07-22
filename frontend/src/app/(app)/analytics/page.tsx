"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Eye, Heart, Loader2, MessageCircle, RefreshCw, Share2, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { apiFetch } from "@/lib/api";
import { useDrafts } from "@/hooks/use-api";

interface EngagementResponse {
  draft_id: string;
  published: boolean;
  platform?: string;
  platform_url?: string | null;
  published_at?: string;
  metrics: Record<string, number> | null;
}

function metricValue(metrics: Record<string, number>, ...keys: string[]) {
  for (const key of keys) {
    const value = Number(metrics[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

export default function AnalyticsPage() {
  const { drafts, loading: draftsLoading, error: draftsError, refresh } = useDrafts();
  const [engagement, setEngagement] = useState<EngagementResponse[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const publishedIds = useMemo(
    () => drafts.filter((draft) => draft.status === "published").map((draft) => draft.id),
    [drafts],
  );
  const publishedKey = publishedIds.join(",");

  const loadEngagement = useCallback(async (ids: string[], cancelled: () => boolean) => {
    setMetricsLoading(true);
    setMetricsError("");
    const results = await Promise.allSettled(
      ids.map((id) => apiFetch<EngagementResponse>(`/v1/drafts/${id}/engagement`)),
    );
    if (cancelled()) return;

    const available = results
      .filter((result): result is PromiseFulfilledResult<EngagementResponse> => result.status === "fulfilled")
      .map((result) => result.value);
    const failureCount = results.length - available.length;
    setEngagement(available);
    setMetricsError(failureCount > 0 ? `Could not load metrics for ${failureCount} published post${failureCount === 1 ? "" : "s"}.` : "");
    setMetricsLoading(false);
  }, []);

  useEffect(() => {
    if (!publishedKey) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) loadEngagement(publishedKey.split(","), () => cancelled);
    });
    return () => { cancelled = true; };
  }, [loadEngagement, publishedKey, reloadKey]);

  const postsWithMetrics = engagement.filter((entry) => entry.published && entry.metrics);
  const totals = postsWithMetrics.reduce(
    (summary, entry) => {
      const metrics = entry.metrics || {};
      summary.views += metricValue(metrics, "views", "impressions");
      summary.likes += metricValue(metrics, "likes");
      summary.comments += metricValue(metrics, "comments", "replies");
      summary.shares += metricValue(metrics, "shares", "retweets", "reposts");
      return summary;
    },
    { views: 0, likes: 0, comments: 0, shares: 0 },
  );
  const engagementRate = totals.views > 0
    ? ((totals.likes + totals.comments + totals.shares) / totals.views) * 100
    : 0;

  if (draftsLoading) {
    return <div className="flex h-64 items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="sr-only">Loading analytics</span></div>;
  }

  if (draftsError) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="space-y-3 text-center" role="alert">
          <AlertCircle className="mx-auto h-6 w-6 text-danger" />
          <p className="text-sm text-muted-foreground">{draftsError}</p>
          <button onClick={refresh} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs"><RefreshCw className="h-3.5 w-3.5" />Retry</button>
        </div>
      </div>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1>Analytics</h1>
            <p className="text-sm text-muted-foreground">Live or most recently stored metrics for published content.</p>
          </div>
          {publishedIds.length > 0 && (
            <button onClick={() => setReloadKey((key) => key + 1)} disabled={metricsLoading} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${metricsLoading ? "animate-spin" : ""}`} />Refresh metrics
            </button>
          )}
        </div>

        {publishedIds.length === 0 ? (
          <div className="rounded-xl border border-border/40 bg-card py-14 text-center">
            <TrendingUp className="mx-auto mb-3 h-7 w-7 text-muted-foreground/30" />
            <p className="text-sm font-medium">No published content yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Analytics appear after a draft is published and its platform reports metrics.</p>
          </div>
        ) : metricsLoading && engagement.length === 0 ? (
          <div className="flex h-48 items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin" /><span className="sr-only">Loading engagement metrics</span></div>
        ) : (
          <>
            {metricsError && <div role="alert" className="rounded-md border border-warning/20 bg-warning/5 px-4 py-2.5 text-xs text-warning">{metricsError}</div>}

            <motion.div variants={staggerContainer} initial="initial" animate="animate" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Views", value: totals.views.toLocaleString(), icon: Eye, color: "text-info", bg: "bg-info/8" },
                { label: "Likes", value: totals.likes.toLocaleString(), icon: Heart, color: "text-danger", bg: "bg-danger/8" },
                { label: "Comments", value: totals.comments.toLocaleString(), icon: MessageCircle, color: "text-success", bg: "bg-success/8" },
                { label: "Shares", value: totals.shares.toLocaleString(), icon: Share2, color: "text-agent-analyzing", bg: "bg-agent-analyzing/8" },
                { label: "Engagement rate", value: `${engagementRate.toFixed(1)}%`, icon: TrendingUp, color: "text-accent", bg: "bg-accent/8" },
              ].map((stat) => (
                <motion.div key={stat.label} variants={staggerItem} className="rounded-xl border border-border/50 bg-card p-4">
                  <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{stat.label}</span><div className={`flex h-7 w-7 items-center justify-center rounded-lg ${stat.bg}`}><stat.icon className={`h-3.5 w-3.5 ${stat.color}`} /></div></div>
                  <div className="mt-2 text-xl font-bold tabular-nums">{stat.value}</div>
                </motion.div>
              ))}
            </motion.div>

            <section className="rounded-xl border border-border/50 bg-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Published posts</h2>
              {engagement.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No engagement responses are available.</p>
              ) : (
                <div className="divide-y divide-border/20">
                  {engagement.map((entry) => {
                    const draft = drafts.find((item) => item.id === entry.draft_id);
                    const metrics = entry.metrics || {};
                    return (
                      <div key={entry.draft_id} className="grid gap-2 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_repeat(4,5rem)] sm:items-center">
                        <div className="min-w-0"><p className="truncate font-medium">{draft?.concept || entry.draft_id}</p><p className="capitalize text-muted-foreground">{entry.platform || draft?.platform || "Unknown platform"}</p></div>
                        <span><span className="text-muted-foreground sm:hidden">Views: </span>{metricValue(metrics, "views", "impressions").toLocaleString()}</span>
                        <span><span className="text-muted-foreground sm:hidden">Likes: </span>{metricValue(metrics, "likes").toLocaleString()}</span>
                        <span><span className="text-muted-foreground sm:hidden">Comments: </span>{metricValue(metrics, "comments", "replies").toLocaleString()}</span>
                        <span><span className="text-muted-foreground sm:hidden">Shares: </span>{metricValue(metrics, "shares", "retweets", "reposts").toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </PageContainer>
  );
}
