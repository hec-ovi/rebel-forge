"use client";

import { useState, useEffect } from "react";
import {
  Loader2, CheckCircle2, AlertCircle, BookOpen, RefreshCw,
  Heart, MessageSquare, Eye, Repeat, ExternalLink,
} from "lucide-react";
import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { platformList, getPlatform } from "@/lib/platforms";
import { apiFetch } from "@/lib/api";

interface FetchedPost {
  platform: string;
  platform_id: string;
  text: string;
  created_at: string;
  permalink?: string;
  media_type?: string;
  metrics: Record<string, number>;
}

interface PlatformTab {
  id: string;
  label: string;
  posts: FetchedPost[];
  loading: boolean;
  error: string;
  learned: boolean;
  learning: boolean;
}

const connectedPlatforms = ["x", "facebook", "instagram", "threads"];

type SortKey = "date" | "views" | "likes" | "engagement";

export default function StyleLearnPage() {
  const [tabs, setTabs] = useState<PlatformTab[]>([]);
  const [activeTab, setActiveTab] = useState("");
  const [initialLoad, setInitialLoad] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("engagement");

  useEffect(() => {
    const initial = connectedPlatforms.map((id) => ({
      id,
      label: getPlatform(id).label,
      posts: [],
      loading: false,
      error: "",
      learned: false,
      learning: false,
    }));
    setTabs(initial);
    setActiveTab(connectedPlatforms[0]);

    // Check which platforms already have style learning
    apiFetch<{ style_learned_platforms?: string[] }>("/v1/training/status")
      .then((d) => {
        const learned = d.style_learned_platforms || [];
        setTabs((prev) => prev.map((t) => ({ ...t, learned: learned.includes(t.id) })));
      })
      .catch(() => {});

    setInitialLoad(false);
  }, []);

  const fetchPosts = async (platformId: string) => {
    setTabs((prev) => prev.map((t) => t.id === platformId ? { ...t, loading: true, error: "" } : t));
    try {
      const data = await apiFetch<{ posts: FetchedPost[]; error?: string }>(`/v1/fetch-posts/${platformId}?limit=50`);
      setTabs((prev) => prev.map((t) => t.id === platformId ? { ...t, posts: data.posts || [], loading: false, error: data.error || "" } : t));
    } catch (e) {
      setTabs((prev) => prev.map((t) => t.id === platformId ? { ...t, loading: false, error: e instanceof Error ? e.message : "Failed" } : t));
    }
  };

  const learnStyle = async (platformId: string) => {
    const tab = tabs.find((t) => t.id === platformId);
    if (!tab || tab.posts.length === 0) return;

    setTabs((prev) => prev.map((t) => t.id === platformId ? { ...t, learning: true } : t));
    try {
      await apiFetch("/v1/training/style-learn", {
        method: "POST",
        body: JSON.stringify({ platform: platformId, posts: tab.posts }),
      });
      setTabs((prev) => prev.map((t) => t.id === platformId ? { ...t, learning: false, learned: true } : t));
    } catch (e) {
      setTabs((prev) => prev.map((t) => t.id === platformId ? { ...t, learning: false, error: e instanceof Error ? e.message : "Failed" } : t));
    }
  };

  const active = tabs.find((t) => t.id === activeTab);

  if (initialLoad) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <PageContainer>
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2"><BookOpen className="h-5 w-5" />Style Learning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Learn your writing style from your existing posts on each platform.</p>
        </div>

        {/* Platform tabs */}
        <div className="flex items-center gap-1 border-b border-border/30 pb-0">
          {tabs.map((tab) => {
            const plat = getPlatform(tab.id);
            const PIcon = plat.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 transition-colors ${
                  isActive
                    ? `${plat.accent} border-current`
                    : "text-muted-foreground/50 border-transparent hover:text-muted-foreground"
                }`}
              >
                <PIcon className="h-3.5 w-3.5" />
                {tab.label}
                {tab.learned && <CheckCircle2 className="h-3 w-3 text-success" />}
              </button>
            );
          })}
        </div>

        {/* Active tab content */}
        {active && (
          <motion.div variants={staggerItem} className="space-y-4">
            {/* Actions bar */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => fetchPosts(active.id)}
                disabled={active.loading}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
              >
                {active.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {active.loading ? "Fetching..." : active.posts.length > 0 ? "Refresh Posts" : "Fetch My Posts"}
              </button>

              {active.posts.length > 0 && (
                <button
                  onClick={() => learnStyle(active.id)}
                  disabled={active.learning}
                  className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {active.learning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                  {active.learning ? "Learning..." : active.learned ? "Re-learn Style" : "Learn Style from Posts"}
                </button>
              )}

              {active.learned && (
                <span className="flex items-center gap-1 text-[11px] text-success font-medium">
                  <CheckCircle2 className="h-3 w-3" />Style learned
                </span>
              )}

              <span className="text-[11px] text-muted-foreground/40 ml-auto">
                {active.posts.length > 0 ? `${active.posts.length} posts loaded` : "No posts loaded yet"}
              </span>
            </div>

            {active.error && (
              <div className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-[12px] text-danger flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />{active.error}
              </div>
            )}

            {/* Sort pills */}
            {active.posts.length > 1 && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground/30 mr-1">Sort:</span>
                {([
                  ["engagement", "Top"],
                  ["views", "Views"],
                  ["likes", "Likes"],
                  ["date", "Recent"],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => setSortBy(key)}
                    className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${sortBy === key ? "bg-accent/10 text-accent font-medium" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Posts list */}
            {active.posts.length > 0 && (
              <div className="space-y-2">
                {[...active.posts].sort((a, b) => {
                  const ma = a.metrics || {};
                  const mb = b.metrics || {};
                  if (sortBy === "views") return (mb.impressions || mb.views || 0) - (ma.impressions || ma.views || 0);
                  if (sortBy === "likes") return (mb.likes || 0) - (ma.likes || 0);
                  if (sortBy === "date") return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
                  // engagement = sum of all metrics
                  const ea = Object.values(ma).reduce((s, v) => s + v, 0);
                  const eb = Object.values(mb).reduce((s, v) => s + v, 0);
                  return eb - ea;
                }).map((post, i) => {
                  const plat = getPlatform(post.platform);
                  const m = post.metrics || {};
                  const totalEngagement = Object.values(m).reduce((a, b) => a + b, 0);

                  return (
                    <motion.div
                      key={post.platform_id || i}
                      variants={staggerItem}
                      className="rounded-lg border border-border/20 bg-card p-3 space-y-2"
                    >
                      {/* Post header */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                          {post.created_at ? new Date(post.created_at).toLocaleDateString("en", { month: "short", day: "numeric" }) : ""}
                        </span>
                        {post.media_type && post.media_type !== "TEXT_POST" && (
                          <span className="text-[9px] bg-accent/10 text-accent rounded px-1.5 py-0.5">{post.media_type}</span>
                        )}
                        {totalEngagement > 0 && (
                          <span className={`text-[10px] font-medium ml-auto ${totalEngagement > 10 ? "text-success" : "text-muted-foreground/50"}`}>
                            {totalEngagement} engagement
                          </span>
                        )}
                      </div>

                      {/* Post text */}
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap line-clamp-4">{post.text}</p>

                      {/* Metrics */}
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
                        {m.impressions !== undefined && m.impressions > 0 && (
                          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{m.impressions}</span>
                        )}
                        {m.views !== undefined && m.views > 0 && (
                          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{m.views}</span>
                        )}
                        {(m.likes || 0) > 0 && (
                          <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{m.likes}</span>
                        )}
                        {(m.comments || m.replies || 0) > 0 && (
                          <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{m.comments || m.replies}</span>
                        )}
                        {(m.retweets || m.reposts || m.shares || 0) > 0 && (
                          <span className="flex items-center gap-1"><Repeat className="h-3 w-3" />{m.retweets || m.reposts || m.shares}</span>
                        )}
                        {post.permalink && (
                          <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-accent/50 hover:text-accent ml-auto">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {active.posts.length === 0 && !active.loading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <BookOpen className="h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-[13px] text-muted-foreground/50">Click "Fetch My Posts" to load your {active.label} posts</p>
                <p className="text-[11px] text-muted-foreground/30 mt-1">The agent will learn your writing style and tone from them</p>
              </div>
            )}
          </motion.div>
        )}
      </motion.div>
    </PageContainer>
  );
}
