"use client";

import { useState } from "react";
import {
  Send, Loader2, Bot, User, Sparkles, Search, Trash2, Wrench,
  CheckCircle2, XCircle, Clock, Heart, Zap, Settings2, ExternalLink, Database,
  Eye, BrainCircuit, AlertTriangle, FileText, Brain, MessageSquare,
} from "lucide-react";
import { motion } from "motion/react";

/* ============================================
   Types — copied from chat.tsx
   ============================================ */
interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  action?: ActionResult;
  onboardingProfile?: Record<string, unknown>;
  toolData?: Record<string, unknown>;
}

interface ActionResult {
  type: string;
  status: "running" | "completed" | "failed" | "queued";
  detail?: string;
}

/* ============================================
   Card styles — copied from chat.tsx
   ============================================ */
const cardStyles: Record<string, { border: string; bg: string; text: string; icon: React.ElementType }> = {
  generate:        { border: "border-accent/30",            bg: "bg-accent/5",            text: "text-accent",            icon: Sparkles },
  search:          { border: "border-info/30",              bg: "bg-info/5",              text: "text-info",              icon: Search },
  approve:         { border: "border-success/30",           bg: "bg-success/5",           text: "text-success",           icon: CheckCircle2 },
  publish:         { border: "border-info/30",              bg: "bg-info/5",              text: "text-info",              icon: Zap },
  heartbeat:       { border: "border-platform-instagram/30",bg: "bg-platform-instagram/5",text: "text-platform-instagram",icon: Heart },
  setup_platform:  { border: "border-warning/30",           bg: "bg-warning/5",           text: "text-warning",           icon: Wrench },
  update_brand:    { border: "border-agent-analyzing/30",   bg: "bg-agent-analyzing/5",   text: "text-agent-analyzing",   icon: Settings2 },
  save_onboarding: { border: "border-success/30",           bg: "bg-success/5",           text: "text-success",           icon: CheckCircle2 },
  query_drafts:    { border: "border-info/30",              bg: "bg-info/5",              text: "text-info",              icon: Database },
};

const failedStyle = { border: "border-danger/30", bg: "bg-danger/5", text: "text-danger" };

/* ============================================
   ToolCard — EXACT copy from chat.tsx
   ============================================ */
function ToolCard({ msg }: { msg: Message }) {
  const action = msg.action!;
  const type = action.type;
  const status = action.status;
  const isFailed = status === "failed" || status === ("error" as ActionResult["status"]);
  const Icon = isFailed ? XCircle : (cardStyles[type]?.icon || Bot);
  const isInProgress = status === "running" || status === "queued";
  const data = msg.toolData || {};

  // Tool-specific border colors for outer bubble
  const toolBorderColors: Record<string, string> = {
    generate: "border-accent/[0.12]", search: "border-info/[0.12]", approve: "border-success/[0.12]",
    publish: "border-info/[0.12]", heartbeat: "border-warning/[0.12]", setup_platform: "border-warning/[0.12]",
    update_brand: "border-accent/[0.12]", save_onboarding: "border-success/[0.12]", query_drafts: "border-info/[0.12]",
  };
  const toolGradientColors: Record<string, string> = {
    generate: "from-accent/20", search: "from-info/20", approve: "from-success/20",
    publish: "from-info/20", heartbeat: "from-warning/20", setup_platform: "from-warning/20",
    update_brand: "from-accent/20", save_onboarding: "from-success/20", query_drafts: "from-info/20",
  };
  // Completed → green border, failed → red, in-progress → tool-specific
  const bubbleBorder = isFailed ? "border-danger/[0.12]" : !isInProgress ? "border-success/[0.12]" : (toolBorderColors[type] || "border-foreground/[0.07]");
  const bubbleGradient = isFailed ? "from-danger/15" : !isInProgress ? "from-success/15" : (toolGradientColors[type] || "from-accent/15");

  // Tool-specific labels for Level 1 (bold, outside) — past tense when done
  const activeLabels: Record<string, string> = {
    generate: "Generate", search: "Search", approve: "Approve",
    publish: "Publish", heartbeat: "Heartbeat", setup_platform: "Setup Platform",
    update_brand: "Update Brand", save_onboarding: "Save Profile", query_drafts: "Query",
  };
  const doneLabels: Record<string, string> = {
    generate: "Generated", search: "Searched", approve: "Approved",
    publish: "Published", heartbeat: "Heartbeat Done", setup_platform: "Platform Ready",
    update_brand: "Brand Updated", save_onboarding: "Profile Saved", query_drafts: "Queried",
  };
  const failedLabels: Record<string, string> = {
    generate: "Generation Failed", search: "Search Failed", approve: "Approval Failed",
    publish: "Publish Failed", heartbeat: "Heartbeat Failed", setup_platform: "Setup Failed",
    update_brand: "Update Failed", save_onboarding: "Save Failed", query_drafts: "Query Failed",
  };
  const toolLabel = isFailed ? (failedLabels[type] || "Failed") : !isInProgress ? (doneLabels[type] || "Done") : (activeLabels[type] || type.replace(/_/g, " "));

  // Mini orb inside the bubble — shows tool-specific icon
  const MiniOrb = () => (
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

  // Text levels:
  // Level 1 (outside, bold): Tool action name — "Generate"
  // Level 2 (inside, next to mini orb): description — "Generating 2 X drafts"
  // Level 3 (status line): phase — "Sending to AI model..."
  const ToolBubble = ({ children, description, phase }: { children?: React.ReactNode; description?: string; phase?: string }) => (
    <div className="flex gap-3 animate-msg-in">
      <AgentOrb state="done" />
      <div className={`flex-1 relative rounded-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl overflow-hidden bg-foreground/[0.04] backdrop-blur-xl border ${bubbleBorder}`}>
        <div className={`absolute top-0 left-0 right-0 h-px bg-gradient-to-r ${bubbleGradient} via-transparent to-transparent`} />
        {isInProgress && (
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_25%_50%,oklch(0.7_0.15_200/0.03),transparent_55%)]" />
        )}

        <div className="relative p-4 space-y-3">
          {/* Level 1: Bold tool name outside inner card */}
          <p className={`text-[14px] font-bold ${isFailed ? "text-danger" : !isInProgress ? "text-success" : "text-foreground"}`}>{toolLabel}</p>

          {/* Inner status card */}
          <div className={`rounded-xl overflow-hidden relative ${isInProgress ? "bg-background/30 border border-foreground/[0.04]" : isFailed ? "bg-background/30 border border-danger/[0.06]" : "bg-background/20 border border-foreground/[0.03]"}`}>
            {isInProgress && (
              <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_25%_50%,oklch(0.7_0.15_200/0.04),transparent_55%)]" style={{ animation: "agent-pulse 8s ease-in-out infinite" }} />
            )}

            <div className="relative p-3.5 space-y-2.5">
              {/* Level 2: Mini orb + description + badge */}
              <div className="flex items-center gap-3">
                <MiniOrb />
                <span className="text-[12.5px] text-foreground/80 flex-1">{description || msg.content}</span>
                <span className={`text-[9px] px-2.5 py-[3px] rounded-xl font-mono uppercase tracking-[0.5px] shrink-0 ${isFailed ? "bg-danger/10 text-danger" : isInProgress ? "bg-accent/10 text-accent" : "bg-success/10 text-success"}`}
                  style={isInProgress ? { animation: "badge-pulse 2s ease infinite" } : undefined}>
                  {status}
                </span>
              </div>

              {/* Level 3: Phase / status text */}
              {phase && (
                <div className="h-[22px] relative overflow-hidden">
                  <div className="absolute left-0 top-0 flex items-center gap-1.5 text-[11.5px] text-muted-foreground whitespace-nowrap"
                    style={{ animation: "status-line-enter 0.4s cubic-bezier(0.4, 0, 0.2, 1) both" }}>
                    <span style={isFailed ? { color: "var(--danger)" } : !isInProgress ? { color: "var(--success)" } : undefined}>
                      {phase}
                    </span>
                    {isInProgress && (
                      <span className="inline-flex gap-[3px] items-center">
                        {[0, 0.15, 0.3].map((d, i) => (
                          <span key={i} className="w-[3px] h-[3px] rounded-full bg-current" style={{ animation: `dots-bounce 1.4s ease infinite ${d}s` }} />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Progress bar (in-progress only) — color changes with percentage */}
              {isInProgress && (() => {
                const pct = 60; // hardcoded for demo, dynamic in production
                const barColor = pct < 30 ? "bg-danger" : pct < 60 ? "bg-warning" : pct < 85 ? "bg-accent" : "bg-success";
                const glowColor = pct < 30 ? "bg-danger/40" : pct < 60 ? "bg-warning/40" : pct < 85 ? "bg-accent/40" : "bg-success/40";
                return (
                  <div className="h-[3px] bg-foreground/[0.03] rounded-full overflow-hidden relative">
                    <div className={`h-full rounded-full ${barColor} relative transition-all duration-700`} style={{ width: `${pct}%` }}>
                      <div className={`absolute right-0 -top-1 -bottom-1 w-10 rounded-full blur-md ${glowColor}`} />
                    </div>
                  </div>
                );
              })()}

              {/* Stats row */}
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground/40 font-mono">
                <span className={isFailed ? "text-danger" : isInProgress ? "text-warning" : "text-success"}>{isInProgress ? "60%" : isFailed ? "error" : "done"}</span>
                <span className="w-px h-2 bg-foreground/5" />
                <span>{isInProgress ? "est. 3s" : isFailed ? "failed" : "completed"}</span>
              </div>
            </div>
          </div>

          {/* Extra content below */}
          {children}
        </div>
      </div>
    </div>
  );

  // === Search results ===
  if (type === "search" && status === "completed" && data.results) {
    const results = data.results as Array<{ title: string; url: string; description: string }>;
    return (
      <ToolBubble description={`Found ${results.length} results for "${String(data.query || "")}"`} phase="Search complete">
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
      <ToolBubble description="Published successfully." phase="Live on platform">
        <a href={String(data.url)} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-success/5 border border-success/10 px-3 py-2 text-[12px] text-success hover:bg-success/10 transition-colors">
          <Zap className="h-3.5 w-3.5" />
          <span className="truncate flex-1">{String(data.url)}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      </ToolBubble>
    );
  }

  // === Setup platform ===
  if (type === "setup_platform" && status === "completed" && data.profile) {
    const profile = data.profile as Record<string, unknown>;
    const firstPosts = profile.first_posts as Array<Record<string, unknown>> | undefined;
    return (
      <ToolBubble description="Platform profile generated." phase="Profile saved">
        <div className="rounded-lg bg-background/30 border border-foreground/[0.04] p-3 space-y-1.5 text-[12px]">
          {[["Name", profile.display_name], ["Handle", profile.handle], ["Bio", profile.bio], ["Topics", profile.topics], ["Strategy", profile.content_strategy]]
            .filter(([, v]) => !!v)
            .map(([label, value]) => (
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
      <ToolBubble description="Brand profile saved." phase="Onboarding complete">
        <div className="rounded-lg bg-background/30 border border-success/[0.08] p-3 space-y-1.5 text-[12px]">
          {rows.map(([label, value]) => (
            <div key={label}><span className="text-muted-foreground">{label}:</span> <span className="text-foreground ml-1">{value}</span></div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-1.5 text-[12px] font-semibold text-white hover:opacity-90">
            <CheckCircle2 className="h-3 w-3" />Accept & Go to Rebel
          </button>
          <button className="rounded-lg border border-foreground/[0.06] px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground">
            Continue Setup
          </button>
        </div>
      </ToolBubble>
    );
  }

  // === Query results ===
  if (type === "query_drafts" && status === "completed" && data.results) {
    const results = data.results as Array<Record<string, string>>;
    return (
      <ToolBubble description={`Found ${results.length} drafts.`} phase="Query complete">
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

  // === Error ===
  if (isFailed) {
    return (
      <ToolBubble description={msg.content} phase="Failed">
        {type === "publish" && (
          <span className="text-[11px] text-accent">Go to Content to approve first</span>
        )}
      </ToolBubble>
    );
  }

  // === In-progress — split content into summary + phase ===
  if (isInProgress) {
    // Content format: "Generating 2 X drafts — Sending to AI model..."
    const parts = msg.content.split(" — ");
    const summary = parts[0] || msg.content;
    const phase = parts[1] || "";
    return <ToolBubble description={summary} phase={phase || undefined} />;
  }

  // === Completed — use content as summary ===
  return <ToolBubble description={msg.content} phase="Completed" />;
}

/* ============================================
   Demo data — every possible state
   ============================================ */
const DEMO_ITEMS: { id: string; msg: Message }[] = [
  // --- Basic messages ---
  { id: "user", msg: { role: "user", content: "Generate 2 posts for X about AI agents" } },
  { id: "assistant", msg: { role: "assistant", content: "Hey. What do you need: drafts, a full content run, brand setup, or publish?" } },
  { id: "assistant-long", msg: { role: "assistant", content: "I can help you with that. Based on your brand profile, your tone is raw and direct with no corporate fluff. Your audience is AI engineers, founders, and builders. I'll generate content that matches this voice and targets the right people." } },
  { id: "system", msg: { role: "system", content: "Session started" } },

  // --- generate_drafts ---
  { id: "gen-queued", msg: { role: "system", content: "Generating 2 X drafts — Sending to AI model...", action: { type: "generate", status: "queued", detail: "job_123" } } },
  { id: "gen-running", msg: { role: "system", content: "Generating 2 X drafts — AI is thinking...", action: { type: "generate", status: "running", detail: "job_123" } } },
  { id: "gen-completed", msg: { role: "system", content: "Done! 2 drafts created.", action: { type: "generate", status: "completed" } } },
  { id: "gen-failed", msg: { role: "system", content: "Draft generation timed out after 120s", action: { type: "generate", status: "failed" } } },

  // --- web_search ---
  { id: "search-results", msg: {
    role: "system", content: "Searching for AI agent trends",
    action: { type: "search", status: "completed" },
    toolData: {
      query: "AI agent trends 2026",
      results: [
        { title: "The Rise of Autonomous AI Agents", url: "https://example.com/ai-agents", description: "How AI agents are transforming content creation and social media management in 2026." },
        { title: "Local-First AI: Running Models on Consumer Hardware", url: "https://example.com/local-ai", description: "A deep dive into running 20B+ parameter models on consumer GPUs with vLLM." },
        { title: "Open Source vs SaaS: The Content Tool Debate", url: "https://example.com/oss-vs-saas", description: "Why more creators are switching to open-source alternatives for social media." },
      ],
    },
  }},
  { id: "search-empty", msg: { role: "system", content: "No results found", action: { type: "search", status: "completed" } } },
  { id: "search-failed", msg: { role: "system", content: "Web search failed: Firecrawl API key not configured", action: { type: "search", status: "failed" } } },

  // --- approve_draft ---
  { id: "approve-ok", msg: { role: "system", content: "Approved the latest pending draft", action: { type: "approve", status: "completed" } } },
  { id: "approve-fail", msg: { role: "system", content: "No pending drafts to approve", action: { type: "approve", status: "failed" } } },

  // --- publish_draft ---
  { id: "publish-url", msg: {
    role: "system", content: "Published to X",
    action: { type: "publish", status: "completed" },
    toolData: { url: "https://x.com/hec_ovi/status/1234567890" },
  }},
  { id: "publish-no-url", msg: { role: "system", content: "Published to LinkedIn", action: { type: "publish", status: "completed" } } },
  { id: "publish-fail", msg: { role: "system", content: "Cannot publish: no approved drafts", action: { type: "publish", status: "failed" } } },

  // --- heartbeat ---
  { id: "hb-running", msg: { role: "system", content: "Heartbeat — Scout researching...", action: { type: "heartbeat", status: "running", detail: "hb_1" } } },
  { id: "hb-done", msg: { role: "system", content: "Heartbeat done! 3 drafts. Trends: AI agents, local inference, open source", action: { type: "heartbeat", status: "completed" } } },
  { id: "hb-fail", msg: { role: "system", content: "Heartbeat timed out", action: { type: "heartbeat", status: "failed" } } },

  // --- setup_platform ---
  { id: "setup-ok", msg: {
    role: "system", content: "X profile generated",
    action: { type: "setup_platform", status: "completed" },
    toolData: {
      profile: {
        display_name: "Hector Oviedo",
        handle: "@hec_ovi",
        bio: "Building AI systems that run on my own hardware. Open source. Local-first.",
        topics: "AI, open-source, local inference, content automation",
        content_strategy: "Daily short-form posts about building in public",
        first_posts: [
          { concept: "Introduction post about local AI" },
          { concept: "Behind the scenes of Rebel Forge" },
          { concept: "Why I left cloud AI behind" },
        ],
      },
    },
  }},
  { id: "setup-fail", msg: { role: "system", content: "Platform setup failed: LLM timeout", action: { type: "setup_platform", status: "failed" } } },

  // --- update_brand ---
  { id: "brand-ok", msg: { role: "system", content: "Updated brand voice to raw and direct", action: { type: "update_brand", status: "completed" } } },
  { id: "brand-fail", msg: { role: "system", content: "Failed to update brand profile", action: { type: "update_brand", status: "failed" } } },

  // --- save_onboarding ---
  { id: "onboard-ok", msg: {
    role: "system", content: "Brand profile saved",
    action: { type: "save_onboarding", status: "completed" },
    onboardingProfile: {
      platforms: ["x", "linkedin", "instagram"],
      content_types: ["text posts", "threads"],
      frequency: "daily",
      audience: "AI engineers, founders, builders",
      voice: "Raw and direct, no corporate fluff",
      goals: "Build authority and attract opportunities",
      inspiration: "@karpathy, @ylecun, @levelsio",
    },
  }},
  { id: "onboard-fail", msg: { role: "system", content: "Failed to save onboarding data", action: { type: "save_onboarding", status: "failed" } } },

  // --- query_drafts ---
  { id: "query-ok", msg: {
    role: "system", content: "Found 3 drafts",
    action: { type: "query_drafts", status: "completed" },
    toolData: {
      query: "SELECT platform, status, concept FROM content_drafts ORDER BY created_at DESC LIMIT 5",
      results: [
        { platform: "x", status: "draft", concept: "AI agents that actually work in production" },
        { platform: "instagram", status: "draft", concept: "Behind the scenes of local AI" },
        { platform: "threads", status: "published", concept: "Open source tools I use daily" },
      ],
    },
  }},
  { id: "query-fail", msg: { role: "system", content: "Query failed: syntax error near LIMIT", action: { type: "query_drafts", status: "failed" } } },
];

/* ============================================
   Render helpers — EXACT copy of chat.tsx rendering
   ============================================ */
function RenderMessage({ msg }: { msg: Message }) {
  // Tool card — left-aligned with orb like assistant messages
  if (msg.role === "system" && msg.action) {
    return <ToolCard msg={msg} />;
  }

  // Plain system message
  if (msg.role === "system") {
    return (
      <div className="flex justify-center">
        <span className="text-[12px] text-muted-foreground/60 bg-muted/20 backdrop-blur-md border border-border/10 rounded-md px-3 py-1.5">{msg.content}</span>
      </div>
    );
  }

  // User bubble — single element with icon inside
  if (msg.role === "user") {
    return (
      <div className="flex justify-end animate-msg-in">
        <div className="flex items-center gap-0 rounded-2xl rounded-tl-sm bg-accent text-accent-foreground max-w-[80%]">
          <p className="text-[13px] whitespace-pre-wrap leading-relaxed px-4 py-2">{msg.content}</p>
          <div className="flex h-full items-center border-l border-accent-foreground/20 px-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-foreground/15">
              <Send className="h-3 w-3" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Assistant bubble — glassmorphism with top gradient line
  return (
    <div className="flex gap-3 animate-msg-in">
      {/* Static orb — same size as tool cards, yellow tint, no animation */}
      <div className="relative w-9 h-9 shrink-0 mt-0.5">
        <div className="absolute -inset-3.5 rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_55/0.04),transparent_70%)]" />
        <div className="absolute inset-0 rounded-full border-[1.5px] border-warning/10" />
        <div className="absolute inset-[6px] rounded-full bg-warning/8" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Eye className="h-3.5 w-3.5 text-warning/50" />
        </div>
      </div>
      <div className="relative rounded-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl px-4 py-2.5 max-w-[80%] bg-foreground/[0.04] backdrop-blur-xl border border-foreground/[0.07] overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-accent/15 via-transparent to-transparent" />
        <p className="text-[13px] whitespace-pre-wrap leading-[1.75]">{msg.content}</p>
      </div>
    </div>
  );
}

/* ============================================
   Reasoning bubble — animated thinking chain
   ============================================ */
function ReasoningBubble({ label }: { label: string }) {
  return (
    <div className="flex gap-3 animate-msg-in">
      <AgentOrb state="thinking" />

      {/* Reasoning chain bubble */}
      <div className="relative rounded-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl px-4 py-3 bg-warning/[0.025] backdrop-blur-xl border border-warning/[0.07] overflow-hidden">
        {/* Top gradient line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-warning/10 via-transparent to-transparent" />

        <div className="flex items-center gap-3.5">
          {/* Animated node chain */}
          <div className="flex items-center">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center">
                <div
                  className="w-[7px] h-[7px] rounded-full bg-warning"
                  style={{ animation: `node-pulse 2s ease-in-out infinite ${i * 0.2}s` }}
                />
                {i < 4 && (
                  <div
                    className="w-[14px] h-[1.5px] rounded-sm bg-gradient-to-r from-warning/10 to-warning/20"
                    style={{ animation: `link-glow 2s ease-in-out infinite ${i * 0.2 + 0.1}s` }}
                  />
                )}
              </div>
            ))}
          </div>
          {/* Shimmer text */}
          <span
            className="text-[11px] bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(90deg, oklch(0.65 0.1 55), oklch(0.8 0.15 55), oklch(0.65 0.1 55))",
              backgroundSize: "200% 100%",
              animation: "text-shimmer 3s linear infinite",
            }}
          >
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================
   Alive Agent Orb — reusable across all states
   ============================================ */
type OrbState = "thinking" | "tool" | "done";

function AgentOrb({ state }: { state: OrbState }) {
  const isThinking = state === "thinking";

  return (
    <div className="relative w-9 h-9 shrink-0 mt-0.5">
      {/* Halo — always yellow, animated only when thinking */}
      <div className="absolute -inset-3.5 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, oklch(0.7 0.15 55/0.06), transparent 70%)", animation: isThinking ? "orb-halo-breath 3s ease-in-out infinite" : undefined, opacity: isThinking ? undefined : 0.4 }} />

      {/* Pulse rings (thinking only) */}
      {isThinking && <>
        <div className="absolute inset-0 rounded-full border border-warning/30 opacity-0" style={{ animation: "signal-ping 2.2s ease-out infinite" }} />
        <div className="absolute inset-0 rounded-full border border-warning/30 opacity-0" style={{ animation: "signal-ping 2.2s ease-out infinite 0.8s" }} />
      </>}

      {/* Arcs — only when thinking, always yellow */}
      {isThinking && <>
        <div className="absolute -inset-[5px] rounded-full border-[2px] border-transparent border-b-warning/35"
          style={{ animation: "orb-spin-reverse 4s linear infinite" }} />
        <div className="absolute -inset-[2px] rounded-full border-[2.5px] border-transparent border-t-warning/70"
          style={{ animation: "orb-spin 2.5s linear infinite" }} />
      </>}

      {/* Ring base */}
      <div className="absolute inset-0 rounded-full border-[1.5px] border-warning/10" />

      {/* Core — always yellow */}
      <div className="absolute inset-[6px] rounded-full bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_55/0.2),oklch(0.7_0.15_55/0.06))] shadow-[0_0_15px_oklch(0.7_0.15_55/0.08)]"
        style={isThinking ? { animation: "orb-core-pulse 1.5s ease-in-out infinite" } : undefined} />

      {/* Eye icon — always yellow */}
      <div className="absolute inset-0 flex items-center justify-center">
        <Eye className="h-3.5 w-3.5 text-warning/60 drop-shadow-[0_0_4px_oklch(0.7_0.15_55/0.2)]" />
      </div>

      {/* No sub-badge — removed for consistency */}
    </div>
  );
}

/* ============================================
   Streaming dots
   ============================================ */
function StreamingDots() {
  return (
    <div className="flex gap-3">
      <div className="relative w-9 h-9 shrink-0 mt-0.5">
        <div className="absolute -inset-3.5 rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_55/0.04),transparent_70%)]" />
        <div className="absolute inset-0 rounded-full border-[1.5px] border-warning/10" />
        <div className="absolute inset-[6px] rounded-full bg-warning/8" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Eye className="h-3.5 w-3.5 text-warning/50" />
        </div>
      </div>
      <div className="rounded-sm rounded-tr-2xl rounded-br-2xl rounded-bl-2xl px-4 py-3 bg-foreground/[0.04] backdrop-blur-xl border border-foreground/[0.07]">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-accent/40 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-accent/40 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-accent/40 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

/* ============================================
   Page
   ============================================ */
/* ============================================
   Header Bar Demo — 5 sections
   ============================================ */
type DemoState = "idle" | "scouting" | "analyzing" | "creating" | "publishing" | "error";

const stateIcons: Record<DemoState, React.ElementType> = {
  idle: Eye, scouting: Search, analyzing: Brain, creating: Sparkles, publishing: Zap, error: AlertTriangle,
};
const stateInfo: Record<DemoState, { label: string; desc: string }> = {
  idle: { label: "Idle", desc: "Waiting for input" },
  scouting: { label: "Scouting", desc: "Researching trends" },
  analyzing: { label: "Analyzing", desc: "Reviewing data" },
  creating: { label: "Creating", desc: "Generating drafts" },
  publishing: { label: "Publishing", desc: "Sending to platforms" },
  error: { label: "Error", desc: "Something went wrong" },
};

// Wash colors per state
const washColors: Record<DemoState, string> = {
  idle: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_200/0.04),transparent_40%)]",
  scouting: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_55/0.05),transparent_40%)]",
  analyzing: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_55/0.05),transparent_40%)]",
  creating: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_200/0.05),transparent_35%)]",
  publishing: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_200/0.05),transparent_35%)]",
  error: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.65_0.2_25/0.04),transparent_40%)]",
};

// Orb core colors
const orbCoreColors: Record<DemoState, string> = {
  idle: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_200/0.2),oklch(0.7_0.15_200/0.05))]",
  scouting: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_55/0.25),oklch(0.7_0.15_55/0.06))]",
  analyzing: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_55/0.25),oklch(0.7_0.15_55/0.06))]",
  creating: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_200/0.25),oklch(0.7_0.15_280/0.08))]",
  publishing: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_200/0.25),oklch(0.7_0.15_280/0.08))]",
  error: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.65_0.2_25/0.25),oklch(0.65_0.2_25/0.06))]",
};

const stateTextColors: Record<DemoState, string> = {
  idle: "text-foreground", scouting: "text-warning", analyzing: "text-warning",
  creating: "text-accent", publishing: "text-accent", error: "text-danger",
};

const stateIconColors: Record<DemoState, string> = {
  idle: "text-accent/60", scouting: "text-warning/80", analyzing: "text-warning/80",
  creating: "text-accent/80", publishing: "text-accent/80", error: "text-danger/80",
};

function HeaderBarDemo() {
  const [state, setState] = useState<DemoState>("idle");
  const [runCount, setRunCount] = useState(2);
  const [pendCount, setPendCount] = useState(3);
  const [loopOn, setLoopOn] = useState(true);

  const isActive = state !== "idle" && state !== "error";
  const isWarm = state === "scouting" || state === "analyzing";
  const info = stateInfo[state];
  const StateIcon = stateIcons[state];

  return (
    <div className="space-y-0">
      {/* The bar — centered, no bg */}
      <div className="flex items-stretch backdrop-blur-xl border-b border-foreground/[0.06] overflow-hidden relative transition-all duration-500 mx-auto w-fit">
        {/* Wash */}
        <div className={`absolute inset-0 pointer-events-none transition-all duration-1000 ${washColors[state]}`} />

        {/* [1] Agent — fixed width */}
        <div className="flex items-center gap-3 px-5 py-3 relative z-10 w-[200px] shrink-0">
          {/* Header orb */}
          <div className="relative w-10 h-10 shrink-0">
            {/* Glow */}
            <div className="absolute -inset-3.5 rounded-full pointer-events-none"
              style={{ background: isWarm ? "radial-gradient(circle, oklch(0.7 0.15 55/0.07), transparent 70%)" : state === "error" ? "radial-gradient(circle, oklch(0.65 0.2 25/0.05), transparent 70%)" : "radial-gradient(circle, oklch(0.7 0.15 200/0.06), transparent 70%)",
                animation: isActive ? `orb-halo-breath ${isWarm ? "3s" : "2s"} ease-in-out infinite` : undefined, opacity: isActive ? undefined : 0.4 }} />
            {/* Pulse rings (scouting/analyzing) */}
            {isWarm && <>
              <div className="absolute inset-0 rounded-full border border-warning/20 opacity-0" style={{ animation: "signal-ping 2.2s ease-out infinite" }} />
              <div className="absolute inset-0 rounded-full border border-warning/20 opacity-0" style={{ animation: "signal-ping 2.2s ease-out infinite 0.8s" }} />
            </>}
            {/* Arcs */}
            {isActive && <>
              <div className={`absolute -inset-[6px] rounded-full border-[1.5px] border-transparent ${isWarm ? "border-b-warning/25" : "border-b-info/25"}`}
                style={{ animation: `orb-spin-reverse ${isWarm ? "4s" : "1.4s"} linear infinite` }} />
              <div className={`absolute -inset-[2px] rounded-full border-2 border-transparent ${isWarm ? "border-t-warning/50" : "border-t-accent/55"}`}
                style={{ animation: `orb-spin ${isWarm ? "2.5s" : "0.9s"} linear infinite` }} />
            </>}
            {/* Ring */}
            <div className={`absolute inset-0 rounded-full border-[1.5px] ${isWarm ? "border-warning/12" : state === "error" ? "border-danger/10" : "border-accent/10"}`} />
            {/* Core */}
            <div className={`absolute inset-[9px] rounded-full ${orbCoreColors[state]} shadow-[0_0_15px_oklch(0.7_0.15_200/0.06)]`}
              style={isActive ? { animation: `orb-core-pulse ${isWarm ? "1.5s" : "1.2s"} ease-in-out infinite` } : undefined} />
            {/* Icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <StateIcon className={`h-4 w-4 ${stateIconColors[state]} transition-all duration-400`} />
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-bold tracking-tight">Rebel Agent</p>
            <p className="text-[9px] text-muted-foreground/40 tracking-wider mt-0.5">social media agent</p>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px bg-gradient-to-b from-transparent via-foreground/[0.06] to-transparent shrink-0" />

        {/* [2] Status — fixed width */}
        <div className="flex flex-col justify-center px-5 py-3 w-[160px] shrink-0 relative z-10">
          <p className="text-[8px] uppercase tracking-[2px] text-muted-foreground/30 mb-1 flex items-center gap-1.5">
            <span className={`w-1 h-1 rounded-full ${isWarm ? "bg-warning" : state === "error" ? "bg-danger" : isActive ? "bg-accent" : "bg-accent/40"}`}
              style={isActive ? { animation: "orb-core-pulse 1.5s ease infinite" } : undefined} />
            status
          </p>
          <p className={`text-[16px] font-extrabold tracking-tight ${stateTextColors[state]} transition-all duration-400`}>{info.label}</p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{info.desc}</p>
        </div>

        <div className="w-px bg-gradient-to-b from-transparent via-foreground/[0.06] to-transparent shrink-0" />

        {/* [3] Running — fixed width */}
        <div className="flex flex-col justify-center px-4 py-3 w-[130px] shrink-0 relative z-10 cursor-pointer hover:bg-accent/[0.02] transition-colors">
          <p className="text-[8px] uppercase tracking-[2px] text-muted-foreground/30 mb-1">running</p>
          <p className={`text-[24px] font-extrabold leading-none transition-all duration-500 ${runCount > 0 ? "text-accent" : "text-muted-foreground/20"}`}
            style={runCount > 0 ? { textShadow: "0 0 20px oklch(0.7 0.15 200/0.2)" } : undefined}>
            {runCount}
          </p>
          <p className="text-[9px] text-muted-foreground/40 mt-1 flex items-center gap-1">
            <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${runCount > 0 ? "bg-accent" : "bg-muted-foreground/20"}`}
              style={runCount > 0 ? { animation: "orb-core-pulse 1.5s ease infinite" } : undefined} />
            {runCount > 0 ? `${runCount} task${runCount > 1 ? "s" : ""} active` : "no active tasks"}
          </p>
{/* no individual line */}
        </div>

        <div className="w-px bg-gradient-to-b from-transparent via-foreground/[0.06] to-transparent shrink-0" />

        {/* [4] Pending — fixed width */}
        <div className="flex flex-col justify-center px-4 py-3 w-[130px] shrink-0 relative z-10 cursor-pointer hover:bg-warning/[0.02] transition-colors">
          <p className="text-[8px] uppercase tracking-[2px] text-muted-foreground/30 mb-1">pending</p>
          <p className={`text-[24px] font-extrabold leading-none transition-all duration-500 ${pendCount > 0 ? "text-warning" : "text-muted-foreground/20"}`}
            style={pendCount > 0 ? { textShadow: "0 0 20px oklch(0.7 0.15 55/0.2)" } : undefined}>
            {pendCount}
          </p>
          <p className="text-[9px] text-muted-foreground/40 mt-1 flex items-center gap-1">
            <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${pendCount > 0 ? "bg-warning" : "bg-muted-foreground/20"}`} />
            {pendCount > 0 ? `${pendCount} draft${pendCount > 1 ? "s" : ""} to review` : "nothing to review"}
          </p>
{/* no individual line */}
        </div>

        <div className="w-px bg-gradient-to-b from-transparent via-foreground/[0.06] to-transparent shrink-0" />

        {/* [5] Heartbeat / Loop — fixed width */}
        <div className="flex flex-col items-center justify-center px-5 py-3 w-[100px] shrink-0 relative z-10">
          <p className="text-[8px] uppercase tracking-[2px] text-muted-foreground/30 mb-2">loop</p>
          {/* Concentric rings */}
          <div className="relative w-8 h-8">
            {/* Halo */}
            {loopOn && <div className="absolute -inset-3 rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_150/0.04),transparent_70%)]" style={{ animation: "orb-halo-breath 4s ease-in-out infinite" }} />}
            {/* Ring 3 (outer) */}
            <div className={`absolute -inset-2 rounded-full border ${loopOn ? "border-success/[0.04]" : "border-foreground/[0.03]"}`}
              style={loopOn ? { animation: "orb-spin 16s linear infinite" } : undefined}>
              <div className={`absolute top-1/2 -right-[1.5px] -translate-y-1/2 w-[3px] h-[3px] rounded-full ${loopOn ? "bg-success/30 shadow-[0_0_3px_oklch(0.7_0.15_150/0.2)]" : "bg-muted-foreground/10"}`} />
            </div>
            {/* Ring 2 */}
            <div className={`absolute -inset-1 rounded-full border ${loopOn ? "border-success/[0.08]" : "border-foreground/[0.03]"}`}
              style={loopOn ? { animation: "orb-spin-reverse 12s linear infinite" } : undefined}>
              <div className={`absolute -bottom-[1.5px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full ${loopOn ? "bg-success/50 shadow-[0_0_4px_oklch(0.7_0.15_150/0.3)]" : "bg-muted-foreground/10"}`} />
            </div>
            {/* Ring 1 (inner) */}
            <div className={`absolute inset-0 rounded-full border ${loopOn ? "border-success/[0.15]" : "border-foreground/[0.03]"}`}
              style={loopOn ? { animation: "orb-spin 8s linear infinite" } : undefined}>
              <div className={`absolute -top-[1.5px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full ${loopOn ? "bg-success shadow-[0_0_6px_oklch(0.7_0.15_150/0.4)]" : "bg-muted-foreground/10"}`} />
            </div>
            {/* Core */}
            <div className={`absolute inset-[8px] rounded-full transition-all duration-500 ${loopOn ? "bg-success shadow-[0_0_10px_oklch(0.7_0.15_150/0.3)]" : "bg-muted-foreground/20"}`}
              style={loopOn ? { animation: "orb-core-pulse 2.5s ease-in-out infinite" } : undefined} />
          </div>
          <p className={`text-[10px] mt-1.5 font-medium ${loopOn ? "text-success" : "text-muted-foreground/30"}`}>{loopOn ? "active" : "paused"}</p>
        </div>
      </div>


    </div>
  );
}

/* ============================================
   Page
   ============================================ */
export default function RebelDemoPage() {
  return (
    <div className="relative flex flex-col h-full bg-background">
      {/* Hide the old app header — this page has its own */}
      <style>{`header { display: none !important; } main { height: 100vh !important; max-height: 100vh !important; }`}</style>
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-1/4 -left-1/4 w-[60%] h-[60%] rounded-full bg-accent/8 blur-[120px] animate-float" />
        <div className="absolute -bottom-1/4 -right-1/4 w-[50%] h-[50%] rounded-full bg-info/8 blur-[120px] animate-float" style={{ animationDelay: "-3s", animationDirection: "reverse" }} />
      </div>

      {/* Header — sticky, full width, no padding */}
      <div className="sticky top-0 z-50 w-full">
        <HeaderBarDemo />
      </div>

      {/* Chat content — scrollable below */}
      <div className="relative flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4 w-full">
          {/* Thinking */}
          <ReasoningBubble label="Thinking" />

        {/* All message types */}
        {DEMO_ITEMS.map((item) => (
          <RenderMessage key={item.id} msg={item.msg} />
        ))}

          <div className="h-20" />
        </div>
      </div>
    </div>
  );
}
