"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, X, Clock } from "lucide-react"; // X used in popup
import { motion, AnimatePresence } from "motion/react";
import { PageContainer } from "@/components/common/page-container";
import { useDrafts } from "@/hooks/use-api";
import type { Draft } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const platformDot: Record<string, string> = {
  instagram: "bg-platform-instagram",
  linkedin: "bg-platform-linkedin",
  tiktok: "bg-platform-tiktok",
  facebook: "bg-platform-facebook",
  x: "bg-platform-x",
  threads: "bg-platform-threads",
  youtube: "bg-platform-youtube",
};

const platformLabel: Record<string, string> = {
  x: "𝕏", instagram: "IG", linkedin: "in", tiktok: "TT",
  facebook: "fb", threads: "@", youtube: "YT",
};

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

/* ============================================
   Day detail view — hourly timeline
   ============================================ */
function DayDetail({
  day,
  monthLabel,
  year,
  drafts,
  onClose,
}: {
  day: number;
  monthLabel: string;
  year: number;
  drafts: Draft[];
  onClose: () => void;
}) {
  // Group by hour
  const byHour: Record<number, Draft[]> = {};
  drafts.forEach((d) => {
    if (!d.created_at) return;
    const h = new Date(d.created_at).getHours();
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(d);
  });

  // Only show hours that have content, plus surrounding context
  const activeHours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  const minHour = activeHours.length > 0 ? Math.max(0, activeHours[0] - 1) : 6;
  const maxHour = activeHours.length > 0 ? Math.min(23, activeHours[activeHours.length - 1] + 1) : 22;
  const visibleHours = HOURS.filter((h) => h >= minHour && h <= maxHour);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="relative w-full max-w-lg rounded-lg glass-card border border-border/50 overflow-hidden max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/20">
          <div>
            <h3>{monthLabel} {day}, {year}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {drafts.length} item{drafts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-surface-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </div>


        {/* Hourly timeline */}
        <div className="flex-1 overflow-auto">
          <div className="relative">
            {visibleHours.map((hour) => {
              const hourDrafts = byHour[hour] || [];
              const hasContent = hourDrafts.length > 0;

              return (
                <div
                  key={hour}
                  className={`flex border-b border-border/10 ${
                    hasContent ? "bg-surface-raised/20" : ""
                  }`}
                >
                  {/* Hour label */}
                  <div className="w-16 shrink-0 py-3 px-3 text-right">
                    <span className={`text-[11px] tabular-nums ${
                      hasContent ? "text-foreground font-medium" : "text-muted-foreground/40"
                    }`}>
                      {formatHour(hour)}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 py-2 pr-4 border-l border-border/15 pl-3 min-h-[44px]">
                    {hourDrafts.length > 0 && (
                      <div className="space-y-1.5">
                        {hourDrafts.map((draft) => (
                          <motion.div
                            key={draft.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="rounded-xl bg-surface-raised/50 border border-border/20 p-2.5 space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className={`h-2 w-2 rounded-full ${platformDot[draft.platform] || "bg-muted-foreground"}`} />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {platformLabel[draft.platform] || draft.platform}
                                </span>
                              </div>
                              <span className={`text-[10px] font-medium capitalize ${
                                draft.status === "published" ? "text-success" :
                                draft.status === "approved" || draft.status === "scheduled" ? "text-info" :
                                "text-warning"
                              }`}>
                                {draft.status}
                              </span>
                            </div>
                            <p className="text-[13px] font-medium leading-snug">{draft.concept}</p>
                            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                              {draft.caption}
                            </p>
                            {draft.hashtags.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {draft.hashtags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="rounded-full bg-accent/8 px-1.5 py-0.5 text-[9px] text-accent">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                            {draft.created_at && (
                              <p className="text-[10px] text-muted-foreground/40 tabular-nums">
                                {new Date(draft.created_at).toLocaleTimeString("en", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ============================================
   Calendar page
   ============================================ */
export default function CalendarPage() {
  const { drafts, loading, error } = useDrafts();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();

  const navigate = (dir: number) => {
    setCurrentDate(new Date(year, month + dir));
    setSelectedDay(null);
  };

  const monthLabel = currentDate.toLocaleDateString("en", { month: "long" });
  const monthYearLabel = currentDate.toLocaleDateString("en", { month: "long", year: "numeric" });

  if (loading) {
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

  const draftsByDate: Record<number, Draft[]> = {};
  drafts.forEach((draft) => {
    if (!draft.created_at) return;
    const d = new Date(draft.created_at);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      if (!draftsByDate[day]) draftsByDate[day] = [];
      draftsByDate[day].push(draft);
    }
  });

  // Build cells
  const cells = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(
      <div key={`empty-${i}`} className="h-20 border-r border-b border-border/10" />
    );
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday =
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear();
    const dayDrafts = draftsByDate[day] || [];
    const hasContent = dayDrafts.length > 0;

    cells.push(
      <button
        key={day}
        onClick={() => hasContent ? setSelectedDay(day) : undefined}
        className={`h-20 border-r border-b border-border/10 p-1.5 text-left transition-all ${
          isToday ? "bg-accent/5" : ""
        } ${hasContent ? "hover:bg-surface-raised/40 cursor-pointer" : ""}`}
      >
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
            isToday
              ? "bg-accent text-accent-foreground font-bold"
              : "text-muted-foreground"
          }`}
        >
          {day}
        </span>
        {dayDrafts.length > 0 && (
          <div className="mt-0.5 space-y-0.5">
            {dayDrafts.slice(0, 2).map((draft) => (
              <div
                key={draft.id}
                className="flex items-center gap-1 rounded px-1 py-0.5 bg-surface-raised/40"
              >
                <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${platformDot[draft.platform] || "bg-muted-foreground"}`} />
                <span className="text-[9px] truncate leading-none">{draft.concept}</span>
              </div>
            ))}
            {dayDrafts.length > 2 && (
              <span className="text-[9px] text-accent font-semibold px-1">
                +{dayDrafts.length - 2} more
              </span>
            )}
          </div>
        )}
      </button>
    );
  }

  // All drafts for the selected day (unfiltered so the popup can do its own filtering)
  const allDraftsForDay = selectedDay
    ? drafts.filter((d) => {
        if (!d.created_at) return false;
        const dt = new Date(d.created_at);
        return dt.getDate() === selectedDay && dt.getMonth() === month && dt.getFullYear() === year;
      })
    : [];

  return (
    <PageContainer>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1>Calendar</h1>
            <p className="text-sm text-muted-foreground">
              {drafts.length === 0
                ? "No content yet."
                : `${drafts.length} content items`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold w-36 text-center">
              {monthYearLabel}
            </span>
            <button
              onClick={() => navigate(1)}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/30 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Calendar grid */}
        <div className="rounded-lg border border-border/20 glass-card overflow-hidden">
          <div className="grid grid-cols-7">
            {DAYS.map((day) => (
              <div
                key={day}
                className="border-r border-b border-border/10 bg-surface-raised/20 px-2 py-2 text-[10px] font-semibold text-muted-foreground/50 text-center uppercase tracking-widest"
              >
                {day}
              </div>
            ))}
            {cells}
          </div>
        </div>

        {/* Platform legend */}
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground/50">
          {Object.entries(platformDot)
            .filter(([p]) => drafts.some((d) => d.platform === p))
            .map(([platform, color]) => (
              <div key={platform} className="flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded-full ${color}`} />
                <span className="capitalize">{platform}</span>
              </div>
            ))}
          {drafts.length > 0 && (
            <span className="ml-auto text-muted-foreground/30">
              <Clock className="inline h-3 w-3 mr-1" />
              Click a day to see hourly view
            </span>
          )}
        </div>
      </div>

      {/* Day detail — hourly timeline popup */}
      <AnimatePresence>
        {selectedDay && allDraftsForDay.length > 0 && (
          <DayDetail
            day={selectedDay}
            monthLabel={monthLabel}
            year={year}
            drafts={allDraftsForDay}
            onClose={() => setSelectedDay(null)}
          />
        )}
      </AnimatePresence>
    </PageContainer>
  );
}
