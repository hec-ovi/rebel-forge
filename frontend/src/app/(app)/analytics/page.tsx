"use client";

import {
  Eye,
  Heart,
  MessageCircle,
  Share2,
  TrendingUp,
  TrendingDown,
  Beaker,
  Target,
} from "lucide-react";
import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { mockMetrics } from "@/lib/mock-data";

/*
 * ⚠️  MOCK DATA — This entire page uses hardcoded sample data.
 *
 * The real analytics will come from:
 *   GET /v1/drafts/{draft_id}/engagement  (per-draft metrics from platform APIs)
 *
 * The exploit/explore insights will come from the analyst agent's heartbeat output.
 *
 * TODO: Replace with real API calls once engagement data pipeline is built.
 */

const totalViews = mockMetrics.reduce((s, m) => s + m.views, 0);
const totalLikes = mockMetrics.reduce((s, m) => s + m.likes, 0);
const totalComments = mockMetrics.reduce((s, m) => s + m.comments, 0);
const totalShares = mockMetrics.reduce((s, m) => s + m.shares, 0);
const avgEngagement = (
  mockMetrics.reduce((s, m) => s + m.engagement_rate, 0) / mockMetrics.length
).toFixed(1);
const maxViews = Math.max(...mockMetrics.map((m) => m.views));
const maxEngagement = Math.max(...mockMetrics.map((m) => m.engagement_rate));

// MOCK: Hardcoded insights — will be replaced by analyst agent output
const exploitInsights = [
  { pattern: "Carousel posts on Tuesday/Thursday", engagement: "6.8%", trend: "up", posts: 4 },
  { pattern: "Behind-the-scenes content", engagement: "5.9%", trend: "up", posts: 3 },
  { pattern: "Tips & how-to posts", engagement: "5.4%", trend: "stable", posts: 6 },
];

// MOCK: Hardcoded experiments — will be replaced by analyst agent output
const exploreInsights = [
  { experiment: "Text-only LinkedIn posts", result: "Testing", status: "active" },
  { experiment: "Reel with trending audio", result: "+120% reach vs avg", status: "success" },
  { experiment: "Poll-style carousel", result: "-30% engagement", status: "failed" },
];

export default function AnalyticsPage() {
  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Performance data your analyst agent uses to optimize content.
          </p>
        </div>

        {/* Mock data warning */}
        <div className="rounded-md border border-warning/20 bg-warning/5 px-4 py-2.5 text-[12px] text-warning">
          Sample data — real analytics will appear once engagement metrics are connected via platform APIs.
        </div>

        {/* Summary Stats */}
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        >
          {[
            { label: "Views", value: totalViews.toLocaleString(), icon: Eye, color: "text-info", bg: "bg-info/8" },
            { label: "Likes", value: totalLikes.toLocaleString(), icon: Heart, color: "text-danger", bg: "bg-danger/8" },
            { label: "Comments", value: totalComments.toLocaleString(), icon: MessageCircle, color: "text-success", bg: "bg-success/8" },
            { label: "Shares", value: totalShares.toLocaleString(), icon: Share2, color: "text-agent-analyzing", bg: "bg-agent-analyzing/8" },
            { label: "Avg. Engagement", value: `${avgEngagement}%`, icon: TrendingUp, color: "text-accent", bg: "bg-accent/8" },
          ].map((stat) => (
            <motion.div
              key={stat.label}
              variants={staggerItem}

              className="rounded-xl border border-border/50 bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{stat.label}</span>
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${stat.bg}`}>
                  <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
                </div>
              </div>
              <div className="mt-2 text-xl font-bold tabular-nums">{stat.value}</div>
            </motion.div>
          ))}
        </motion.div>

        {/* Engagement Chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
        >
          <h2 className="text-sm font-semibold">Engagement Rate (7 days)</h2>
          <div className="flex items-end gap-3 h-40">
            {mockMetrics.map((metric, i) => {
              const height = (metric.engagement_rate / maxEngagement) * 100;
              const day = new Date(metric.date).toLocaleDateString("en", { weekday: "short" });
              return (
                <motion.div
                  key={metric.date}
                  initial={{ height: 0 }}
                  animate={{ height: `${height}%` }}
                  transition={{ delay: 0.3 + i * 0.05, duration: 0.5, ease: "easeOut" }}
                  className="flex-1 flex flex-col items-center gap-1"
                  style={{ height: "100%" }}
                >
                  <span className="text-[11px] font-medium tabular-nums">{metric.engagement_rate}%</span>
                  <div className="w-full flex items-end justify-center flex-1">
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ delay: 0.3 + i * 0.05, duration: 0.5 }}
                      style={{ height: `${height}%`, transformOrigin: "bottom" }}
                      className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-accent to-accent/60 hover:opacity-80 transition-opacity cursor-pointer"
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{day}</span>
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Exploit */}
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Target className="h-4 w-4 text-success" />
              Exploit — What Works
            </h2>
            <div className="space-y-2">
              {exploitInsights.map((insight) => (
                <div
                  key={insight.pattern}
                  className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">{insight.pattern}</p>
                    <p className="text-[11px] text-muted-foreground">{insight.posts} posts</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success tabular-nums">
                      {insight.engagement}
                    </span>
                    {insight.trend === "up" ? (
                      <TrendingUp className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Explore */}
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
          >
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Beaker className="h-4 w-4 text-info" />
              Explore — Experiments
            </h2>
            <div className="space-y-2">
              {exploreInsights.map((insight) => (
                <div
                  key={insight.experiment}
                  className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium">{insight.experiment}</p>
                    <p className="text-[11px] text-muted-foreground">{insight.result}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      insight.status === "success"
                        ? "bg-success/10 text-success"
                        : insight.status === "failed"
                          ? "bg-danger/10 text-danger"
                          : "bg-info/10 text-info"
                    }`}
                  >
                    {insight.status}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Views Chart */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
        >
          <h2 className="text-sm font-semibold">Views by Day</h2>
          <div className="flex items-end gap-3 h-32">
            {mockMetrics.map((metric, i) => {
              const height = (metric.views / maxViews) * 100;
              const day = new Date(metric.date).toLocaleDateString("en", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              return (
                <div key={metric.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[11px] text-muted-foreground tabular-nums">{metric.views}</span>
                  <div className="w-full flex items-end justify-center h-24">
                    <motion.div
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ delay: 0.4 + i * 0.05, duration: 0.5 }}
                      style={{ height: `${height}%`, transformOrigin: "bottom" }}
                      className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-info to-info/60 hover:opacity-80 transition-opacity cursor-pointer"
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground">{day}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </PageContainer>
  );
}
