"use client";

import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  LayoutGrid,
  List,
  Columns3,
  Search,
  SlidersHorizontal,
  X,
  CalendarDays,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { DraftCard } from "@/components/widgets/draft-card";
import { platformList, getPlatform } from "@/lib/platforms";
import { apiFetch } from "@/lib/api";
import { useDrafts } from "@/hooks/use-api";
import type { Draft } from "@/lib/types";

const ITEMS_PER_PAGE = 12;

const allStatuses = [
  { id: "draft", label: "Pending" },
  { id: "reviewed", label: "Reviewed" },
  { id: "approved", label: "Approved" },
  { id: "scheduled", label: "Scheduled" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
];

const columnOptions = [
  { cols: 1, icon: List, label: "List" },
  { cols: 2, icon: LayoutGrid, label: "Grid" },
  { cols: 3, icon: Columns3, label: "3 Col" },
];

const colClasses: Record<number, string> = {
  1: "",
  2: "lg:[columns:2]",
  3: "md:[columns:2] xl:[columns:3]",
};

interface Filters {
  search: string;
  platforms: Set<string>;
  statuses: Set<string>;
  dateFrom: string;
  dateTo: string;
}

const defaultFilters: Filters = {
  search: "",
  platforms: new Set(platformList.map((p) => p.id)),
  statuses: new Set(allStatuses.map((s) => s.id)),
  dateFrom: "",
  dateTo: "",
};

function matchesFilters(d: Draft, f: Filters): boolean {
  if (!f.statuses.has(d.status)) return false;
  if (!f.platforms.has(d.platform)) return false;
  if (f.dateFrom && d.created_at && new Date(d.created_at) < new Date(f.dateFrom)) return false;
  if (f.dateTo && d.created_at) {
    const to = new Date(f.dateTo);
    to.setHours(23, 59, 59, 999);
    if (new Date(d.created_at) > to) return false;
  }
  if (f.search) {
    const q = f.search.toLowerCase();
    const haystack = [d.concept, d.caption, d.hook, d.cta, d.platform, d.status, ...d.hashtags, d.media_prompt, d.script || ""].join(" ").toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function hasActiveFilters(f: Filters): boolean {
  return f.search !== "" || f.platforms.size !== platformList.length || f.statuses.size !== allStatuses.length || f.dateFrom !== "" || f.dateTo !== "";
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium border transition-all ${
        active ? "bg-accent/15 border-accent/30 text-accent" : "bg-transparent border-border/30 text-muted-foreground/50 hover:text-muted-foreground hover:border-border/50"
      }`}
    >
      {children}
    </button>
  );
}

export default function DraftsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <DraftsPageInner />
    </Suspense>
  );
}

function DraftsPageInner() {
  const searchParams = useSearchParams();
  const filterDraftId = searchParams.get("id");
  const { drafts, loading, error, refresh, setDrafts } = useDrafts();
  const [generating, setGenerating] = useState(false);
  const [columns, setColumns] = useState(2);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    let list = drafts.filter((d) => matchesFilters(d, filters));
    if (filterDraftId) list = list.filter((d) => d.id === filterDraftId);
    return list;
  }, [drafts, filters, filterDraftId]);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const filtersActive = hasActiveFilters(filters);

  useEffect(() => { setVisibleCount(ITEMS_PER_PAGE); }, [filters]);

  const loadMore = useCallback(() => { if (hasMore) setVisibleCount((v) => v + ITEMS_PER_PAGE); }, [hasMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) loadMore(); }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const togglePlatform = (id: string) => setFilters((prev) => {
    const allSelected = prev.platforms.size === platformList.length;
    const onlyThis = prev.platforms.size === 1 && prev.platforms.has(id);
    if (allSelected || !prev.platforms.has(id)) return { ...prev, platforms: new Set([id]) };
    if (onlyThis) return { ...prev, platforms: new Set(platformList.map((p) => p.id)) };
    return { ...prev, platforms: new Set([id]) };
  });
  const toggleStatus = (id: string) => setFilters((prev) => {
    const allSelected = prev.statuses.size === allStatuses.length;
    const onlyThis = prev.statuses.size === 1 && prev.statuses.has(id);
    if (allSelected || !prev.statuses.has(id)) return { ...prev, statuses: new Set([id]) };
    if (onlyThis) return { ...prev, statuses: new Set(allStatuses.map((s) => s.id)) };
    return { ...prev, statuses: new Set([id]) };
  });
  const setSearch = (v: string) => setFilters((prev) => ({ ...prev, search: v }));
  const setDateFrom = (v: string) => setFilters((prev) => ({ ...prev, dateFrom: v }));
  const setDateTo = (v: string) => setFilters((prev) => ({ ...prev, dateTo: v }));
  const clearFilters = () => setFilters(defaultFilters);
  const selectAllPlatforms = () => setFilters((prev) => ({ ...prev, platforms: new Set(platformList.map((p) => p.id)) }));
  const clearAllPlatforms = () => setFilters((prev) => ({ ...prev, platforms: new Set() }));
  const selectAllStatuses = () => setFilters((prev) => ({ ...prev, statuses: new Set(allStatuses.map((s) => s.id)) }));
  const clearAllStatuses = () => setFilters((prev) => ({ ...prev, statuses: new Set() }));

  /* ============================================
     Optimistic actions — update local state first, then API
     ============================================ */
  const handleApprove = async (id: string, editedCaption?: string) => {
    // Optimistic: update draft status locally
    setDrafts((prev) =>
      prev.map((d) => d.id === id ? { ...d, status: "approved" as const, caption: editedCaption || d.caption } : d)
    );
    try {
      await apiFetch(`/v1/drafts/${id}/approve`, {
        method: "POST",
        body: JSON.stringify(editedCaption ? { caption: editedCaption } : {}),
      });
    } catch (e) {
      console.error("Approve failed:", e);
      refresh(); // revert on error
    }
  };

  const handleReject = async (id: string) => {
    // Optimistic: remove draft from list
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    try {
      await apiFetch(`/v1/drafts/${id}/reject`, { method: "POST" });
    } catch (e) {
      console.error("Reject failed:", e);
      refresh(); // revert on error
    }
  };

  const handlePublish = async (id: string, platform: string = "x") => {
    // Optimistic: update status to published
    setDrafts((prev) =>
      prev.map((d) => d.id === id ? { ...d, status: "published" as const } : d)
    );
    try {
      const result = await apiFetch<{ success: boolean; url?: string; error?: string }>(
        `/v1/drafts/${id}/publish?platform=${platform}`,
        { method: "POST" }
      );
      if (!result.success) {
        // Revert
        setDrafts((prev) =>
          prev.map((d) => d.id === id ? { ...d, status: "approved" as const } : d)
        );
        alert(`Publish failed: ${result.error}`);
      }
    } catch (e) {
      refresh();
      alert(`Publish error: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const job = await apiFetch<{ id: string }>("/v1/drafts/generate", {
        method: "POST",
        body: JSON.stringify({ platform: "instagram", objective: "increase engagement", count: 2, brief: "Create engaging content that fits the brand voice" }),
      });
      const poll = async () => {
        const result = await apiFetch<{ status: string }>(`/v1/jobs/${job.id}`);
        if (result.status === "completed") { await refresh(); setGenerating(false); }
        else if (result.status === "failed") { setGenerating(false); }
        else { setTimeout(poll, 3000); }
      };
      setTimeout(poll, 5000);
    } catch (e) { console.error("Generate failed:", e); setGenerating(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (error) {
    return <div className="flex items-center justify-center h-64"><div className="text-center space-y-2"><AlertCircle className="h-6 w-6 text-danger mx-auto" /><p className="text-sm text-muted-foreground">{error}</p></div></div>;
  }

  return (
    <PageContainer>
      <div className="space-y-4">
        {/* Title + actions */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1>Content</h1>
            <p className="text-sm text-muted-foreground">Review, edit, approve, and publish your content.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleGenerate} disabled={generating} className="flex items-center gap-1.5 rounded-md gradient-accent px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "Generating..." : "Generate"}
            </button>
            <button onClick={refresh} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Search + filter toggle + columns */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input type="text" value={filters.search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drafts..."
              className="w-full rounded-md border border-border bg-surface-raised/30 pl-9 pr-8 py-2 text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/30 transition-all" />
            {filters.search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-[12px] font-medium transition-all ${
              showFilters || filtersActive ? "border-accent/30 bg-accent/10 text-accent" : "border-border text-muted-foreground hover:text-foreground"
            }`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />Filters
            {filtersActive && !showFilters && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-foreground">!</span>}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 rounded-md bg-surface-raised/50 p-0.5">
            {columnOptions.map((opt) => (
              <button key={opt.cols} onClick={() => setColumns(opt.cols)} title={opt.label}
                className={`flex h-7 w-7 items-center justify-center rounded transition-all ${columns === opt.cols ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                <opt.icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        </div>

        {/* Advanced filter panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
              <div className="rounded-md border border-border/30 bg-surface-raised/20 p-4 space-y-4">
                {/* Status */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Status</span>
                    <div className="flex gap-2 text-[10px]">
                      <button onClick={selectAllStatuses} className="text-accent hover:underline">All</button>
                      <button onClick={clearAllStatuses} className="text-muted-foreground hover:underline">None</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allStatuses.map((s) => (
                      <ToggleChip key={s.id} active={filters.statuses.has(s.id)} onClick={() => toggleStatus(s.id)}>{s.label}</ToggleChip>
                    ))}
                  </div>
                </div>

                {/* Platforms — real icons */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">Platform</span>
                    <div className="flex gap-2 text-[10px]">
                      <button onClick={selectAllPlatforms} className="text-accent hover:underline">All</button>
                      <button onClick={clearAllPlatforms} className="text-muted-foreground hover:underline">None</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {platformList.map((p) => {
                      const Icon = p.icon;
                      return (
                        <ToggleChip key={p.id} active={filters.platforms.has(p.id)} onClick={() => togglePlatform(p.id)}>
                          <Icon className="h-3 w-3" />
                          {p.label}
                        </ToggleChip>
                      );
                    })}
                  </div>
                </div>

                {/* Date range */}
                <div>
                  <span className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2 block">
                    <CalendarDays className="inline h-3 w-3 mr-1" />Date range
                  </span>
                  <div className="flex items-center gap-2">
                    <input type="date" value={filters.dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                      className="rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    <span className="text-[11px] text-muted-foreground">to</span>
                    <input type="date" value={filters.dateTo} onChange={(e) => setDateTo(e.target.value)}
                      className="rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    {(filters.dateFrom || filters.dateTo) && (
                      <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-[11px] text-muted-foreground hover:text-foreground">Clear</button>
                    )}
                  </div>
                </div>

                {filtersActive && (
                  <div className="pt-1 border-t border-border/20">
                    <button onClick={clearFilters} className="text-[11px] text-accent hover:underline">Reset all filters</button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <p className="text-[11px] text-muted-foreground/50">
          {filtered.length} of {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}{filtersActive && " (filtered)"}
        </p>

        {/* Grid */}
        {visible.length === 0 ? (
          <div className="rounded-md border border-border/20 bg-card py-16 text-center">
            <p className="text-sm text-muted-foreground">{filtersActive ? "No drafts match your filters." : "No drafts yet."}</p>
            {filtersActive && <button onClick={clearFilters} className="mt-2 text-xs text-accent hover:underline">Clear filters</button>}
          </div>
        ) : (
          <motion.div variants={staggerContainer} initial="initial" animate="animate" className={`[column-gap:1rem] ${colClasses[columns] || colClasses[2]}`}>
            <AnimatePresence mode="popLayout">
              {visible.map((draft) => (
                <motion.div key={draft.id} variants={staggerItem} exit={{ opacity: 0, scale: 0.97 }} className="break-inside-avoid mb-4">
                  <DraftCard draft={draft} onDelete={(id) => setDrafts((prev) => prev.filter((d) => d.id !== id))} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}

        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
