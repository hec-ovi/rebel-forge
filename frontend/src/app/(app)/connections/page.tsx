"use client";

import { useState, useEffect } from "react";
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Trash2,
  Zap,
  Bot,
  Cloud,
  Key,
} from "lucide-react";
import { SiInstagram, SiTiktok, SiFacebook, SiThreads, SiYoutube, SiPinterest } from "react-icons/si";
import { FaXTwitter, FaLinkedinIn } from "react-icons/fa6";
import { motion, AnimatePresence } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { apiFetch } from "@/lib/api";

/* ============================================
   Types
   ============================================ */
interface ConnectionInfo {
  platform: string;
  connected: boolean;
  credentials: Record<string, string>;
  fields: string[];
}

interface PlatformMeta {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  bg: string;
}

/* ============================================
   Platform metadata
   ============================================ */
const socialPlatforms: PlatformMeta[] = [
  { id: "x", label: "X", icon: FaXTwitter, accent: "text-platform-x", bg: "bg-platform-x/10" },
  { id: "instagram", label: "Instagram", icon: SiInstagram, accent: "text-platform-instagram", bg: "bg-platform-instagram/10" },
  { id: "linkedin", label: "LinkedIn", icon: FaLinkedinIn, accent: "text-platform-linkedin", bg: "bg-platform-linkedin/10" },
  { id: "facebook", label: "Facebook", icon: SiFacebook, accent: "text-platform-facebook", bg: "bg-platform-facebook/10" },
  { id: "threads", label: "Threads", icon: SiThreads, accent: "text-platform-threads", bg: "bg-platform-threads/10" },
  { id: "tiktok", label: "TikTok", icon: SiTiktok, accent: "text-platform-tiktok", bg: "bg-platform-tiktok/10" },
  { id: "youtube", label: "YouTube", icon: SiYoutube, accent: "text-platform-youtube", bg: "bg-platform-youtube/10" },
  { id: "pinterest", label: "Pinterest", icon: SiPinterest, accent: "text-danger", bg: "bg-danger/10" },
];

const aiProviders: PlatformMeta[] = [
  { id: "vllm", label: "vLLM (Local)", icon: Bot, accent: "text-success", bg: "bg-success/10" },
  { id: "openai", label: "OpenAI", icon: Bot, accent: "text-info", bg: "bg-info/10" },
  { id: "anthropic", label: "Anthropic", icon: Bot, accent: "text-accent", bg: "bg-accent/10" },
  { id: "gemini", label: "Google Gemini", icon: Bot, accent: "text-info", bg: "bg-info/10" },
  { id: "grok", label: "xAI Grok", icon: Bot, accent: "text-platform-x", bg: "bg-platform-x/10" },
];

const services: PlatformMeta[] = [
  { id: "firecrawl", label: "Firecrawl", icon: Cloud, accent: "text-accent", bg: "bg-accent/10" },
  { id: "cloudflare_r2", label: "Cloudflare R2", icon: Cloud, accent: "text-warning", bg: "bg-warning/10" },
  { id: "comfyui", label: "ComfyUI", icon: Cloud, accent: "text-agent-analyzing", bg: "bg-agent-analyzing/10" },
];

function getMeta(id: string): PlatformMeta {
  return [...socialPlatforms, ...aiProviders, ...services].find((p) => p.id === id)
    || { id, label: id, icon: Key, accent: "text-muted-foreground", bg: "bg-muted" };
}

/* ============================================
   Connection Card
   ============================================ */
function ConnectionCard({ conn, onUpdate }: { conn: ConnectionInfo; onUpdate: () => void }) {
  const meta = getMeta(conn.platform);
  const Icon = meta.icon;

  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<Record<string, string>>(conn.credentials || {});
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; profile?: Record<string, string>; error?: string } | null>(null);

  const isSecret = (key: string) => key.includes("secret") || key.includes("token") || key.includes("key");

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch(`/v1/connections/${conn.platform}`, {
        method: "PUT",
        body: JSON.stringify({ credentials: data }),
      });
      onUpdate();
    } catch {}
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<{ status: string; profile?: Record<string, string>; error?: string }>(
        `/v1/connections/${conn.platform}/test`,
        { method: "POST" }
      );
      setTestResult(res);
    } catch (e) {
      setTestResult({ status: "error", error: e instanceof Error ? e.message : "Failed" });
    }
    finally { setTesting(false); }
  };

  const handleDisconnect = async () => {
    try {
      await apiFetch(`/v1/connections/${conn.platform}`, { method: "DELETE" });
      setData({});
      setTestResult(null);
      onUpdate();
    } catch {}
  };

  return (
    <motion.div variants={staggerItem} className={`rounded-md border bg-card overflow-hidden ${conn.connected ? "border-success/20" : "border-border/40"}`}>
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-3 px-4 py-3">
        <div className={`flex h-7 w-7 items-center justify-center rounded ${meta.bg}`}>
          <Icon className={`h-3.5 w-3.5 ${meta.accent}`} />
        </div>
        <span className="text-[13px] font-medium flex-1 text-left">{meta.label}</span>
        {conn.connected && (
          <span className="flex items-center gap-1 text-[10px] text-success font-medium">
            <CheckCircle2 className="h-3 w-3" />Connected
          </span>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-border/20">
            <div className="p-4 space-y-3">
              {/* Fields */}
              <div className="space-y-2.5">
                {conn.fields.map((field) => (
                  <div key={field}>
                    <label className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1 block">
                      {field.replace(/_/g, " ")}
                    </label>
                    <div className="relative">
                      <input
                        type={isSecret(field) && !visibleFields[field] ? "password" : "text"}
                        value={data[field] || ""}
                        onChange={(e) => setData((prev) => ({ ...prev, [field]: e.target.value }))}
                        placeholder={field.replace(/_/g, " ")}
                        className="w-full rounded-md border border-border bg-surface-raised/30 px-3 py-2 pr-9 text-[12px] font-mono placeholder:font-sans placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/30"
                      />
                      {isSecret(field) && (
                        <button onClick={() => setVisibleFields((p) => ({ ...p, [field]: !p[field] }))} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground">
                          {visibleFields[field] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`rounded-md px-3 py-2 text-[12px] ${testResult.status === "ok" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                  {testResult.status === "ok" ? (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Connected
                      {testResult.profile?.username && ` as ${testResult.profile.username}`}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {testResult.error || "Connection failed"}
                    </span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </button>
                <button onClick={handleTest} disabled={testing} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
                  {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Test
                </button>
                {conn.connected && (
                  <>
                    <div className="flex-1" />
                    <button onClick={handleDisconnect} className="flex items-center gap-1.5 rounded-md border border-danger/20 px-3 py-1.5 text-[12px] text-danger hover:bg-danger/10">
                      <Trash2 className="h-3 w-3" />Disconnect
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ============================================
   Section
   ============================================ */
function Section({ title, icon: SectionIcon, connections, onUpdate }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  connections: ConnectionInfo[];
  onUpdate: () => void;
}) {
  if (connections.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2">
        <SectionIcon className="h-4 w-4 text-accent" />
        {title}
      </h2>
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="grid gap-2 sm:grid-cols-2">
        {connections.map((conn) => (
          <ConnectionCard key={conn.platform} conn={conn} onUpdate={onUpdate} />
        ))}
      </motion.div>
    </div>
  );
}

/* ============================================
   Page
   ============================================ */
export default function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConnections = async () => {
    try {
      const data = await apiFetch<ConnectionInfo[]>("/v1/connections");
      setConnections(data);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadConnections(); }, []);

  const socialIds = new Set(socialPlatforms.map((p) => p.id));
  const aiIds = new Set(aiProviders.map((p) => p.id));
  const serviceIds = new Set(services.map((p) => p.id));

  const social = connections.filter((c) => socialIds.has(c.platform));
  const ai = connections.filter((c) => aiIds.has(c.platform));
  const svc = connections.filter((c) => serviceIds.has(c.platform));

  const connectedCount = connections.filter((c) => c.connected).length;

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <PageContainer>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1>Connections</h1>
          <p className="text-sm text-muted-foreground">
            {connectedCount} of {connections.length} configured. Credentials are stored in your local .env file.
          </p>
        </div>

        <div className="rounded-md border border-info/20 bg-info/5 px-3 py-2 text-[11px] text-info">
          <Key className="inline h-3 w-3 mr-1" />
          All keys are stored locally in your .env file — never sent to external services.
        </div>

        <Section title="Social Platforms" icon={FaXTwitter} connections={social} onUpdate={loadConnections} />
        <Section title="AI Providers" icon={Bot} connections={ai} onUpdate={loadConnections} />
        <Section title="Services" icon={Cloud} connections={svc} onUpdate={loadConnections} />
      </div>
    </PageContainer>
  );
}
