"use client";

import { useState, useRef, useCallback, useEffect, useMemo, Suspense, type FormEvent } from "react";
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
  Share2,
  Copy,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { DraftCard } from "@/components/widgets/draft-card";
import { platformList } from "@/lib/platforms";
import { apiFetch } from "@/lib/api";
import { useDrafts } from "@/hooks/use-api";
import type { Draft } from "@/lib/types";
import { useAuthRole } from "@/hooks/use-auth-role";

const ITEMS_PER_PAGE = 12;
const JOB_POLL_DELAY_MS = 3000;
const JOB_INITIAL_POLL_DELAY_MS = 0;
const JOB_MAX_POLL_ATTEMPTS = 40;

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

function createDefaultFilters(): Filters {
  return {
    search: "",
    platforms: new Set(platformList.map((p) => p.id)),
    statuses: new Set(allStatuses.map((s) => s.id)),
    dateFrom: "",
    dateTo: "",
  };
}

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
      aria-pressed={active}
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
  const [generationError, setGenerationError] = useState("");
  const [showGenerationForm, setShowGenerationForm] = useState(false);
  const [generationFormError, setGenerationFormError] = useState("");
  const [generationPlatform, setGenerationPlatform] = useState("instagram");
  const [generationCount, setGenerationCount] = useState("2");
  const [generationObjective, setGenerationObjective] = useState("increase engagement");
  const [generationBrief, setGenerationBrief] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [columns, setColumns] = useState(2);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(createDefaultFilters);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const role = useAuthRole();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const filtered = useMemo(() => {
    let list = drafts.filter((d) => matchesFilters(d, filters));
    if (filterDraftId) list = list.filter((d) => d.id === filterDraftId);
    return list;
  }, [drafts, filters, filterDraftId]);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const filtersActive = hasActiveFilters(filters);

  const loadMore = useCallback(() => { if (hasMore) setVisibleCount((v) => v + ITEMS_PER_PAGE); }, [hasMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) loadMore(); }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const updateFilters = (updater: (previous: Filters) => Filters) => {
    setVisibleCount(ITEMS_PER_PAGE);
    setFilters(updater);
  };

  const togglePlatform = (id: string) => updateFilters((prev) => {
    const allSelected = prev.platforms.size === platformList.length;
    const onlyThis = prev.platforms.size === 1 && prev.platforms.has(id);
    if (allSelected || !prev.platforms.has(id)) return { ...prev, platforms: new Set([id]) };
    if (onlyThis) return { ...prev, platforms: new Set(platformList.map((p) => p.id)) };
    return { ...prev, platforms: new Set([id]) };
  });
  const toggleStatus = (id: string) => updateFilters((prev) => {
    const allSelected = prev.statuses.size === allStatuses.length;
    const onlyThis = prev.statuses.size === 1 && prev.statuses.has(id);
    if (allSelected || !prev.statuses.has(id)) return { ...prev, statuses: new Set([id]) };
    if (onlyThis) return { ...prev, statuses: new Set(allStatuses.map((s) => s.id)) };
    return { ...prev, statuses: new Set([id]) };
  });
  const setSearch = (value: string) => updateFilters((previous) => ({ ...previous, search: value }));
  const setDateFrom = (value: string) => updateFilters((previous) => ({ ...previous, dateFrom: value }));
  const setDateTo = (value: string) => updateFilters((previous) => ({ ...previous, dateTo: value }));
  const clearFilters = () => updateFilters(() => createDefaultFilters());
  const selectAllPlatforms = () => updateFilters((previous) => ({ ...previous, platforms: new Set(platformList.map((platform) => platform.id)) }));
  const clearAllPlatforms = () => updateFilters((previous) => ({ ...previous, platforms: new Set() }));
  const selectAllStatuses = () => updateFilters((previous) => ({ ...previous, statuses: new Set(allStatuses.map((status) => status.id)) }));
  const clearAllStatuses = () => updateFilters((previous) => ({ ...previous, statuses: new Set() }));

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const count = Number(generationCount);
    const objective = generationObjective.trim();
    const brief = generationBrief.trim();
    if (!platformList.some((platform) => platform.id === generationPlatform)) {
      setGenerationFormError("Choose a supported platform.");
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 7) {
      setGenerationFormError("Draft count must be a whole number from 1 to 7.");
      return;
    }
    if (!objective) {
      setGenerationFormError("Objective is required.");
      return;
    }

    setGenerating(true);
    setGenerationError("");
    setGenerationFormError("");
    try {
      const job = await apiFetch<{ id: string }>("/v1/drafts/generate", {
        method: "POST",
        body: JSON.stringify({
          platform: generationPlatform,
          objective,
          count,
          ...(brief ? { brief } : {}),
        }),
      });
      setShowGenerationForm(false);
      const schedulePoll = (attempt: number, delay: number) => {
        pollTimeoutRef.current = setTimeout(() => void poll(attempt), delay);
      };
      const poll = async (attempt: number) => {
        try {
          const result = await apiFetch<{ status: string; error_message?: string | null }>(`/v1/jobs/${job.id}`);
          if (!mountedRef.current) return;
          if (result.status === "completed") {
            await refresh();
            if (mountedRef.current) setGenerating(false);
          } else if (result.status === "failed") {
            setGenerationError(result.error_message || "Draft generation failed.");
            setGenerating(false);
          } else if (attempt >= JOB_MAX_POLL_ATTEMPTS) {
            setGenerationError("Draft generation is taking too long. Check Activity for the job status.");
            setGenerating(false);
          } else {
            schedulePoll(attempt + 1, JOB_POLL_DELAY_MS);
          }
        } catch (caught) {
          if (!mountedRef.current) return;
          if (attempt >= JOB_MAX_POLL_ATTEMPTS) {
            setGenerationError(caught instanceof Error ? caught.message : "Could not check the generation job.");
            setGenerating(false);
          } else {
            schedulePoll(attempt + 1, JOB_POLL_DELAY_MS);
          }
        }
      };
      schedulePoll(1, JOB_INITIAL_POLL_DELAY_MS);
    } catch (caught) {
      setGenerationFormError(caught instanceof Error ? caught.message : "Could not start draft generation.");
      setGenerating(false);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    setShareError("");
    setShareCopied(false);
    try {
      const result = await apiFetch<{ share_id: string; url: string }>("/v1/share", {
        method: "POST",
        body: JSON.stringify({ expires_hours: 72 }),
      });
      setShareUrl(new URL(`/share/${encodeURIComponent(result.share_id)}`, window.location.origin).toString());
    } catch (caught) {
      setShareError(caught instanceof Error ? caught.message : "Could not create a review link.");
    } finally {
      setSharing(false);
    }
  };

  const handleCopyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
    } catch {
      setShareError("Could not copy the link. Select and copy it manually.");
    }
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
            {role === "owner" && (
              <>
                <button onClick={handleShare} disabled={sharing} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                  {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                  {sharing ? "Creating link..." : "Share pending"}
                </button>
                <button onClick={() => { setGenerationError(""); setGenerationFormError(""); setShowGenerationForm(true); }} disabled={generating} className="flex items-center gap-1.5 rounded-md gradient-accent px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {generating ? "Generating..." : "Generate"}
                </button>
              </>
            )}
            <button onClick={refresh} aria-label="Refresh drafts" className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {showGenerationForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="generate-drafts-title">
            <form noValidate onSubmit={handleGenerate} className="w-full max-w-lg space-y-4 rounded-xl border border-border/50 bg-card p-5 shadow-2xl">
              <div>
                <h2 id="generate-drafts-title" className="text-base font-semibold">Generate drafts</h2>
                <p className="mt-1 text-xs text-muted-foreground">Create queued drafts for one supported publishing platform.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="generation-platform" className="mb-1 block text-xs font-medium">Platform</label>
                  <select id="generation-platform" value={generationPlatform} onChange={(event) => setGenerationPlatform(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
                    {platformList.map((platform) => <option key={platform.id} value={platform.id}>{platform.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="generation-count" className="mb-1 block text-xs font-medium">Draft count</label>
                  <input id="generation-count" type="number" min={1} max={7} step={1} value={generationCount} onChange={(event) => setGenerationCount(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label htmlFor="generation-objective" className="mb-1 block text-xs font-medium">Objective</label>
                <input id="generation-objective" value={generationObjective} onChange={(event) => setGenerationObjective(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="generation-brief" className="mb-1 block text-xs font-medium">Brief (optional)</label>
                <textarea id="generation-brief" value={generationBrief} onChange={(event) => setGenerationBrief(event.target.value)} rows={4} placeholder="Add campaign details, constraints, or a specific angle." className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm" />
              </div>
              {generationFormError && <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">{generationFormError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowGenerationForm(false)} disabled={generating} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={generating} className="flex items-center gap-1.5 rounded-md gradient-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {generating ? "Starting..." : "Start generation"}
                </button>
              </div>
            </form>
          </div>
        )}

        {generationError && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{generationError}</p>}
        {shareError && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{shareError}</p>}
        {shareUrl && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-success/30 bg-success/5 p-3">
            <label htmlFor="share-review-link" className="text-xs font-semibold text-success">Review link</label>
            <input id="share-review-link" aria-label="Share review link" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs" />
            <button type="button" onClick={handleCopyShare} className="flex items-center gap-1.5 rounded-md bg-success px-3 py-1.5 text-xs font-semibold text-white">
              {shareCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {shareCopied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}

        {/* Search + filter toggle + columns */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input type="search" value={filters.search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drafts..." aria-label="Search drafts"
              className="w-full rounded-md border border-border bg-surface-raised/30 pl-9 pr-8 py-2 text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/30 transition-all" />
            {filters.search && (
              <button onClick={() => setSearch("")} aria-label="Clear draft search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <button onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-controls="draft-filters"
            className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-[12px] font-medium transition-all ${
              showFilters || filtersActive ? "border-accent/30 bg-accent/10 text-accent" : "border-border text-muted-foreground hover:text-foreground"
            }`}>
            <SlidersHorizontal className="h-3.5 w-3.5" />Filters
            {filtersActive && !showFilters && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-foreground">!</span>}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-0.5 rounded-md bg-surface-raised/50 p-0.5">
            {columnOptions.map((opt) => (
              <button key={opt.cols} onClick={() => setColumns(opt.cols)} aria-label={`${opt.label} view`} aria-pressed={columns === opt.cols}
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
              <div id="draft-filters" className="rounded-md border border-border/30 bg-surface-raised/20 p-4 space-y-4">
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
                    <input type="date" value={filters.dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Created from"
                      className="rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30" />
                    <span className="text-[11px] text-muted-foreground">to</span>
                    <input type="date" value={filters.dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="Created through"
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
