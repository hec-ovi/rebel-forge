"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Flame, ArrowRight, Settings } from "lucide-react";
import { motion } from "motion/react";
import { Chat } from "@/components/chat";
import { apiFetch, checkHealth } from "@/lib/api";
import { ThemeProvider } from "@/components/layout/theme-provider";

export default function OnboardingPage() {
  const router = useRouter();
  const [summaryReceived, setSummaryReceived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [llmOnline, setLlmOnline] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if ANY LLM is available (vLLM, Codex CLI, or OpenRouter)
    const checkLlm = async () => {
      try {
        const r = await apiFetch<{ active_provider: string }>("/v1/providers");
        setLlmOnline(!!r.active_provider);
      } catch {
        // Fallback: check vLLM directly
        checkHealth("http://127.0.0.1:8000/health").then(setLlmOnline);
      }
    };
    checkLlm();
    const interval = setInterval(checkLlm, 10000);
    return () => clearInterval(interval);
  }, []);

  async function handleSummary(summary: Record<string, unknown>) {
    setSummaryReceived(true);
    setSaving(true);

    try {
      const platforms = Array.isArray(summary.platforms) ? summary.platforms : [];
      const contentTypes = Array.isArray(summary.content_types) ? summary.content_types : [];
      const voice = String(summary.voice || summary.tone || "");
      const audience = String(summary.audience || "");
      const goals = String(summary.goals || summary.goal || "");
      const frequency = String(summary.frequency || "");
      const inspiration = String(summary.inspiration || "");

      await apiFetch("/v1/workspace/brand-profile", {
        method: "PUT",
        body: JSON.stringify({
          voice_summary: voice,
          audience_summary: audience,
          goals: { primary: goals, platforms },
          style_notes: {
            tone: voice.split(",").map((t: string) => t.trim()).filter(Boolean),
            content_types: contentTypes,
            frequency,
            inspiration,
          },
          reference_examples:
            typeof inspiration === "string"
              ? inspiration.split(",").map((s: string) => s.trim()).filter(Boolean)
              : [],
        }),
      });
    } catch (e) {
      console.error("Failed to save brand profile:", e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemeProvider>
      <div className="flex flex-col h-screen overflow-hidden bg-background">
        {/* Header — sticky */}
        <header className="shrink-0 flex items-center justify-between border-b border-border/50 px-6 py-3 bg-surface">
          {/* Left: logo */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
              <Flame className="h-4 w-4 text-accent" />
            </div>
            <span className="text-sm font-bold">Rebel Forge</span>
            <button
              onClick={() => {
                localStorage.setItem("rf_onboarded", "true");
                router.push("/settings");
              }}
              className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-3 w-3" />
              Config
            </button>
          </div>

          {/* Center: LLM status */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
            <span className={`relative flex h-2.5 w-2.5`}>
              {llmOnline && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
              )}
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                llmOnline === null ? "bg-muted-foreground/30" : llmOnline ? "bg-success" : "bg-danger"
              }`} />
            </span>
            <span className={`text-[11px] font-medium ${
              llmOnline === null ? "text-muted-foreground" : llmOnline ? "text-success" : "text-danger"
            }`}>
              {llmOnline === null ? "Connecting..." : llmOnline ? "Agent Online" : "Agent Offline"}
            </span>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2">
            {summaryReceived ? (
              <motion.button
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => {
                  localStorage.setItem("rf_onboarded", "true");
                  router.push("/rebel");
                }}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? "Saving..." : "Go to Dashboard"}
                <ArrowRight className="h-3.5 w-3.5" />
              </motion.button>
            ) : (
              <button
                onClick={() => {
                  localStorage.setItem("rf_onboarded", "true");
                  router.push("/rebel");
                }}
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip
              </button>
            )}
          </div>
        </header>

        {/* Chat — fills remaining space */}
        <div className="flex-1 min-h-0">
        <Chat
          mode="onboarding"
          onSummary={handleSummary}
          initialMessage="Let's set up your content engine. Which platforms are you active on? (Instagram, TikTok, LinkedIn, YouTube, X, etc.)"
        />
        </div>
      </div>
    </ThemeProvider>
  );
}
