"use client";

import Link from "next/link";
import {
  Search, Sparkles, Zap, Brain, Eye, AlertTriangle,
} from "lucide-react";
import { useAppStore, type AgentState } from "@/lib/store";

/* ============================================
   State config
   ============================================ */
const stateIcons: Record<AgentState, React.ElementType> = {
  idle: Eye, scouting: Search, analyzing: Brain, creating: Sparkles, publishing: Zap, error: AlertTriangle,
};

const stateInfo: Record<AgentState, { label: string; desc: string }> = {
  idle: { label: "Idle", desc: "Waiting for input" },
  scouting: { label: "Scouting", desc: "Researching trends" },
  analyzing: { label: "Analyzing", desc: "Reviewing data" },
  creating: { label: "Creating", desc: "Generating drafts" },
  publishing: { label: "Publishing", desc: "Sending to platforms" },
  error: { label: "Error", desc: "Something went wrong" },
};

const washColors: Record<AgentState, string> = {
  idle: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_200/0.04),transparent_40%)]",
  scouting: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_55/0.05),transparent_40%)]",
  analyzing: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_55/0.05),transparent_40%)]",
  creating: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_200/0.05),transparent_35%)]",
  publishing: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.7_0.15_200/0.05),transparent_35%)]",
  error: "bg-[radial-gradient(ellipse_at_5%_50%,oklch(0.65_0.2_25/0.04),transparent_40%)]",
};

const orbCoreColors: Record<AgentState, string> = {
  idle: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_200/0.2),oklch(0.7_0.15_200/0.05))]",
  scouting: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_55/0.25),oklch(0.7_0.15_55/0.06))]",
  analyzing: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_55/0.25),oklch(0.7_0.15_55/0.06))]",
  creating: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_200/0.25),oklch(0.7_0.15_280/0.08))]",
  publishing: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.7_0.15_200/0.25),oklch(0.7_0.15_280/0.08))]",
  error: "bg-[radial-gradient(circle_at_35%_35%,oklch(0.65_0.2_25/0.25),oklch(0.65_0.2_25/0.06))]",
};

const stateTextColors: Record<AgentState, string> = {
  idle: "text-foreground", scouting: "text-warning", analyzing: "text-warning",
  creating: "text-accent", publishing: "text-accent", error: "text-danger",
};

const stateIconColors: Record<AgentState, string> = {
  idle: "text-accent/60", scouting: "text-warning/80", analyzing: "text-warning/80",
  creating: "text-accent/80", publishing: "text-accent/80", error: "text-danger/80",
};

/* ============================================
   Agent Status Bar — 5 sections
   ============================================ */
export function AgentStatus() {
  const agentState = useAppStore((s) => s.agentState);
  const heartbeatEnabled = useAppStore((s) => s.heartbeatEnabled);
  const heartbeat = useAppStore((s) => s.heartbeat);
  const draftCounts = useAppStore((s) => s.draftCounts);
  const events = useAppStore((s) => s.events);

  const isActive = agentState !== "idle" && agentState !== "error";
  const isWarm = agentState === "scouting" || agentState === "analyzing";
  const info = stateInfo[agentState];
  const StateIcon = stateIcons[agentState];
  const nextRun = heartbeat?.next_run || "";

  // Count in-progress events
  const inProgressCount = events.filter((e) => {
    const age = Date.now() - new Date(e.created_at).getTime();
    if (age > 120000) return false;
    return e.event_type.endsWith(".started") || e.event_type === "job.queued" || e.event_type === "heartbeat.requested";
  }).length;

  const pendingCount = draftCounts.pending;

  return (
    <div className="flex items-stretch backdrop-blur-xl overflow-hidden relative mx-auto w-fit">
      {/* Wash */}
      <div className={`absolute inset-0 pointer-events-none transition-all duration-1000 ${washColors[agentState]}`} />

      {/* [1] Agent */}
      <Link href={agentState === "idle" ? "/rebel" : "/tasks"} className="flex items-center gap-3 px-5 py-3 relative z-10 w-[200px] shrink-0 hover:opacity-80 transition-opacity">
        {/* Orb */}
        <div className="relative w-10 h-10 shrink-0">
          <div className="absolute -inset-3.5 rounded-full pointer-events-none"
            style={{ background: isWarm ? "radial-gradient(circle, oklch(0.7 0.15 55/0.07), transparent 70%)" : agentState === "error" ? "radial-gradient(circle, oklch(0.65 0.2 25/0.05), transparent 70%)" : "radial-gradient(circle, oklch(0.7 0.15 200/0.06), transparent 70%)",
              animation: isActive ? `orb-halo-breath ${isWarm ? "3s" : "2s"} ease-in-out infinite` : undefined, opacity: isActive ? undefined : 0.4 }} />
          {isWarm && <>
            <div className="absolute inset-0 rounded-full border border-warning/20 opacity-0" style={{ animation: "signal-ping 2.2s ease-out infinite" }} />
            <div className="absolute inset-0 rounded-full border border-warning/20 opacity-0" style={{ animation: "signal-ping 2.2s ease-out infinite 0.8s" }} />
          </>}
          {isActive && <>
            <div className={`absolute -inset-[6px] rounded-full border-[1.5px] border-transparent ${isWarm ? "border-b-warning/25" : "border-b-info/25"}`}
              style={{ animation: `orb-spin-reverse ${isWarm ? "4s" : "1.4s"} linear infinite` }} />
            <div className={`absolute -inset-[2px] rounded-full border-2 border-transparent ${isWarm ? "border-t-warning/50" : "border-t-accent/55"}`}
              style={{ animation: `orb-spin ${isWarm ? "2.5s" : "0.9s"} linear infinite` }} />
          </>}
          <div className={`absolute inset-0 rounded-full border-[1.5px] ${isWarm ? "border-warning/12" : agentState === "error" ? "border-danger/10" : "border-accent/10"}`} />
          <div className={`absolute inset-[9px] rounded-full ${orbCoreColors[agentState]} shadow-[0_0_15px_oklch(0.7_0.15_200/0.06)]`}
            style={isActive ? { animation: `orb-core-pulse ${isWarm ? "1.5s" : "1.2s"} ease-in-out infinite` } : undefined} />
          <div className="absolute inset-0 flex items-center justify-center">
            <StateIcon className={`h-4 w-4 ${stateIconColors[agentState]} transition-all duration-400`} />
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-bold tracking-tight">Rebel Agent</p>
          <p className="text-[9px] text-muted-foreground/40 tracking-wider mt-0.5">social media agent</p>
        </div>
      </Link>

      <div className="w-px bg-gradient-to-b from-transparent via-foreground/[0.06] to-transparent shrink-0" />

      {/* [2] Status */}
      <div className="flex flex-col justify-center px-5 py-3 w-[160px] shrink-0 relative z-10">
        <p className="text-[8px] uppercase tracking-[2px] text-muted-foreground/30 mb-1 flex items-center gap-1.5">
          <span className={`w-1 h-1 rounded-full ${isWarm ? "bg-warning" : agentState === "error" ? "bg-danger" : isActive ? "bg-accent" : "bg-accent/40"}`}
            style={isActive ? { animation: "orb-core-pulse 1.5s ease infinite" } : undefined} />
          status
        </p>
        <p className={`text-[16px] font-extrabold tracking-tight ${stateTextColors[agentState]} transition-all duration-400`}>{info.label}</p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">{info.desc}</p>
      </div>

      <div className="w-px bg-gradient-to-b from-transparent via-foreground/[0.06] to-transparent shrink-0" />

      {/* [3] Running */}
      <Link href="/tasks" className="flex flex-col justify-center px-4 py-3 w-[130px] shrink-0 relative z-10 hover:bg-accent/[0.02] transition-colors">
        <p className="text-[8px] uppercase tracking-[2px] text-muted-foreground/30 mb-1">running</p>
        <p className={`text-[24px] font-extrabold leading-none transition-all duration-500 ${inProgressCount > 0 ? "text-accent" : "text-muted-foreground/20"}`}
          style={inProgressCount > 0 ? { textShadow: "0 0 20px oklch(0.7 0.15 200/0.2)" } : undefined}>
          {inProgressCount}
        </p>
        <p className="text-[9px] text-muted-foreground/40 mt-1 flex items-center gap-1">
          <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${inProgressCount > 0 ? "bg-accent" : "bg-muted-foreground/20"}`}
            style={inProgressCount > 0 ? { animation: "orb-core-pulse 1.5s ease infinite" } : undefined} />
          {inProgressCount > 0 ? `${inProgressCount} task${inProgressCount > 1 ? "s" : ""} active` : "no active tasks"}
        </p>
      </Link>

      <div className="w-px bg-gradient-to-b from-transparent via-foreground/[0.06] to-transparent shrink-0" />

      {/* [4] Pending */}
      <Link href="/drafts" className="flex flex-col justify-center px-4 py-3 w-[130px] shrink-0 relative z-10 hover:bg-warning/[0.02] transition-colors">
        <p className="text-[8px] uppercase tracking-[2px] text-muted-foreground/30 mb-1">pending</p>
        <p className={`text-[24px] font-extrabold leading-none transition-all duration-500 ${pendingCount > 0 ? "text-warning" : "text-muted-foreground/20"}`}
          style={pendingCount > 0 ? { textShadow: "0 0 20px oklch(0.7 0.15 55/0.2)" } : undefined}>
          {pendingCount}
        </p>
        <p className="text-[9px] text-muted-foreground/40 mt-1 flex items-center gap-1">
          <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${pendingCount > 0 ? "bg-warning" : "bg-muted-foreground/20"}`} />
          {pendingCount > 0 ? `${pendingCount} draft${pendingCount > 1 ? "s" : ""} to review` : "nothing to review"}
        </p>
      </Link>

      <div className="w-px bg-gradient-to-b from-transparent via-foreground/[0.06] to-transparent shrink-0" />

      {/* [5] Heartbeat / Loop */}
      <div className="flex flex-col items-center justify-center px-5 py-3 w-[100px] shrink-0 relative z-10">
        <p className="text-[8px] uppercase tracking-[2px] text-muted-foreground/30 mb-2">loop</p>
        <div className="relative w-8 h-8">
          {heartbeatEnabled && <div className="absolute -inset-3 rounded-full bg-[radial-gradient(circle,oklch(0.7_0.15_150/0.04),transparent_70%)]" style={{ animation: "orb-halo-breath 4s ease-in-out infinite" }} />}
          <div className={`absolute -inset-2 rounded-full border ${heartbeatEnabled ? "border-success/[0.04]" : "border-foreground/[0.03]"}`}
            style={heartbeatEnabled ? { animation: "orb-spin 16s linear infinite" } : undefined}>
            <div className={`absolute top-1/2 -right-[1.5px] -translate-y-1/2 w-[3px] h-[3px] rounded-full ${heartbeatEnabled ? "bg-success/30 shadow-[0_0_3px_oklch(0.7_0.15_150/0.2)]" : "bg-muted-foreground/10"}`} />
          </div>
          <div className={`absolute -inset-1 rounded-full border ${heartbeatEnabled ? "border-success/[0.08]" : "border-foreground/[0.03]"}`}
            style={heartbeatEnabled ? { animation: "orb-spin-reverse 12s linear infinite" } : undefined}>
            <div className={`absolute -bottom-[1.5px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full ${heartbeatEnabled ? "bg-success/50 shadow-[0_0_4px_oklch(0.7_0.15_150/0.3)]" : "bg-muted-foreground/10"}`} />
          </div>
          <div className={`absolute inset-0 rounded-full border ${heartbeatEnabled ? "border-success/[0.15]" : "border-foreground/[0.03]"}`}
            style={heartbeatEnabled ? { animation: "orb-spin 8s linear infinite" } : undefined}>
            <div className={`absolute -top-[1.5px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full ${heartbeatEnabled ? "bg-success shadow-[0_0_6px_oklch(0.7_0.15_150/0.4)]" : "bg-muted-foreground/10"}`} />
          </div>
          <div className={`absolute inset-[8px] rounded-full transition-all duration-500 ${heartbeatEnabled ? "bg-success shadow-[0_0_10px_oklch(0.7_0.15_150/0.3)]" : "bg-muted-foreground/20"}`}
            style={heartbeatEnabled ? { animation: "orb-core-pulse 2.5s ease-in-out infinite" } : undefined} />
        </div>
        <p className={`text-[10px] mt-1.5 font-medium ${heartbeatEnabled ? "text-success" : "text-muted-foreground/30"}`}>
          {heartbeatEnabled ? (nextRun || "active") : "paused"}
        </p>
      </div>
    </div>
  );
}
