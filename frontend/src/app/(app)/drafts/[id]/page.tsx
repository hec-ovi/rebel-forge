"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2, ArrowLeft, CheckCircle2, Zap, ExternalLink,
  Copy, X as XIcon, Save,
} from "lucide-react";
import { motion } from "motion/react";
import { PageContainer } from "@/components/common/page-container";
import { getPlatform } from "@/lib/platforms";
import { apiFetch } from "@/lib/api";

interface DraftDetail {
  id: string;
  platform: string;
  status: string;
  concept: string;
  caption: string;
  hook: string;
  cta: string;
  hashtags: string[];
  alt_text: string;
  media_prompt: string | null;
  script: string | null;
  image_url: string | null;
  published_url: string | null;
  published_at: string | null;
  platform_post_id: string | null;
  created_at: string;
  updated_at: string;
}

const statusStyles: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  draft:     { label: "Draft",     color: "text-warning",  bg: "bg-warning/10",  border: "border-warning/20", dot: "bg-warning" },
  reviewed:  { label: "Reviewed",  color: "text-info",     bg: "bg-info/10",     border: "border-info/20",    dot: "bg-info" },
  approved:  { label: "Approved",  color: "text-success",  bg: "bg-success/10",  border: "border-success/20", dot: "bg-success" },
  scheduled: { label: "Scheduled", color: "text-info",     bg: "bg-info/10",     border: "border-info/20",    dot: "bg-info" },
  published: { label: "Published", color: "text-accent",   bg: "bg-accent/10",   border: "border-accent/20",  dot: "bg-accent" },
  failed:    { label: "Failed",    color: "text-danger",   bg: "bg-danger/10",   border: "border-danger/20",  dot: "bg-danger" },
};

export default function DraftDetailPage() {
  const params = useParams();
  const router = useRouter();
  const draftId = params.id as string;
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState("");
  const [copied, setCopied] = useState(false);
  const [editedCaption, setEditedCaption] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<DraftDetail>(`/v1/drafts/${draftId}`)
      .then((d) => { setDraft(d); setEditedCaption(d.caption); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [draftId]);

  const isEditable = draft && draft.status !== "published" && draft.status !== "failed";
  const isPublished = draft?.status === "published";
  const isX = draft?.platform === "x";

  // Calculate tweet length for X (caption + hashtags)
  const tweetLength = (() => {
    if (!draft || !isX) return 0;
    const tags = (draft.hashtags || []).slice(0, 5).map((t) => `#${t.replace(/^#/, "")}`).join(" ");
    const full = tags ? `${editedCaption}\n\n${tags}` : editedCaption;
    return full.length;
  })();
  const isOverLimit = isX && tweetLength > 280;

  const handleCaptionChange = (val: string) => {
    setEditedCaption(val);
    setDirty(val !== draft?.caption);
  };

  const handleSaveEdits = async () => {
    if (!draft || !dirty) return;
    setSaving(true);
    try {
      await apiFetch(`/v1/drafts/${draftId}`, {
        method: "PUT",
        body: JSON.stringify({ caption: editedCaption }),
      });
      setDraft((d) => d ? { ...d, caption: editedCaption, status: d.status === "approved" ? "draft" : d.status } : d);
      setDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  };

  const handleApprove = async () => {
    setActing("approve");
    try {
      await apiFetch(`/v1/drafts/${draftId}/approve`, {
        method: "POST",
        ...(dirty ? { body: JSON.stringify({ caption: editedCaption }) } : {}),
      });
      setDraft((d) => d ? { ...d, status: "approved", caption: dirty ? editedCaption : d.caption } : d);
      setDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(""); }
  };

  const handleReject = async () => {
    setActing("reject");
    try {
      await apiFetch(`/v1/drafts/${draftId}/reject`, { method: "POST" });
      router.push("/drafts");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(""); }
  };

  const handlePublish = async () => {
    setActing("publish");
    try {
      const res = await apiFetch<{ success: boolean; url?: string; error?: string }>(`/v1/drafts/${draftId}/publish?platform=${draft?.platform}`, { method: "POST" });
      if (res.success) {
        setDraft((d) => d ? { ...d, status: "published", published_url: res.url || null } : d);
      } else { setError(res.error || "Publish failed"); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setActing(""); }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(editedCaption || draft?.caption || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error && !draft) return <div className="flex items-center justify-center h-64"><p className="text-danger">{error}</p></div>;
  if (!draft) return null;

  const plat = getPlatform(draft.platform);
  const PlatIcon = plat.icon;
  const st = statusStyles[draft.status] || statusStyles.draft;

  return (
    <PageContainer className="!p-0 flex flex-col">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex-1 flex flex-col px-5 py-4 space-y-4">
        {/* Back */}
        <button onClick={() => router.push("/drafts")} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Content
        </button>

        {/* === THE CARD === */}
        <div className={`rounded-sm border overflow-hidden bg-card flex-1 flex flex-col`} style={{ borderColor: `var(--${plat.id === "custom" ? "border" : `platform-${draft.platform}`})`, borderTopWidth: "3px" }}>
          {/* Card header: platform + concept */}
          <div className="flex items-center gap-3 px-5 py-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${plat.bg}`}>
              <PlatIcon className={`h-4.5 w-4.5 ${plat.accent}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[15px] font-bold leading-tight truncate">{draft.concept}</h1>
              <span className={`text-[11px] font-medium ${plat.accent}`}>{plat.label}</span>
            </div>
          </div>

          {/* Status band — full width, colored, under header */}
          <div className={`${st.bg} border-y ${st.border} px-5 py-1.5 flex items-center gap-2`}>
            <span className={`h-2 w-2 rounded-full ${st.dot}`} />
            <span className={`text-[10px] font-bold uppercase tracking-wider ${st.color}`}>{st.label}</span>
          </div>

          {/* Image */}
          {draft.image_url && (
            <div className="border-b border-border/10">
              <img src={draft.image_url} alt={draft.alt_text || draft.concept} className="w-full object-cover max-h-[350px]" />
            </div>
          )}

          {/* Content — editable if draft/approved, read-only if published */}
          <div className="px-5 py-4 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Post Content</span>
              <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors">
                {copied ? <CheckCircle2 className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {isEditable ? (
              <textarea
                value={editedCaption}
                onChange={(e) => handleCaptionChange(e.target.value)}
                className="w-full flex-1 min-h-[100px] rounded-lg border border-border/20 bg-background/50 px-3 py-2.5 text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 resize-none transition-colors"
                placeholder="Write your post content..."
              />
            ) : (
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{draft.caption}</p>
            )}
            {/* X character counter */}
            {isX && (
              <div className="flex items-center justify-between mt-2">
                <span className={`text-[11px] font-mono tabular-nums ${isOverLimit ? "text-danger font-semibold" : tweetLength > 260 ? "text-warning" : "text-muted-foreground/40"}`}>
                  {tweetLength}/280
                </span>
                {isOverLimit && (
                  <span className="text-[11px] text-danger">Exceeds X limit — edit to under 280 characters</span>
                )}
              </div>
            )}
            {/* Hashtags */}
            {draft.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-3">
                {draft.hashtags.map((tag, i) => (
                  <span key={i} className="text-[10px] text-accent bg-accent/8 rounded-full px-2 py-0.5">{tag}</span>
                ))}
              </div>
            )}
          </div>

          {/* Footer: hook, cta, details — all in one section */}
          <div className="border-t border-border/10 px-5 py-3 bg-muted/5 space-y-3">
            {(draft.hook || draft.cta) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.hook && (
                  <div className="rounded-lg bg-background/50 border border-border/10 px-3 py-2">
                    <span className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Hook</span>
                    <p className="text-[12px] text-foreground/70 mt-1 leading-relaxed">{draft.hook}</p>
                  </div>
                )}
                {draft.cta && (
                  <div className="rounded-lg bg-background/50 border border-border/10 px-3 py-2">
                    <span className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Call to Action</span>
                    <p className="text-[12px] text-foreground/70 mt-1 leading-relaxed">{draft.cta}</p>
                  </div>
                )}
              </div>
            )}
            {/* Details row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wider">Created</span>
                <p className="text-[11px] text-foreground/50 mt-0.5 tabular-nums">{draft.created_at ? new Date(draft.created_at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wider">Platform</span>
                <p className={`text-[11px] mt-0.5 font-medium ${plat.accent}`}>{plat.label}</p>
              </div>
              <div>
                <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wider">ID</span>
                <p className="text-[11px] text-foreground/50 mt-0.5 font-mono">{draft.id.slice(0, 8)}</p>
              </div>
              {draft.published_at ? (
                <div>
                  <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wider">Published</span>
                  <p className="text-[11px] text-foreground/50 mt-0.5 tabular-nums">{new Date(draft.published_at).toLocaleDateString("en", { month: "short", day: "numeric" })} {new Date(draft.published_at).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              ) : (
                <div>
                  <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wider">Status</span>
                  <p className={`text-[11px] mt-0.5 font-medium ${st.color}`}>{st.label}</p>
                </div>
              )}
            </div>
            {draft.media_prompt && (
              <div>
                <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wider">Image Prompt</span>
                <p className="text-[11px] text-foreground/40 mt-0.5">{draft.media_prompt}</p>
              </div>
            )}
            {draft.alt_text && (
              <div>
                <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wider">Alt Text</span>
                <p className="text-[11px] text-foreground/40 mt-0.5">{draft.alt_text}</p>
              </div>
            )}
          </div>

          {/* Actions — inside the card, at the very bottom */}
          <div className="border-t border-border/10 px-5 py-3 flex items-center gap-2">
            {/* DIRTY — any editable status: only Save as Draft */}
            {dirty && isEditable && (
              <>
                <button onClick={handleSaveEdits} disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-warning/80 px-4 py-2 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save as Draft
                </button>
                <span className="text-[10px] text-warning">
                  {draft.status === "approved" ? "Modified — needs re-approval" : "Unsaved changes"}
                </span>
                <div className="flex-1" />
                <button onClick={() => { setEditedCaption(draft.caption); setDirty(false); }}
                  className="flex items-center gap-1.5 rounded-lg bg-info/80 px-4 py-2 text-[11px] font-semibold text-white hover:opacity-90">
                  <XIcon className="h-3 w-3" />Undo Changes
                </button>
              </>
            )}

            {/* CLEAN DRAFT — Approve or Reject */}
            {draft.status === "draft" && !dirty && (
              <>
                <button onClick={handleApprove} disabled={!!acting || isOverLimit}
                  className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {acting === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Approve
                </button>
                <div className="flex-1" />
                <button onClick={handleReject} disabled={!!acting}
                  className="flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {acting === "reject" ? <Loader2 className="h-3 w-3 animate-spin" /> : <XIcon className="h-3 w-3" />}
                  Reject
                </button>
              </>
            )}

            {/* CLEAN APPROVED — Publish or Reject */}
            {draft.status === "approved" && !dirty && (
              <>
                <button onClick={handlePublish} disabled={!!acting || isOverLimit}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[11px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                  {acting === "publish" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Publish to {plat.label}
                </button>
                <div className="flex-1" />
                <button onClick={handleReject} disabled={!!acting}
                  className="flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  {acting === "reject" ? <Loader2 className="h-3 w-3 animate-spin" /> : <XIcon className="h-3 w-3" />}
                  Reject
                </button>
              </>
            )}

            {/* PUBLISHED — View Live */}
            {isPublished && draft.published_url && (
              <a href={draft.published_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/20 px-4 py-2 text-[11px] font-medium text-accent hover:bg-accent/15">
                <ExternalLink className="h-3 w-3" />View Live Post
              </a>
            )}

            {error && <span className="text-[10px] text-danger ml-auto">{error}</span>}
          </div>
        </div>
      </motion.div>
    </PageContainer>
  );
}
