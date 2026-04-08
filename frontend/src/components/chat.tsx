"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send, Loader2, Sparkles, Search, Trash2, Wrench,
  CheckCircle2, Heart, Zap, Settings2, ExternalLink, Database,
  Eye, User, ImageIcon, Brain,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { apiFetch, API_BASE } from "@/lib/api";
import { getPlatform } from "@/lib/platforms";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  action?: ActionResult;
  onboardingProfile?: Record<string, unknown>;
  toolData?: Record<string, unknown>;
  timestamp?: string;
}

interface ActionResult {
  type: string;
  status: "running" | "completed" | "failed" | "queued";
  detail?: string;
}

interface ChatProps {
  mode: "onboarding" | "general";
  onSummary?: (summary: Record<string, unknown>) => void;
  initialMessage?: string;
}

/* ============================================
   Tool config
   ============================================ */
const toolIcons: Record<string, React.ElementType> = {
  generate: Sparkles, search: Search, approve: CheckCircle2, publish: Zap,
  heartbeat: Heart, setup_platform: Wrench, update_brand: Settings2,
  save_onboarding: CheckCircle2, query_drafts: Database, generate_image: ImageIcon,
  recall_training: Brain,
};

const toolBorderColors: Record<string, string> = {
  generate: "border-accent/[0.12]", search: "border-info/[0.12]", approve: "border-success/[0.12]",
  publish: "border-info/[0.12]", heartbeat: "border-warning/[0.12]", setup_platform: "border-warning/[0.12]",
  update_brand: "border-accent/[0.12]", save_onboarding: "border-success/[0.12]", query_drafts: "border-info/[0.12]",
  generate_image: "border-accent/[0.12]", recall_training: "border-warning/[0.12]",
};

const toolGradientColors: Record<string, string> = {
  generate: "from-accent/20", search: "from-info/20", approve: "from-success/20",
  publish: "from-info/20", heartbeat: "from-warning/20", setup_platform: "from-warning/20",
  update_brand: "from-accent/20", save_onboarding: "from-success/20", query_drafts: "from-info/20",
  generate_image: "from-accent/20", recall_training: "from-warning/20",
};

const activeLabels: Record<string, string> = {
  generate: "Generate", search: "Search", approve: "Approve", publish: "Publish",
  heartbeat: "Heartbeat", setup_platform: "Setup Platform", update_brand: "Update Brand",
  save_onboarding: "Save Profile", query_drafts: "Query", generate_image: "Image Gen",
  recall_training: "Recalling Training",
};
const doneLabels: Record<string, string> = {
  generate: "Generated", search: "Searched", approve: "Approved", publish: "Published",
  heartbeat: "Heartbeat Done", setup_platform: "Platform Ready", update_brand: "Brand Updated",
  save_onboarding: "Profile Saved", query_drafts: "Queried", generate_image: "Image Ready",
  recall_training: "Training Recalled",
};
const failedLabels: Record<string, string> = {
  generate: "Generation Failed", search: "Search Failed", approve: "Approval Failed",
  publish: "Publish Failed", heartbeat: "Heartbeat Failed", setup_platform: "Setup Failed",
  update_brand: "Update Failed", save_onboarding: "Save Failed", query_drafts: "Query Failed",
  generate_image: "Image Failed", recall_training: "Recall Failed",
};

/* ============================================
   Static Agent Orb — always yellow, no animation
   ============================================ */
function AgentOrbStatic() {
  return (
    <div className="relative w-9 h-9 shrink-0 mt-0.5">
      <div className="absolute -inset-3.5 rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_55/0.04),transparent_70%)]" style={{ opacity: 0.4 }} />
      <div className="absolute inset-0 rounded-full border-[1.5px] border-warning/10" />
      <div className="absolute inset-[6px] rounded-full bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_55/0.2),oklch(0.7_0.15_55/0.06))]" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Eye className="h-3.5 w-3.5 text-warning/60" />
      </div>
    </div>
  );
}

/* ============================================
   Mini Orb inside tool cards — shows tool icon, animated when in-progress
   ============================================ */
function MiniOrb({ icon: Icon, isInProgress, isFailed }: { icon: React.ElementType; isInProgress: boolean; isFailed: boolean }) {
  return (
    <div className="relative w-[34px] h-[34px] shrink-0">
      {isInProgress ? <>
        <div className="absolute -inset-2.5 rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_55/0.08),transparent_70%)]" style={{ animation: "orb-halo-breath 2s ease-in-out infinite" }} />
        <div className="absolute inset-0 rounded-full border-[1.5px] border-foreground/5" />
        <div className="absolute -inset-[2px] rounded-full border-[2.5px] border-transparent border-t-warning/70" style={{ animation: "orb-spin 0.9s linear infinite" }} />
        <div className="absolute -inset-[5px] rounded-full border-[2px] border-transparent border-b-warning/30" style={{ animation: "orb-spin-reverse 1.4s linear infinite" }} />
        <div className="absolute inset-[6px] rounded-full bg-warning/15 shadow-[0_0_12px_oklch(0.7_0.15_55/0.2)]" style={{ animation: "orb-core-pulse 1.5s ease-in-out infinite" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-warning/80" />
        </div>
      </> : <>
        <div className="absolute -inset-2.5 rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_55/0.05),transparent_70%)]" style={{ opacity: 0.5 }} />
        <div className="absolute inset-0 rounded-full border-[1.5px] border-warning/10" />
        <div className="absolute inset-[6px] rounded-full bg-warning/8" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon className={`h-3.5 w-3.5 ${isFailed ? "text-danger/60" : "text-success/60"}`} />
        </div>
      </>}
    </div>
  );
}

/* ============================================
   Progress bar — color based on percentage
   ============================================ */
function ProgressBar({ pct }: { pct: number }) {
  const barColor = pct < 30 ? "bg-danger" : pct < 60 ? "bg-warning" : pct < 85 ? "bg-accent" : "bg-success";
  const glowColor = pct < 30 ? "bg-danger/40" : pct < 60 ? "bg-warning/40" : pct < 85 ? "bg-accent/40" : "bg-success/40";
  return (
    <div className="h-[3px] bg-foreground/[0.03] rounded-full overflow-hidden relative">
      <div className={`h-full rounded-full ${barColor} relative transition-all duration-700`} style={{ width: `${pct}%` }}>
        <div className={`absolute right-0 -top-1 -bottom-1 w-10 rounded-full blur-md ${glowColor}`} />
      </div>
    </div>
  );
}

/* ============================================
   ToolCard — new unified style
   ============================================ */
function ToolCard({ msg, mode, onSummary }: { msg: Message; mode: string; onSummary?: (s: Record<string, unknown>) => void }) {
  const action = msg.action!;
  const type = action.type;
  const status = action.status;
  const isFailed = status === "failed";
  const isInProgress = status === "running" || status === "queued";
  const data = msg.toolData || {};

  // For generate/generate_image, use platform icon + color
  const draftPlatform = data.platform ? getPlatform(String(data.platform)) : null;
  const Icon = (type === "generate" || type === "generate_image") && draftPlatform ? draftPlatform.icon : (toolIcons[type] || Sparkles);
  const platformAccent = (type === "generate" || type === "generate_image") && draftPlatform ? draftPlatform.accent : "";

  const bubbleBorder = isFailed ? "border-danger/[0.12]" : !isInProgress ? "border-success/[0.12]" : (toolBorderColors[type] || "border-foreground/[0.07]");
  const bubbleGradient = isFailed ? "from-danger/15" : !isInProgress ? "from-success/15" : (toolGradientColors[type] || "from-accent/15");
  const toolLabel = isFailed ? (failedLabels[type] || "Failed") : !isInProgress ? (doneLabels[type] || "Done") : (activeLabels[type] || type);

  // Split content: "Generating 2 X drafts — Sending to AI model..." → description + phase
  const parts = msg.content.split(" — ");
  const description = parts[0] || msg.content;
  const phase = parts.length > 1 ? parts[1] : (isFailed ? "Failed" : !isInProgress ? "Completed" : "");

  const ToolBubble = ({ children, desc, ph }: { children?: React.ReactNode; desc?: string; ph?: string }) => (
    <div className="flex gap-3">
      <AgentOrbStatic />
      <div className={`flex-1 relative rounded-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl overflow-hidden bg-foreground/[0.04] backdrop-blur-xl border ${bubbleBorder}`}>
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${bubbleGradient} via-transparent to-transparent`} />
        {isInProgress && <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_25%_50%,oklch(0.7_0.15_200/0.03),transparent_55%)]" />}
        <div className="relative p-4 space-y-3">
          <div className="flex items-center gap-2">
            {draftPlatform && (() => { const PI = draftPlatform.icon; return <PI className={`h-4 w-4 ${draftPlatform.accent}`} />; })()}
            <p className={`text-[14px] font-bold ${isFailed ? "text-danger" : !isInProgress ? "text-success" : "text-foreground"}`}>{toolLabel}</p>
            {draftPlatform && <span className={`text-[10px] ${draftPlatform.accent} opacity-60`}>{draftPlatform.label}</span>}
          </div>
          <div className={`rounded-xl overflow-hidden relative ${isInProgress ? "bg-background/30 border border-foreground/[0.04]" : isFailed ? "bg-background/30 border border-danger/[0.06]" : "bg-background/20 border border-foreground/[0.03]"}`}>
            {isInProgress && <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_25%_50%,oklch(0.7_0.15_200/0.04),transparent_55%)]" style={{ animation: "agent-pulse 8s ease-in-out infinite" }} />}
            <div className="relative p-3.5 space-y-2.5">
              <div className="flex items-center gap-3">
                <MiniOrb icon={Icon} isInProgress={isInProgress} isFailed={isFailed} />
                <span className="text-[12.5px] text-foreground/80 flex-1">{desc || description}</span>
                <span className={`text-[9px] px-2.5 py-[3px] rounded-xl font-mono uppercase tracking-[0.5px] shrink-0 ${isFailed ? "bg-danger/10 text-danger" : isInProgress ? "bg-accent/10 text-accent" : "bg-success/10 text-success"}`}
                  style={isInProgress ? { animation: "badge-pulse 2s ease infinite" } : undefined}>{status}</span>
              </div>
              {(ph || phase) && (
                <div className="h-[22px] relative overflow-hidden">
                  <div className="absolute left-0 top-0 flex items-center gap-1.5 text-[11.5px] text-muted-foreground whitespace-nowrap" style={{ animation: "status-line-enter 0.4s ease both" }}>
                    <span style={isFailed ? { color: "var(--danger)" } : !isInProgress ? { color: "var(--success)" } : undefined}>{ph || phase}</span>
                    {isInProgress && <span className="inline-flex gap-[3px] items-center">{[0, 0.15, 0.3].map((d, i) => <span key={i} className="w-[3px] h-[3px] rounded-full bg-current" style={{ animation: `dots-bounce 1.4s ease infinite ${d}s` }} />)}</span>}
                  </div>
                </div>
              )}
              {isInProgress && <ProgressBar pct={60} />}
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground/40 font-mono">
                <span className={isFailed ? "text-danger" : isInProgress ? "text-warning" : "text-success"}>{isInProgress ? "60%" : isFailed ? "error" : "done"}</span>
                <span className="w-px h-2 bg-foreground/5" />
                {!isInProgress && !isFailed && (type === "generate" || type === "generate_image") ? (
                  <a href={data.draft_ids && (data.draft_ids as string[]).length > 0 ? `/drafts/${(data.draft_ids as string[])[0]}` : data.draft_id ? `/drafts/${data.draft_id}` : "/drafts"} className="text-accent hover:underline cursor-pointer" onClick={(e) => {
                    if (!data.draft_ids && !data.draft_id && data.job_id) {
                      e.preventDefault();
                      apiFetch<{ result_payload?: { draft_ids?: string[] } }>(`/v1/jobs/${data.job_id}`).then((r) => {
                        const ids = r.result_payload?.draft_ids;
                        if (ids && ids.length > 0) window.location.href = `/drafts/${ids[0]}`;
                        else window.location.href = "/drafts";
                      }).catch(() => { window.location.href = "/drafts"; });
                    }
                  }}>view</a>
                ) : !isInProgress && !isFailed && type === "recall_training" ? (
                  <a href="/training" className="text-accent hover:underline cursor-pointer">view</a>
                ) : (
                  <span>{isInProgress ? "est. 3s" : isFailed ? "failed" : "completed"}</span>
                )}
              </div>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );

  // === Search results ===
  if (type === "search" && status === "completed" && data.results) {
    const results = data.results as Array<{ title: string; url: string; description: string }>;
    return (
      <ToolBubble desc={`Found ${results.length} results for "${String(data.query || "")}"`} ph="Search complete">
        <div className="rounded-lg bg-background/30 border border-foreground/[0.04] p-3 space-y-2.5">
          {results.slice(0, 5).map((r, i) => (
            <div key={i} className="space-y-0.5">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[12px] font-medium text-foreground hover:text-accent transition-colors">{r.title}</a>
              <p className="text-[11px] text-muted-foreground line-clamp-1">{r.description}</p>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent/50 hover:text-accent flex items-center gap-1 truncate transition-colors">
                <ExternalLink className="h-2.5 w-2.5 shrink-0" />{r.url}
              </a>
            </div>
          ))}
        </div>
      </ToolBubble>
    );
  }

  // === Publish with URL ===
  if (type === "publish" && status === "completed" && data.url) {
    return (
      <ToolBubble desc="Published successfully." ph="Live on platform">
        <a href={String(data.url)} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-success/5 border border-success/10 px-3 py-2 text-[12px] text-success hover:bg-success/10 transition-colors">
          <Zap className="h-3.5 w-3.5" /><span className="truncate flex-1">{String(data.url)}</span><ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      </ToolBubble>
    );
  }

  // === Setup platform ===
  if (type === "setup_platform" && status === "completed" && data.profile) {
    const profile = data.profile as Record<string, unknown>;
    const firstPosts = profile.first_posts as Array<Record<string, unknown>> | undefined;
    return (
      <ToolBubble desc="Platform profile generated." ph="Profile saved">
        <div className="rounded-lg bg-background/30 border border-foreground/[0.04] p-3 space-y-1.5 text-[12px]">
          {[["Name", profile.display_name], ["Handle", profile.handle], ["Bio", profile.bio], ["Topics", profile.topics], ["Strategy", profile.content_strategy]]
            .filter(([, v]) => !!v).map(([label, value]) => (
              <div key={String(label)}><span className="text-muted-foreground">{String(label)}:</span> <span className="text-foreground ml-1">{String(value)}</span></div>
            ))}
        </div>
        {firstPosts && firstPosts.length > 0 && (
          <div className="text-[11px] space-y-0.5">
            <span className="text-muted-foreground/60 font-medium">Starter posts queued:</span>
            {firstPosts.map((p, i) => <p key={i} className="text-foreground/70">{String(p.concept)}</p>)}
          </div>
        )}
      </ToolBubble>
    );
  }

  // === Onboarding summary ===
  if (type === "save_onboarding" && msg.onboardingProfile) {
    const p = msg.onboardingProfile;
    const rows: [string, string][] = [];
    if (p.platforms) rows.push(["Platforms", Array.isArray(p.platforms) ? (p.platforms as string[]).join(", ") : String(p.platforms)]);
    if (p.content_types) rows.push(["Content", Array.isArray(p.content_types) ? (p.content_types as string[]).join(", ") : String(p.content_types)]);
    if (p.frequency) rows.push(["Frequency", String(p.frequency)]);
    if (p.audience) rows.push(["Audience", String(p.audience)]);
    if (p.voice) rows.push(["Voice", String(p.voice)]);
    if (p.goals) rows.push(["Goal", String(p.goals)]);
    if (p.inspiration) rows.push(["Inspired by", String(p.inspiration)]);
    return (
      <ToolBubble desc="Brand profile saved." ph="Onboarding complete">
        <div className="rounded-lg bg-background/30 border border-success/[0.08] p-3 space-y-1.5 text-[12px]">
          {rows.map(([label, value]) => (
            <div key={label}><span className="text-muted-foreground">{label}:</span> <span className="text-foreground ml-1">{value}</span></div>
          ))}
        </div>
        {mode === "onboarding" && (
          <div className="flex items-center gap-2">
            <button onClick={() => { localStorage.setItem("rf_onboarded", "true"); window.location.href = "/rebel"; }}
              className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
              <CheckCircle2 className="h-3 w-3" />Accept & Go to Rebel
            </button>
            <button className="rounded-lg border border-foreground/[0.06] px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">Continue Setup</button>
          </div>
        )}
      </ToolBubble>
    );
  }

  // === Query results ===
  if (type === "query_drafts" && status === "completed" && data.results) {
    const results = data.results as Array<Record<string, string>>;
    return (
      <ToolBubble desc={`Found ${results.length} drafts.`} ph="Query complete">
        <div className="rounded-lg bg-background/30 border border-foreground/[0.04] p-3 space-y-2">
          {results.slice(0, 5).map((r, i) => (
            <div key={i} className="text-[11px] flex items-center gap-2">
              <span className="text-accent font-medium shrink-0">{r.platform}</span>
              <span className="text-muted-foreground/50 shrink-0">{r.status}</span>
              <span className="text-foreground/70 truncate flex-1">{r.concept || r.caption}</span>
            </div>
          ))}
        </div>
      </ToolBubble>
    );
  }

  // === Generate with image — draft card + image status card ===
  if (!isInProgress && !isFailed && (type === "generate_image" || type === "generate")) {
    const imgStatus = data.image_status as string | undefined; // "generating" | "ready" | "failed" | undefined
    const hasImage = !!data.image_url;
    const hasMediaJob = !!(data.media_job_ids && (data.media_job_ids as string[]).length > 0);
    const showImageCard = hasImage || hasMediaJob || imgStatus;

    if (showImageCard) {
      const imgFailed = imgStatus === "failed";
      const imgReady = hasImage || imgStatus === "ready";
      const imgGenerating = !imgReady && !imgFailed;

      return (
        <ToolBubble desc={description} ph={imgReady ? (phase || "Completed") : imgFailed ? "Image failed" : "Draft ready"}>
          {/* Image status card */}
          <div className={`rounded-xl overflow-hidden relative ${imgReady ? "bg-background/20 border border-success/[0.06]" : imgFailed ? "bg-background/20 border border-danger/[0.06]" : "bg-background/30 border border-accent/5"}`}>
            {imgGenerating && <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_25%_50%,oklch(0.7_0.15_200/0.04),transparent_55%)]" style={{ animation: "agent-pulse 8s ease-in-out infinite" }} />}
            <div className="relative p-3.5 space-y-2.5">
              <div className="flex items-center gap-3">
                <MiniOrb icon={ImageIcon} isInProgress={imgGenerating} isFailed={imgFailed} />
                <span className="text-[12.5px] text-foreground/80 flex-1">
                  {imgReady ? "Image ready" : imgFailed ? "Image generation failed" : "Generating image via fal.ai"}
                </span>
                <span className={`text-[9px] px-2.5 py-[3px] rounded-xl font-mono uppercase tracking-[0.5px] shrink-0 ${imgReady ? "bg-success/10 text-success" : imgFailed ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent"}`}
                  style={imgGenerating ? { animation: "badge-pulse 2s ease infinite" } : undefined}>
                  {imgReady ? "ready" : imgFailed ? "failed" : "generating"}
                </span>
              </div>
              {imgGenerating && (
                <>
                  <div className="h-[22px] relative overflow-hidden">
                    <div className="absolute left-0 top-0 flex items-center gap-1.5 text-[11.5px] text-muted-foreground whitespace-nowrap" style={{ animation: "status-line-enter 0.4s ease both" }}>
                      <span>Processing image</span>
                      <span className="inline-flex gap-[3px] items-center">{[0, 0.15, 0.3].map((d, i) => <span key={i} className="w-[3px] h-[3px] rounded-full bg-current" style={{ animation: `dots-bounce 1.4s ease infinite ${d}s` }} />)}</span>
                    </div>
                  </div>
                  <ProgressBar pct={45} />
                </>
              )}
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground/40 font-mono">
                <span className={imgReady ? "text-success" : imgFailed ? "text-danger" : "text-warning"}>
                  {imgReady ? "done" : imgFailed ? "error" : "processing"}
                </span>
                <span className="w-px h-2 bg-foreground/5" />
                {imgReady ? (
                  <button onClick={() => { if (data.image_url) window.open(String(data.image_url), "_blank"); }} className="text-accent hover:underline cursor-pointer">preview image</button>
                ) : imgFailed ? (
                  <span>image unavailable</span>
                ) : (
                  <span>polling media job</span>
                )}
              </div>
            </div>
          </div>
          {/* Thumbnail when ready */}
          {imgReady && hasImage && (
            <button onClick={() => window.open(String(data.image_url), "_blank")} className="rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity">
              <img src={String(data.image_url)} alt="Generated" className="max-h-36 object-cover rounded-lg" />
            </button>
          )}
        </ToolBubble>
      );
    }
  }

  // === Recall training ===
  if (type === "recall_training" && status === "completed") {
    const plat = getPlatform(String(data.platform || ""));
    const PIcon = plat.icon;
    return (
      <ToolBubble desc={`Recalled training for ${plat.label}.`} ph="Training loaded">
        <div className="rounded-lg bg-background/30 border border-warning/[0.08] p-3 space-y-1.5 text-[12px]">
          <div className="flex items-center gap-2">
            <PIcon className={`h-3.5 w-3.5 ${plat.accent}`} />
            <span className="font-medium">{plat.label} Voice</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span>{String(data.corrections_count || 0)} corrections</span>
            {Boolean(data.has_style_guide) && <span className="text-success">style guide loaded</span>}
            {Boolean(data.has_style_learning) && <span className="text-info">writing patterns loaded</span>}
            {!data.corrections_count && !data.has_style_guide && !data.has_style_learning && (
              <span className="text-muted-foreground/50">no training data yet</span>
            )}
          </div>
        </div>
      </ToolBubble>
    );
  }

  // === Error ===
  if (isFailed) {
    return (
      <ToolBubble>
        {type === "publish" && <a href="/drafts" className="text-[11px] text-accent hover:underline">Go to Content to approve first</a>}
      </ToolBubble>
    );
  }

  // === Default (in-progress or completed) ===
  return <ToolBubble />;
}

/* ============================================
   Chat component — logic unchanged, rendering updated
   ============================================ */
const TOOL_TYPE_MAP: Record<string, string> = {
  generate_drafts: "generate", generate: "generate",
  web_search: "search", search: "search",
  approve_draft: "approve", approve: "approve",
  publish_draft: "publish", publish: "publish",
  run_heartbeat: "heartbeat", heartbeat: "heartbeat",
  setup_platform: "setup_platform", update_brand: "update_brand",
  save_onboarding: "save_onboarding", query_drafts: "query_drafts",
  generate_image: "generate_image",
  recall_training: "recall_training",
};

export function Chat({ mode, onSummary, initialMessage }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    async function loadHistory() {
      try {
        const data = await apiFetch<Array<{ role: string; content: string; tool_name?: string | null; tool_result?: Record<string, unknown> | null; created_at?: string }>>(`/v1/conversations?mode=${mode}&limit=50`);
        if (data && data.length > 0) {
          const msgs: Message[] = [];
          for (const m of data) {
            const ts = m.created_at || "";
            if (m.tool_name) {
              const rawResult = m.tool_result;
              // tool_result can be an array (multi-tool chain) or a single object
              const resultArray = Array.isArray(rawResult) ? rawResult as Record<string, unknown>[] : null;

              if (resultArray && resultArray.length > 1) {
                // Multi-tool chain with full data for each tool
                for (const tr of resultArray) {
                  const toolType = tr.type as string || "";
                  const normalizedType = TOOL_TYPE_MAP[toolType] || toolType;
                  const trStatus = (tr.status === "error" || tr.status === "failed") ? "failed" as const : "completed" as const;
                  msgs.push({
                    role: "system",
                    content: (tr.summary as string) || (tr.message as string) || normalizedType,
                    action: { type: normalizedType, status: trStatus },
                    toolData: tr,
                    timestamp: ts,
                  });
                }
              } else {
                // Single tool or legacy format — use tool_name to split
                const toolNames = m.tool_name.split(",").map((t: string) => t.trim()).filter(Boolean);
                const tr = (resultArray ? resultArray[0] : rawResult) || {};

                if (toolNames.length > 1 && !resultArray) {
                  // Legacy: comma-separated names but single result object
                  for (const tn of toolNames) {
                    const normalizedType = TOOL_TYPE_MAP[tn] || tn;
                    const isLast = tn === toolNames[toolNames.length - 1];
                    const toolData = isLast ? tr : { type: normalizedType, status: "completed", summary: tn.replace(/_/g, " ") };
                    const trStatus = isLast && (tr.status === "error" || tr.status === "failed") ? "failed" as const : "completed" as const;
                    msgs.push({
                      role: "system",
                      content: isLast ? m.content : tn.replace(/_/g, " "),
                      action: { type: normalizedType, status: trStatus },
                      toolData: toolData as Record<string, unknown>,
                      timestamp: ts,
                    });
                  }
                } else {
                  const normalizedType = TOOL_TYPE_MAP[toolNames[0]] || toolNames[0];
                  const trStatus = (tr.status === "error" || tr.status === "failed") ? "failed" as const : "completed" as const;
                  msgs.push({
                    role: "system",
                    content: m.content,
                    action: { type: normalizedType, status: trStatus },
                    toolData: tr as Record<string, unknown>,
                    timestamp: ts,
                  });
                }
              }
            } else {
              msgs.push({ role: m.role as Message["role"], content: m.content, timestamp: ts });
            }
          }
          setMessages(msgs);

          // Backfill image_url for generate tools that have draft_ids but no image
          for (const msg of msgs) {
            if ((msg.action?.type === "generate" || msg.action?.type === "generate_image") && msg.toolData) {
              const td = msg.toolData;
              const draftIds = td.draft_ids as string[] | undefined;
              const platform = String(td.platform || "");
              if (draftIds?.length && !td.image_url && (platform === "instagram" || td.generate_image)) {
                apiFetch<{ image_url?: string }>(`/v1/drafts/${draftIds[0]}`).then((d) => {
                  if (d.image_url) {
                    setMessages((prev) => prev.map((pm) =>
                      pm.toolData === td ? { ...pm, toolData: { ...td, image_url: d.image_url } } : pm
                    ));
                  }
                }).catch(() => {});
              }
            }
          }
        } else if (initialMessage) {
          setMessages([{ role: "assistant", content: initialMessage }]);
        }
      } catch {
        if (initialMessage) setMessages([{ role: "assistant", content: initialMessage }]);
      }
    }
    loadHistory();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function clearChat() {
    setMessages(initialMessage ? [{ role: "assistant", content: initialMessage }] : []);
  }

  function pollJob(jobId: string, count: number, platform: string) {
    const steps = ["Sending to AI model...", "AI is thinking...", "Generating content...", "Building drafts...", "Almost there..."];
    const poll = async (attempts = 0) => {
      if (attempts > 60) { setMessages((p) => p.map((m) => m.action?.detail === jobId ? { ...m, content: "Timed out.", action: { ...m.action!, status: "failed" as const } } : m)); return; }
      const idx = Math.min(Math.floor(attempts / 3), steps.length - 1);
      setMessages((p) => p.map((m) => m.action?.detail === jobId && (m.action.status === "running" || m.action.status === "queued") ? { ...m, content: `Generating ${count} ${platform} drafts — ${steps[idx]}` } : m));
      try {
        const r = await apiFetch<{ status: string; error_message?: string; result_payload?: { draft_ids?: string[]; media_job_ids?: string[]; image_url?: string } }>(`/v1/jobs/${jobId}`);
        if (r.status === "completed") {
          const draftIds = r.result_payload?.draft_ids || [];
          const mediaJobIds = r.result_payload?.media_job_ids || [];
          let imageUrl = r.result_payload?.image_url || "";

          // Mark draft as complete
          setMessages((p) => p.map((m) => m.action?.detail === jobId ? {
            ...m,
            content: `Done! ${count} ${platform === "image" ? "image" : "drafts"} created.`,
            action: { ...m.action!, status: "completed" as const },
            toolData: { ...m.toolData, draft_ids: draftIds, media_job_ids: mediaJobIds, image_url: imageUrl, image_status: mediaJobIds.length > 0 ? "generating" : undefined },
          } : m));

          // Persist draft result to DB
          apiFetch("/v1/conversations/tool-result", {
            method: "PATCH",
            body: JSON.stringify({ job_id: jobId, tool_result: { job_id: jobId, draft_ids: draftIds, media_job_ids: mediaJobIds, image_url: imageUrl, platform, count, type: platform === "image" ? "generate_image" : "generate", status: "completed" } }),
          }).catch(() => {});

          // If there's a media job, poll IT directly for image completion
          if (mediaJobIds.length > 0) {
            const pollMediaJob = async (mediaJobId: string, attempt = 0) => {
              if (attempt > 30) {
                // Timed out — mark image as failed
                setMessages((p) => p.map((m) => m.action?.detail === jobId ? { ...m, toolData: { ...m.toolData, image_status: "failed" } } : m));
                return;
              }
              try {
                const mr = await apiFetch<{ status: string; result_payload?: { image_url?: string } }>(`/v1/jobs/${mediaJobId}`);
                if (mr.status === "completed") {
                  const imgUrl = mr.result_payload?.image_url || "";
                  // Also fetch from draft detail as backup
                  let finalUrl = imgUrl;
                  if (!finalUrl && draftIds.length > 0) {
                    try {
                      const dd = await apiFetch<{ image_url?: string }>(`/v1/drafts/${draftIds[0]}`);
                      finalUrl = dd.image_url || "";
                    } catch {}
                  }
                  setMessages((p) => p.map((m) => m.action?.detail === jobId ? { ...m, toolData: { ...m.toolData, image_url: finalUrl, image_status: finalUrl ? "ready" : "failed" } } : m));
                  // Persist updated image URL
                  if (finalUrl) {
                    apiFetch("/v1/conversations/tool-result", {
                      method: "PATCH",
                      body: JSON.stringify({ job_id: jobId, tool_result: { job_id: jobId, draft_ids: draftIds, media_job_ids: mediaJobIds, image_url: finalUrl, platform, count, type: "generate", status: "completed", image_status: "ready" } }),
                    }).catch(() => {});
                  }
                } else if (mr.status === "failed") {
                  setMessages((p) => p.map((m) => m.action?.detail === jobId ? { ...m, toolData: { ...m.toolData, image_status: "failed" } } : m));
                } else {
                  // Still running — poll again
                  setTimeout(() => pollMediaJob(mediaJobId, attempt + 1), 3000);
                }
              } catch {
                setTimeout(() => pollMediaJob(mediaJobId, attempt + 1), 5000);
              }
            };
            pollMediaJob(mediaJobIds[0]);
          }
        }
        else if (r.status === "failed") { setMessages((p) => p.map((m) => m.action?.detail === jobId ? { ...m, content: r.error_message || "Failed", action: { ...m.action!, status: "failed" as const } } : m)); }
        else { setTimeout(() => poll(attempts + 1), 3000); }
      } catch { setTimeout(() => poll(attempts + 1), 5000); }
    };
    setTimeout(() => poll(0), 2000);
  }

  async function streamResponse(conversationMessages: Message[]) {
    setStreaming(true);
    let addedPlaceholder = false;
    try {
      const apiMessages = conversationMessages
        .filter((m) => m.role !== "system" || m.action) // keep tool results (system with action), filter plain system messages
        .map((m) => {
          if (m.role === "system" && m.action) {
            // Include tool results as assistant messages so the LLM has context
            const toolInfo = m.toolData ? ` [Result: ${JSON.stringify(m.toolData).slice(0, 500)}]` : "";
            return { role: "assistant" as const, content: `[Tool: ${m.action.type}] ${m.content}${toolInfo}` };
          }
          return { role: m.role, content: m.content };
        });
      const token = typeof window !== "undefined" ? localStorage.getItem("rf_token") : null;
      const res = await fetch(`${API_BASE}/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ messages: apiMessages, mode }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      if (!reader) throw new Error("No reader");
      let fullContent = "";
      let hasContent = false;
      let skipNextContent = false;
      let lineBuffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() || ""; // keep incomplete last line in buffer
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.tool_result) {
              const tr = parsed.tool_result;
              const trType = TOOL_TYPE_MAP[tr.type as string] || (tr.type as string);
              const trSummary = (tr.summary as string) || (tr.message as string) || trType;
              const trRawStatus = (tr.status as string) || "completed";
              const trStatus = (trRawStatus === "error" ? "failed" : trRawStatus) as ActionResult["status"];

              let toolMsg: Message;
              if (trType === "generate") {
                toolMsg = { role: "system", content: trSummary, timestamp: new Date().toISOString(), action: { type: "generate", status: "queued", detail: tr.job_id as string }, toolData: tr };
              } else if (trType === "generate_image") {
                toolMsg = { role: "system", content: trSummary, timestamp: new Date().toISOString(), action: { type: "generate_image", status: "queued", detail: tr.job_id as string }, toolData: tr };
              } else if (trType === "heartbeat") {
                const hbId = `hb_${Date.now()}`;
                toolMsg = { role: "system", content: trSummary, timestamp: new Date().toISOString(), action: { type: "heartbeat", status: "running", detail: hbId }, toolData: tr };
              } else if (trType === "save_onboarding") {
                const profile = tr.profile as Record<string, unknown> | undefined;
                toolMsg = { role: "system", content: trSummary, timestamp: new Date().toISOString(), action: { type: "save_onboarding", status: trStatus }, toolData: tr, onboardingProfile: profile };
                if (profile && trStatus === "completed" && onSummary) onSummary({ summary: true, ...profile });
              } else {
                toolMsg = { role: "system", content: trSummary, timestamp: new Date().toISOString(), action: { type: trType, status: trStatus }, toolData: tr };
              }

              setMessages((p) => {
                const base = (addedPlaceholder && !hasContent && p.length > 0 && p[p.length - 1].role === "assistant" && p[p.length - 1].content === "")
                  ? p.slice(0, -1) : p;
                addedPlaceholder = false;
                return [...base, toolMsg];
              });

              if (trType === "generate" && toolMsg.action?.detail) {
                pollJob(toolMsg.action.detail, (tr.count as number) || 2, (tr.platform as string) || "instagram");
              }
              if (trType === "generate_image" && toolMsg.action?.detail) {
                pollJob(toolMsg.action.detail, 1, "image");
              }
              if (trType === "heartbeat" && toolMsg.action?.detail) {
                const hbId = toolMsg.action.detail;
                const hbSteps = ["Scout researching...", "Analyzing results...", "Reviewing posts...", "Generating drafts...", "Almost done..."];
                const pollHb = async (attempts = 0) => {
                  if (attempts > 40) { setMessages((p) => p.map((m) => m.action?.detail === hbId ? { ...m, content: "Heartbeat timed out.", action: { ...m.action!, status: "failed" as const } } : m)); return; }
                  setMessages((p) => p.map((m) => m.action?.detail === hbId && m.action.status === "running" ? { ...m, content: `Heartbeat — ${hbSteps[Math.min(Math.floor(attempts / 4), hbSteps.length - 1)]}` } : m));
                  try {
                    const s = await apiFetch<{ last_run: string | null; last_result?: Record<string, unknown> }>("/v1/heartbeat/status");
                    if (s.last_run && s.last_result) {
                      const t = new Date(s.last_run).getTime();
                      if (t > parseInt(hbId.split("_")[1])) {
                        const dc = (s.last_result as Record<string, unknown>).drafts_created || 0;
                        const sc = (s.last_result as Record<string, unknown>).scout as Record<string, unknown> | undefined;
                        const trends = Array.isArray(sc?.trends) ? (sc.trends as string[]).slice(0, 3).join(", ") : "";
                        setMessages((p) => p.map((m) => m.action?.detail === hbId ? { ...m, content: `Heartbeat done! ${dc} drafts.${trends ? ` Trends: ${trends}` : ""}`, action: { ...m.action!, status: "completed" as const } } : m));
                        return;
                      }
                    }
                    setTimeout(() => pollHb(attempts + 1), 5000);
                  } catch { setTimeout(() => pollHb(attempts + 1), 5000); }
                };
                setTimeout(() => pollHb(0), 3000);
              }

              skipNextContent = true;
              fullContent = "";
              hasContent = false;
            } else if (parsed.content) {
              if (skipNextContent) { skipNextContent = false; continue; }
              fullContent += parsed.content;
              hasContent = true;
              addedPlaceholder = true;
              setMessages((p) => {
                const last = p[p.length - 1];
                if (last && last.role === "assistant") {
                  const u = [...p];
                  u[u.length - 1] = { role: "assistant", content: fullContent, timestamp: new Date().toISOString() };
                  return u;
                }
                return [...p, { role: "assistant", content: fullContent, timestamp: new Date().toISOString() }];
              });
            }
            if (parsed.onboarding_summary && onSummary) {
              try { const s = typeof parsed.onboarding_summary === "string" ? JSON.parse(parsed.onboarding_summary) : parsed.onboarding_summary; if (s.summary) onSummary(s); } catch {}
            }
          } catch {}
        }
      }
      if (mode === "onboarding" && onSummary && fullContent && fullContent.includes("```json")) {
        const m = fullContent.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (m) { try { const s = JSON.parse(m[1]); if (s.summary) { onSummary(s); setMessages((p) => { const u = [...p]; u[u.length - 1] = { role: "assistant", content: fullContent.replace(/```json[\s\S]*?```/g, "").trim() }; return u; }); } } catch {} }
      }
    } catch {
      setMessages((p) => { const u = [...p]; u[u.length - 1] = { role: "assistant", content: "Couldn't connect. Is the LLM running?" }; return u; });
    } finally {
      setStreaming(false);
      // Auto-focus input after response
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  async function handleSend() {
    if (!input.trim() || streaming) return;
    const newMsgs = [...messages, { role: "user" as const, content: input.trim(), timestamp: new Date().toISOString() }];
    setMessages(newMsgs);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await streamResponse(newMsgs);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  return (
    <div className="relative flex flex-col h-full min-h-0 bg-background overflow-hidden">
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-1/4 -left-1/4 w-[60%] h-[60%] rounded-full bg-accent/8 blur-[120px] animate-float" />
        <div className="absolute -bottom-1/4 -right-1/4 w-[50%] h-[50%] rounded-full bg-info/8 blur-[120px] animate-float" style={{ animationDelay: "-3s", animationDirection: "reverse" }} />
      </div>

      <div className="relative flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => {
              // Tool card
              if (msg.role === "system" && msg.action) {
                const tts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }) : "";
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 18, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="space-y-1">
                    <ToolCard msg={msg} mode={mode} onSummary={onSummary} />
                    {tts && <span className="text-[9px] text-muted-foreground/30 tabular-nums ml-12">{tts}</span>}
                  </motion.div>
                );
              }

              // System message
              if (msg.role === "system") {
                return (
                  <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
                    <span className="text-[12px] text-muted-foreground/60 bg-muted/20 backdrop-blur-md border border-border/10 rounded-md px-3 py-1.5">{msg.content}</span>
                  </motion.div>
                );
              }

              // User bubble
              if (msg.role === "user") {
                const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }) : "";
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 18, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-0 rounded-2xl rounded-tl-sm bg-accent text-accent-foreground max-w-[80%]">
                      <p className="text-[13px] whitespace-pre-wrap leading-relaxed px-4 py-2">{msg.content}</p>
                      <div className="flex h-full items-center border-l border-accent-foreground/20 px-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-foreground/15">
                          <User className="h-3 w-3" />
                        </div>
                      </div>
                    </div>
                    {ts && <span className="text-[9px] text-muted-foreground/30 tabular-nums mr-1">{ts}</span>}
                  </motion.div>
                );
              }

              // Assistant bubble
              {
                const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }) : "";
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 18, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="flex gap-3">
                    <AgentOrbStatic />
                    <div className="flex flex-col gap-1">
                      <div className="relative rounded-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl px-4 py-2.5 max-w-[80%] bg-foreground/[0.04] backdrop-blur-xl border border-foreground/[0.07] overflow-hidden">
                        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-accent/15 via-transparent to-transparent" />
                        <p className="text-[13px] whitespace-pre-wrap leading-[1.75]">{msg.content}</p>
                      </div>
                      {ts && <span className="text-[9px] text-muted-foreground/30 tabular-nums ml-1">{ts}</span>}
                    </div>
                  </motion.div>
                );
              }
            })}
          </AnimatePresence>

          {/* Streaming dots */}
          {streaming && messages[messages.length - 1]?.role !== "assistant" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <AgentOrbStatic />
              <div className="rounded-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl px-4 py-3 bg-foreground/[0.04] backdrop-blur-xl border border-foreground/[0.07]">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-warning/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-warning/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="relative shrink-0 border-t border-border/30 bg-surface px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <button onClick={clearChat} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Clear chat">
            <Trash2 className="h-4 w-4" />
          </button>
          <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={mode === "onboarding" ? "Tell me about your brand..." : "Ask anything or say 'generate 3 posts about...'"}
            className="flex-1 min-h-9 max-h-32 rounded-md border border-input bg-background px-4 py-2 text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
            rows={1} disabled={streaming} />
          <button onClick={handleSend} disabled={!input.trim() || streaming}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-40">
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
