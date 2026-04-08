"use client";

import { useState, useEffect } from "react";
import {
  Clock, Cpu, Palette, AlertTriangle, CheckCircle2, Loader2,
  Trash2, Save, Eye, EyeOff, Zap, ChevronDown, ChevronUp, Key, Bot, Cloud,
  Terminal,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useTheme } from "@/components/layout/theme-provider";
import { useAppStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { getPlatform } from "@/lib/platforms";

/* ============================================
   Shared
   ============================================ */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${checked ? "bg-accent" : "bg-muted"}`}>
      <motion.span animate={{ x: checked ? 16 : 2 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} className="mt-0.5 h-4 w-4 rounded-full bg-white shadow-sm" />
    </button>
  );
}


/* ============================================
   Connection row (expand to edit credentials)
   ============================================ */
interface ConnectionInfo {
  platform: string;
  connected: boolean;
  credentials: Record<string, string>;
  fields: string[];
}

function ConnectionRow({ conn, onUpdate }: { conn: ConnectionInfo; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<Record<string, string>>(conn.credentials || {});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; error?: string; profile?: Record<string, string> } | null>(null);

  const isSecret = (k: string) => k.includes("secret") || k.includes("token") || k.includes("key");

  // Try to get a real icon for social platforms
  const platformInfo = getPlatform(conn.platform);
  const hasPlatformIcon = platformInfo.id !== "custom";
  const PIcon = platformInfo.icon;

  const handleSave = async () => {
    setSaving(true);
    try { await apiFetch(`/v1/connections/${conn.platform}`, { method: "PUT", body: JSON.stringify({ credentials: data }) }); onUpdate(); }
    catch {} finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try { const res = await apiFetch<{ status: string; error?: string; profile?: Record<string, string> }>(`/v1/connections/${conn.platform}/test`, { method: "POST" }); setTestResult(res); }
    catch (e) { setTestResult({ status: "error", error: e instanceof Error ? e.message : "Failed" }); }
    finally { setTesting(false); }
  };

  const handleDisconnect = async () => {
    try { await apiFetch(`/v1/connections/${conn.platform}`, { method: "DELETE" }); setData({}); setTestResult(null); onUpdate(); } catch {}
  };

  // Custom labels for known platforms
  const labelMap: Record<string, string> = {
    vllm: "vLLM (Local)",
    openai: "OpenRouter",
    openrouter: "OpenRouter",
    cloudflare_r2: "Cloudflare R2",
    comfyui: "ComfyUI (Image Generation)",
    fal_ai: "fal.ai (Cloud Images)",
    firecrawl: "Firecrawl",
  };
  const label = labelMap[conn.platform] || conn.platform.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // OpenRouter model options
  const isOpenRouter = conn.platform === "openai" || conn.platform === "openrouter";
  const openRouterModels = [
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "x-ai/grok-3", label: "Grok 3" },
    { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "openai/gpt-4.1", label: "GPT-4.1" },
    { id: "openai/gpt-4o", label: "GPT-4o" },
  ];

  // fal.ai model options
  const isFalAi = conn.platform === "fal_ai";
  const falModels = [
    { id: "fal-ai/nano-banana-2", label: "Nano Banana 2 (Google, fast)" },
    { id: "fal-ai/flux/schnell", label: "FLUX Schnell (4 steps, fast)" },
    { id: "fal-ai/flux/dev", label: "FLUX Dev (28 steps, quality)" },
    { id: "fal-ai/flux-pro/v1.1", label: "FLUX Pro v1.1 (best)" },
    { id: "fal-ai/flux-2-pro", label: "FLUX 2 Pro (latest)" },
  ];

  return (
    <div className={`rounded-md border overflow-hidden ${conn.connected ? "border-success/20" : "border-border/30"}`}>
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {hasPlatformIcon ? <PIcon className={`h-3.5 w-3.5 ${platformInfo.accent}`} /> : <span className={`h-2 w-2 rounded-full shrink-0 ${conn.connected ? "bg-success" : "bg-muted-foreground/20"}`} />}
        <span className="text-[13px] font-medium flex-1">{label}</span>
        {conn.connected && <span className="text-[10px] text-success font-medium">Connected</span>}
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-border/20">
            <div className="p-3 space-y-2">
              {conn.fields.map((field) => (
                <div key={field}>
                  <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-0.5 block">{field.replace(/_/g, " ")}</label>
                  <div className="relative">
                    <input type={isSecret(field) && !visible[field] ? "password" : "text"} value={data[field] || ""} onChange={(e) => setData((p) => ({ ...p, [field]: e.target.value }))}
                      placeholder={field.replace(/_/g, " ")} className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 pr-8 text-[11px] font-mono placeholder:font-sans placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/30" />
                    {isSecret(field) && (
                      <button onClick={() => setVisible((p) => ({ ...p, [field]: !p[field] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground">
                        {visible[field] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {/* Model selector for OpenRouter */}
              {isOpenRouter && (
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-0.5 block">Model</label>
                  <select value={data.model || ""} onChange={(e) => setData((p) => ({ ...p, model: e.target.value }))}
                    className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-accent/30 appearance-none">
                    <option value="">Select a model...</option>
                    {openRouterModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              )}
              {/* Model selector for fal.ai */}
              {isFalAi && (
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-0.5 block">Model</label>
                  <select value={data.model || ""} onChange={(e) => setData((p) => ({ ...p, model: e.target.value }))}
                    className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-accent/30 appearance-none">
                    <option value="">Select a model...</option>
                    {falModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </div>
              )}
              {testResult && (
                <div className={`rounded-md px-2.5 py-1.5 text-[11px] ${testResult.status === "ok" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                  {testResult.status === "ok" ? <><CheckCircle2 className="inline h-3 w-3 mr-1" />OK{testResult.profile?.username && ` — ${testResult.profile.username}`}</> : <><AlertTriangle className="inline h-3 w-3 mr-1" />{testResult.error}</>}
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
                </button>
                <button onClick={handleTest} disabled={testing} className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                  {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}Test
                </button>
                {conn.connected && (
                  <><div className="flex-1" /><button onClick={handleDisconnect} className="flex items-center gap-1 text-[11px] text-danger hover:underline"><Trash2 className="h-3 w-3" />Disconnect</button></>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================
   AI Provider Switcher
   ============================================ */
interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  active: boolean;
  default_model: string;
  fields: string[];
}

interface ProvidersState {
  active_provider: string;
  active_model: string;
  base_url: string;
  providers: ProviderInfo[];
}

const providerIcons: Record<string, React.ElementType> = {
  vllm: Cpu,
  codex: Terminal,
  openai: Zap,
  openrouter: Cloud,
  anthropic: Bot,
  gemini: Zap,
  grok: Zap,
};

function ProviderSwitcher() {
  const [state, setState] = useState<ProvidersState | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState("");
  const [testing, setTesting] = useState("");
  const [testResult, setTestResult] = useState<Record<string, { status: string; error?: string; models?: string[] }>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, Record<string, string>>>({});

  const loadProviders = async () => {
    try {
      const data = await apiFetch<ProvidersState>("/v1/providers");
      setState(data);
      // Pre-fill fields from connections API for providers that have config
      const prefill: Record<string, Record<string, string>> = {};
      for (const pid of ["vllm", "openrouter", "fal_ai"]) {
        try {
          const conn = await apiFetch<{ credentials: Record<string, string> }>(`/v1/connections/${pid}`);
          if (conn.credentials) {
            prefill[pid] = {};
            for (const [k, v] of Object.entries(conn.credentials)) {
              if (v && !v.startsWith("****")) prefill[pid][k] = v;
            }
          }
        } catch {}
      }
      setEditFields((prev) => ({ ...prefill, ...prev }));
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadProviders(); }, []);

  const handleActivate = async (providerId: string) => {
    setSwitching(providerId);
    try {
      const fields = editFields[providerId] || {};
      await apiFetch("/v1/providers/active", {
        method: "PUT",
        body: JSON.stringify({
          provider: providerId,
          api_key: fields.api_key || "",
          model: fields.model || "",
          base_url: fields.base_url || "",
        }),
      });
      await loadProviders();
    } catch {}
    finally { setSwitching(""); }
  };

  const handleTest = async (providerId: string) => {
    setTesting(providerId);
    try {
      const fields = editFields[providerId] || {};
      const res = await apiFetch<{ status: string; error?: string; models?: string[] }>("/v1/providers/test", {
        method: "POST",
        body: JSON.stringify({
          provider: providerId,
          api_key: fields.api_key || "",
          model: fields.model || "",
          base_url: fields.base_url || "",
        }),
      });
      setTestResult((p) => ({ ...p, [providerId]: res }));
    } catch (e) {
      setTestResult((p) => ({ ...p, [providerId]: { status: "error", error: e instanceof Error ? e.message : "Failed" } }));
    }
    finally { setTesting(""); }
  };

  const setField = (providerId: string, field: string, value: string) => {
    setEditFields((p) => ({ ...p, [providerId]: { ...p[providerId], [field]: value } }));
  };

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  if (!state) return null;

  // Show only these providers in this order
  const displayOrder = ["vllm", "codex", "openrouter"];
  const providers = displayOrder
    .map((id) => state.providers.find((p) => p.id === id))
    .filter(Boolean) as ProviderInfo[];

  return (
    <div className="space-y-2">
      {providers.map((p) => {
        const Icon = providerIcons[p.id] || Bot;
        const isActive = p.active;
        const isExpanded = expanded === p.id;
        const tr = testResult[p.id];
        const fields = editFields[p.id] || {};
        const isCodex = p.id === "codex";

        return (
          <div key={p.id} className={`rounded-md border overflow-hidden transition-colors ${isActive ? "border-success/30 bg-success/5" : "border-border/30"}`}>
            <button onClick={() => setExpanded(isExpanded ? null : p.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
              <Icon className={`h-3.5 w-3.5 ${isActive ? "text-success" : "text-muted-foreground"}`} />
              <span className="text-[13px] font-medium flex-1">{p.name}</span>
              {isActive && (
                <span className="flex items-center gap-1 text-[10px] text-success font-semibold">
                  <CheckCircle2 className="h-3 w-3" />Active
                </span>
              )}
              {isActive && <span className="text-[10px] text-muted-foreground font-mono">{state.active_model}</span>}
              {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
            </button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-border/20">
                  <div className="p-3 space-y-2">
                    {isCodex && (
                      <p className="text-[11px] text-muted-foreground">Spawns the local Codex CLI agent. Uses your OPENAI_API_KEY from env. Frontier models with agentic tool calling.</p>
                    )}

                    {/* Fields */}
                    {p.fields.filter((f) => f !== "model" || !isCodex).map((field) => (
                      <div key={field}>
                        <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-0.5 block">{field.replace(/_/g, " ")}</label>
                        <input
                          type={field.includes("key") || field.includes("secret") ? "password" : "text"}
                          value={fields[field] || ""}
                          onChange={(e) => setField(p.id, field, e.target.value)}
                          placeholder={field === "model" ? p.default_model : field.replace(/_/g, " ")}
                          className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[11px] font-mono placeholder:font-sans placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        />
                      </div>
                    ))}

                    {/* Model selector for openrouter */}
                    {p.id === "openrouter" && (
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-0.5 block">Model</label>
                        <select value={fields.model || ""} onChange={(e) => setField(p.id, "model", e.target.value)}
                          className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-accent/30 appearance-none">
                          <option value="">Default ({p.default_model})</option>
                          <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
                          <option value="x-ai/grok-3">Grok 3</option>
                          <option value="anthropic/claude-sonnet-4-6">Claude Sonnet 4.6</option>
                          <option value="openai/gpt-4.1">GPT-4.1</option>
                        </select>
                      </div>
                    )}

                    {/* Test result */}
                    {tr && (
                      <div className={`rounded-md px-2.5 py-1.5 text-[11px] ${tr.status === "ok" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                        {tr.status === "ok" ? (
                          <><CheckCircle2 className="inline h-3 w-3 mr-1" />OK{tr.models?.length ? ` — ${tr.models[0]}` : ""}</>
                        ) : (
                          <><AlertTriangle className="inline h-3 w-3 mr-1" />{tr.error}</>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      {!isActive && (
                        <button onClick={() => handleActivate(p.id)} disabled={!!switching}
                          className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                          {switching === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}Activate
                        </button>
                      )}
                      <button onClick={() => handleTest(p.id)} disabled={!!testing}
                        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                        {testing === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}Test
                      </button>
                      {isActive && <span className="text-[10px] text-success ml-auto">Currently active</span>}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================
   Page
   ============================================ */
export default function SettingsPage() {
  const { theme } = useTheme();
  const readiness = useAppStore((s) => s.readiness);
  const refreshReadiness = useAppStore((s) => s.refreshReadiness);

  const [autoApprove, setAutoApprove] = useState(false);
  const [heartbeatHours, setHeartbeatHours] = useState(6);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);

  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [loadingConns, setLoadingConns] = useState(true);

  const loadConnections = async () => {
    try { const data = await apiFetch<ConnectionInfo[]>("/v1/connections"); setConnections(data); } catch {}
    finally { setLoadingConns(false); }
  };

  useEffect(() => {
    refreshReadiness();
    loadConnections();
    apiFetch<{ last_run: string | null; interval_hours: number }>("/v1/heartbeat/status").then((d) => setHeartbeatHours(d.interval_hours)).catch(() => {});
    apiFetch<{ brand_profile?: { style_notes?: { heartbeat?: { enabled: boolean; interval_hours: number; auto_approve: boolean } } } }>("/v1/workspace")
      .then((d) => { const hb = d.brand_profile?.style_notes?.heartbeat; if (hb) { setHeartbeatEnabled(hb.enabled); setHeartbeatHours(hb.interval_hours); setAutoApprove(hb.auto_approve); } }).catch(() => {});
  }, [refreshReadiness]);

  const saveHB = async (enabled: boolean, hours: number, aa: boolean) => {
    try { await apiFetch("/v1/heartbeat/config", { method: "PUT", body: JSON.stringify({ enabled, interval_hours: hours, auto_approve: aa }) }); } catch {}
  };

  // Group connections
  const socialIds = new Set(["x", "instagram", "linkedin", "facebook", "threads", "tiktok", "youtube", "pinterest"]);
  const hideFromServices = new Set(["vllm", "openai", "anthropic", "gemini", "grok", "openrouter", "codex"]);
  const platformConns = connections.filter((c) => socialIds.has(c.platform));
  const serviceConns = connections.filter((c) => !socialIds.has(c.platform) && !hideFromServices.has(c.platform));

  const systemOrder = ["database", "llm", "vllm", "comfyui", "firecrawl", "fal_ai", "cloudflare_r2"];

  return (
    <PageContainer>
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-5">
        <div>
          <h1>Settings</h1>
          <p className="text-sm text-muted-foreground">System status, connections, and preferences.</p>
        </div>

        {/* Setup wizard */}
        {readiness && !readiness.setup_complete && (
          <motion.div variants={staggerItem} className="rounded-md border border-warning/30 bg-warning/5 p-4 space-y-2">
            <h3 className="flex items-center gap-2 text-warning"><AlertTriangle className="h-4 w-4" />Setup Required</h3>
            {!readiness.systems.llm?.ready && <p className="text-[12px] flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-danger" />Configure LLM in Providers below</p>}
            {!readiness.systems.database?.ready && <p className="text-[12px] flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-danger" />Start PostgreSQL</p>}
            {readiness.summary.platforms_ready === 0 && <p className="text-[12px] flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-danger" />Connect at least one social platform</p>}
          </motion.div>
        )}

        {/* 2 columns */}
        <div className="grid gap-5 lg:grid-cols-2 items-start">

          {/* ===== LEFT: Providers, Platforms, Services ===== */}
          <div className="space-y-5">
            {/* AI Providers */}
            <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-2">
              <h3 className="flex items-center gap-2"><Bot className="h-4 w-4" />AI Provider</h3>
              <p className="text-[11px] text-muted-foreground">Select which AI powers the agent. Only one active at a time.</p>
              <ProviderSwitcher />
            </motion.div>

            {/* Social Platforms */}
            <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-2">
              <h3 className="flex items-center gap-2"><Key className="h-4 w-4" />Platforms</h3>
              <p className="text-[11px] text-muted-foreground">Click to view/edit API credentials. Stored in .env.</p>
              {loadingConns ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : (
                platformConns.length > 0 ? platformConns.map((c) => <ConnectionRow key={c.platform} conn={c} onUpdate={loadConnections} />) : <p className="text-[11px] text-muted-foreground/50 py-2">No platforms found</p>
              )}
            </motion.div>

            {/* Services */}
            <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-2">
              <h3 className="flex items-center gap-2"><Cloud className="h-4 w-4" />Services</h3>
              {loadingConns ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : (
                serviceConns.length > 0 ? serviceConns.map((c) => {
                  // Override connected status with live readiness check
                  const sysReady = readiness?.systems[c.platform]?.ready;
                  const enriched = sysReady && !c.connected ? { ...c, connected: true } : c;
                  return <ConnectionRow key={c.platform} conn={enriched} onUpdate={loadConnections} />;
                }) : <p className="text-[11px] text-muted-foreground/50 py-2">No services found</p>
              )}
            </motion.div>
          </div>

          {/* ===== RIGHT: Preferences + Status ===== */}
          <div className="space-y-5">
            {/* Appearance */}
            <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-3">
              <h3 className="flex items-center gap-2"><Palette className="h-4 w-4" />Appearance</h3>
              <div className="flex items-center justify-between">
                <div><p className="text-[13px]">Theme</p><p className="text-[11px] text-muted-foreground capitalize">{theme}</p></div>
                <ThemeToggle />
              </div>
            </motion.div>

            {/* Heartbeat — simple on/off + interval */}
            <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2"><Clock className="h-4 w-4" />Heartbeat</h3>
                <Toggle checked={heartbeatEnabled} onChange={(v) => { setHeartbeatEnabled(v); saveHB(v, heartbeatHours, autoApprove); }} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[12px] text-muted-foreground">Every</span>
                <input type="number" min={1} max={72} value={heartbeatHours} onChange={(e) => setHeartbeatHours(Number(e.target.value))}
                  onBlur={() => saveHB(heartbeatEnabled, heartbeatHours, autoApprove)}
                  className="w-14 rounded-md border border-input bg-surface-raised/50 px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-accent/30" />
                <span className="text-[12px] text-muted-foreground">hours</span>
                <span className={`ml-auto text-[11px] font-medium ${heartbeatEnabled ? "text-success" : "text-muted-foreground/40"}`}>
                  {heartbeatEnabled ? "Active" : "Off"}
                </span>
              </div>
            </motion.div>

            {/* Systems — grouped by local vs cloud */}
            <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-3">
              <h3 className="flex items-center gap-2"><Cpu className="h-4 w-4" />Systems</h3>
              {!readiness ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : (() => {
                const systems = readiness.systems;
                const allKeys = systemOrder.filter((k) => k in systems).concat(Object.keys(systems).filter((k) => !systemOrder.includes(k)));
                const activeKeys = allKeys.filter((k) => systems[k].group === "active");
                const localKeys = allKeys.filter((k) => systems[k].group === "local");
                const cloudKeys = allKeys.filter((k) => systems[k].group === "cloud");
                const coreKeys = allKeys.filter((k) => systems[k].group === "core" || (!systems[k].group && k === "database"));
                const renderRow = (key: string) => {
                  const sys = systems[key];
                  const conn = connections.find((c) => c.platform === key);
                  const isReady = sys.ready || conn?.connected || false;
                  return (
                    <div key={key} className="flex items-center justify-between rounded-md bg-surface-raised/30 px-3 py-2">
                      <p className="text-[13px] font-medium">{sys.label}</p>
                      <span className={`flex items-center gap-1 text-[11px] font-medium ${isReady ? "text-success" : "text-muted-foreground/40"}`}>
                        {isReady ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full border border-current" />}
                        {isReady ? "Ready" : "Off"}
                      </span>
                    </div>
                  );
                };
                return (
                  <div className="space-y-3">
                    {coreKeys.length > 0 && <div className="space-y-1">{coreKeys.map(renderRow)}</div>}
                    {activeKeys.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Active Provider</p>
                        {activeKeys.map(renderRow)}
                      </div>
                    )}
                    {localKeys.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Local</p>
                        {localKeys.map(renderRow)}
                      </div>
                    )}
                    {cloudKeys.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Cloud</p>
                        {cloudKeys.map(renderRow)}
                      </div>
                    )}
                  </div>
                );
              })()}
            </motion.div>

            {/* Features — collapsible */}
            {readiness && (
              <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card overflow-hidden">
                <button onClick={() => setShowFeatures(!showFeatures)} className="flex w-full items-center gap-2 p-4">
                  <Cpu className="h-4 w-4" />
                  <h3 className="flex-1 text-left text-base font-semibold">Features</h3>
                  <span className="text-[11px] text-muted-foreground tabular-nums mr-2">{readiness.summary.features_available}/{readiness.summary.features_total}</span>
                  {showFeatures ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
                <AnimatePresence>
                  {showFeatures && (
                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="px-4 pb-4 space-y-1.5">
                        {Object.entries(readiness.features).map(([key, enabled]) => (
                          <div key={key} className="flex items-center justify-between rounded-md bg-surface-raised/30 px-3 py-2">
                            <p className="text-[13px] font-medium capitalize">{key.replace(/_/g, " ")}</p>
                            <span className={`flex items-center gap-1 text-[11px] font-medium ${enabled ? "text-success" : "text-muted-foreground/40"}`}>
                              {enabled ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full border border-current" />}
                              {enabled ? "Active" : "Disabled"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Danger zone */}
            <motion.div variants={staggerItem} className="rounded-md border border-danger/20 bg-card p-4 space-y-3">
              <h3 className="flex items-center gap-2 text-danger"><Trash2 className="h-4 w-4" />Danger Zone</h3>
              <p className="text-[12px] text-muted-foreground">Delete all data. API keys in .env are preserved.</p>
              {!showResetConfirm ? (
                <button onClick={() => setShowResetConfirm(true)} className="flex items-center gap-1.5 rounded-md border border-danger/30 px-4 py-1.5 text-[12px] font-medium text-danger hover:bg-danger/10 transition-colors">
                  <Trash2 className="h-3 w-3" />Reset Account
                </button>
              ) : (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-danger/30 bg-danger/5 p-3 space-y-2">
                  <p className="text-[12px] font-medium text-danger">Delete ALL data. Are you sure?</p>
                  <div className="flex items-center gap-2">
                    <button onClick={async () => {
                      setResetting(true);
                      try { await apiFetch("/v1/account/reset", { method: "POST" }); localStorage.removeItem("rf_token"); localStorage.removeItem("rf_role"); localStorage.removeItem("rf_onboarded"); sessionStorage.clear(); window.location.href = "/login"; }
                      catch (e) { console.error("Reset failed:", e); setResetting(false); }
                    }} disabled={resetting} className="flex items-center gap-1.5 rounded-md bg-danger px-4 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                      {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      {resetting ? "Resetting..." : "Yes, reset everything"}
                    </button>
                    <button onClick={() => setShowResetConfirm(false)} className="text-[12px] text-muted-foreground hover:text-foreground">Cancel</button>
                  </div>
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </motion.div>
    </PageContainer>
  );
}
