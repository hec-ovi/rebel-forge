"use client";

import { useState } from "react";
import {
  ExternalLink,
  ArrowRight,
  Trash2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getPlatform } from "@/lib/platforms";
import { apiFetch } from "@/lib/api";
import type { Draft } from "@/lib/types";

const statusStyles: Record<string, { dot: string; label: string; text: string }> = {
  draft:     { dot: "bg-warning",  label: "Draft",     text: "text-warning" },
  reviewed:  { dot: "bg-warning",  label: "Reviewed",  text: "text-warning" },
  approved:  { dot: "bg-success",  label: "Approved",  text: "text-success" },
  scheduled: { dot: "bg-info",     label: "Scheduled", text: "text-info" },
  published: { dot: "bg-accent",   label: "Published", text: "text-accent" },
  failed:    { dot: "bg-danger",   label: "Failed",    text: "text-danger" },
};

interface DraftCardProps {
  draft: Draft;
  onDelete?: (id: string) => void;
}

export function DraftCard({ draft, onDelete }: DraftCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const platform = getPlatform(draft.platform);
  const PlatformIcon = platform.icon;
  const status = statusStyles[draft.status] || statusStyles.draft;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiFetch(`/v1/drafts/${draft.id}`, { method: "DELETE" });
      onDelete?.(draft.id);
    } catch {}
    finally { setDeleting(false); setConfirmDelete(false); }
  };

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/30 bg-card hover:border-border/50 transition-colors">
      {/* Delete button — top right, visible on hover, hidden for published */}
      {draft.status !== "published" && !confirmDelete && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(true); }}
          className="absolute top-2 right-2 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-danger/10 text-danger/60 opacity-0 group-hover:opacity-100 hover:bg-danger/20 hover:text-danger transition-all"
          title="Delete draft"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      {/* Delete confirmation overlay */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/90 backdrop-blur-sm"
          >
            <AlertTriangle className="h-5 w-5 text-danger" />
            <p className="text-[12px] font-medium text-foreground">Delete this draft?</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1 rounded-lg bg-danger px-3 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-border/30 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Platform color strip */}
      <div className={`h-[2px] bg-gradient-to-r ${platform.gradient}`} />

      {/* Header: platform icon + concept + platform name + status */}
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${platform.bg}`}>
          <PlatformIcon className={`h-4 w-4 ${platform.accent}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[11px] font-semibold ${platform.accent}`}>{platform.label}</span>
            <span className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              <span className={`text-[10px] font-medium ${status.text}`}>{status.label}</span>
            </span>
            {draft.created_at && (
              <span className="text-[10px] text-muted-foreground/40 ml-auto tabular-nums">
                {new Date(draft.created_at).toLocaleDateString("en", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
          <h3 className="text-[13px] font-semibold leading-snug line-clamp-1">{draft.concept}</h3>
        </div>
      </div>

      {/* Image thumbnail */}
      {draft.image_url && (
        <div className="px-4 pb-2">
          <img src={draft.image_url} alt={draft.alt_text || draft.concept} className="w-full h-28 object-cover rounded-lg" />
        </div>
      )}

      {/* Content preview */}
      <div className="px-4 pb-3">
        <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3">{draft.caption}</p>
      </div>

      {/* Published link */}
      {draft.status === "published" && draft.published_url && (
        <div className="px-4 pb-2">
          <a href={draft.published_url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[10px] text-accent hover:underline truncate">
            <ExternalLink className="h-3 w-3 shrink-0" />{draft.published_url}
          </a>
        </div>
      )}

      {/* Open button — full width, accent colored */}
      <a href={`/drafts/${draft.id}`}
        className="flex items-center justify-center gap-1.5 border-t border-border/20 py-2.5 text-[11px] font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-colors">
        <ArrowRight className="h-3 w-3" /> Open
      </a>
    </div>
  );
}
