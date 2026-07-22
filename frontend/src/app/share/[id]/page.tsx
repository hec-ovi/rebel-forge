"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api";

interface SharedDraft {
  id: string;
  platform: string;
  status: string;
  concept: string;
  caption: string;
  hook: string;
  cta: string;
  hashtags: string[];
  media_prompt: string | null;
}

interface SharedContent {
  share_id: string;
  expires_at: string;
  drafts: SharedDraft[];
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    let message = response.status === 410 ? "This share link has expired." : "This share link is invalid or no longer available.";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
        message = body.detail;
      }
    } catch {
      // Keep the status-specific fallback for non-JSON errors.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export default function SharedReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [content, setContent] = useState<SharedContent | null>(null);
  const [error, setError] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    publicRequest<SharedContent>(`/v1/share/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(setContent)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Could not load this share link.");
      });
    return () => controller.abort();
  }, [id]);

  const approve = async (draftId: string) => {
    setApprovingId(draftId);
    setApprovalErrors((previous) => ({ ...previous, [draftId]: "" }));
    try {
      await publicRequest<{ status: string }>(
        `/v1/share/${encodeURIComponent(id)}/approve/${encodeURIComponent(draftId)}`,
        { method: "POST" },
      );
      setContent((previous) => previous ? {
        ...previous,
        drafts: previous.drafts.map((draft) =>
          draft.id === draftId ? { ...draft, status: "approved" } : draft,
        ),
      } : previous);
    } catch (caught) {
      setApprovalErrors((previous) => ({
        ...previous,
        [draftId]: caught instanceof Error ? caught.message : "Could not approve this draft.",
      }));
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Rebel Forge</p>
          <h1 className="text-2xl font-bold">Content review</h1>
          {content && (
            <p className="text-sm text-muted-foreground">
              This review link expires <time dateTime={content.expires_at}>{new Date(content.expires_at).toLocaleString()}</time>.
            </p>
          )}
        </header>

        {!content && !error && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-border/50 bg-card p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading shared drafts...
          </div>
        )}

        {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-sm text-danger">{error}</div>}

        {content && content.drafts.length === 0 && (
          <p className="rounded-lg border border-border/50 bg-card p-4 text-sm text-muted-foreground">No drafts are available in this review.</p>
        )}

        {content?.drafts.map((draft) => {
          const canApprove = draft.status === "draft" || draft.status === "reviewed";
          return (
            <article key={draft.id} className="space-y-4 rounded-xl border border-border/50 bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-accent">{draft.platform}</p>
                  <h2 className="mt-1 text-lg font-semibold">{draft.concept || "Untitled draft"}</h2>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">{draft.status}</span>
              </div>

              {draft.hook && <p className="font-medium">{draft.hook}</p>}
              <p className="whitespace-pre-wrap text-sm leading-6">{draft.caption}</p>
              {draft.cta && <p className="text-sm"><span className="font-semibold">Call to action:</span> {draft.cta}</p>}
              {draft.hashtags.length > 0 && <p className="text-sm text-accent">{draft.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" ")}</p>}
              {draft.media_prompt && <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground"><span className="font-semibold">Media direction:</span> {draft.media_prompt}</p>}

              {canApprove ? (
                <button
                  type="button"
                  onClick={() => approve(draft.id)}
                  disabled={approvingId === draft.id}
                  className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                >
                  {approvingId === draft.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve draft
                </button>
              ) : draft.status === "approved" ? (
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Approved</p>
              ) : (
                <p className="text-sm font-semibold capitalize text-muted-foreground">Status: {draft.status}</p>
              )}
              {approvalErrors[draft.id] && <p role="alert" className="text-sm text-danger">{approvalErrors[draft.id]}</p>}
            </article>
          );
        })}
      </div>
    </main>
  );
}
