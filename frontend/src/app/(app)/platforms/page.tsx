"use client";

import { useState, useEffect } from "react";
import { Save, Loader2, Upload, AlertCircle, ExternalLink, Sparkles, Copy, Check, Info } from "lucide-react";
import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { getPlatform } from "@/lib/platforms";
import { apiFetch } from "@/lib/api";

interface PlatformProfile {
  platform: string;
  live: Record<string, unknown>;
  saved: Record<string, string>;
  editable_fields: string[];
  editable_labels?: Record<string, string>;
  edit_url?: string;
}

const HIDDEN = new Set(["profile_image_url", "pinned_tweet_id", "created_at", "link", "edit_url"]);

const fieldLabels: Record<string, string> = {
  display_name: "Display Name", handle: "Handle", bio: "Bio", username: "Username",
  description: "Description", about: "About", location: "Location", url: "Website",
  website: "Website", category: "Category", name: "Name", headline: "Headline",
  first_name: "First Name", last_name: "Last Name", locale: "Locale",
  followers_count: "Followers", following_count: "Following", tweet_count: "Tweets",
  fan_count: "Fans", media_count: "Posts",
};

// Profile page URLs (for "Edit on Platform" and "View Profile" links)
const profileUrls: Record<string, (handle: string) => string> = {
  x: (h) => `https://x.com/${h.replace("@", "")}`,
  linkedin: () => `https://linkedin.com/in/me`,
  facebook: (h) => `https://www.facebook.com/${h}`,
  instagram: (h) => `https://instagram.com/${h.replace("@", "")}`,
  threads: (h) => `https://threads.net/${h.replace("@", "")}`,
};

const editUrls: Record<string, string> = {
  x: "https://x.com/settings/profile",
  linkedin: "https://linkedin.com/in/me/edit/",
  instagram: "https://instagram.com/accounts/edit/",
  threads: "https://threads.net/settings",
};

function PlatformCard({ profile }: { profile: PlatformProfile }) {
  const p = getPlatform(profile.platform);
  const PIcon = p.icon;
  const live = profile.live || {};
  const editableSet = new Set(profile.editable_fields || []);
  const hasEditable = editableSet.size > 0;
  const editUrl = profile.edit_url || editUrls[profile.platform];

  const [editData, setEditData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [copied, setCopied] = useState(false);

  const imageUrl = live.profile_image_url as string | undefined;
  const displayName = (live.display_name || live.name || p.label) as string;
  const rawHandle = (live.handle || live.username || "") as string;
  const handle = rawHandle.startsWith("@") ? rawHandle : rawHandle ? `@${rawHandle}` : "";

  // Build profile link
  const profileUrl = profileUrls[profile.platform]?.(rawHandle) || (live.link as string) || (live.url as string);

  // Stats
  const stats = Object.entries(live).filter(([k, v]) => k.endsWith("_count") && v).map(([k, v]) => ({
    key: k, value: Number(v), label: fieldLabels[k] || k.replace(/_count$/, "").replace(/_/g, " "),
  }));

  // Info fields (read-only, not stats, not hidden, not editable)
  const infoFields = Object.entries(live).filter(
    ([k, v]) => v && !HIDDEN.has(k) && !k.endsWith("_count") && !editableSet.has(k) && k !== "display_name" && k !== "handle" && k !== "name" && k !== "username"
  );

  const handleSave = async () => {
    setSaving(true);
    try { await apiFetch(`/v1/workspace/platform-profile/${profile.platform}`, { method: "PUT", body: JSON.stringify(editData) }); setSaved(true); }
    catch {} finally { setSaving(false); }
  };

  const handlePush = async () => {
    setPushing(true); setPushError(null);
    try { await apiFetch(`/v1/workspace/platform-profile/${profile.platform}/push`, { method: "POST" }); setPushed(true); }
    catch (e) { setPushError(e instanceof Error ? e.message : "Failed"); }
    finally { setPushing(false); }
  };

  const handleAiSuggest = async () => {
    setGeneratingAi(true); setAiSuggestion(null);
    try {
      const res = await apiFetch<{ sample: string }>("/v1/training/sample", {
        method: "POST", body: JSON.stringify({ platform: profile.platform, topic: "bio and profile description" }),
      });
      setAiSuggestion(res.sample);
      // If there are editable fields, fill the first one directly
      if (hasEditable && res.sample) {
        const field = profile.editable_fields[0];
        setEditData((prev) => ({ ...prev, [field]: res.sample }));
        setSaved(false);
      }
    } catch {} finally { setGeneratingAi(false); }
  };

  const handleCopySuggestion = () => {
    if (!aiSuggestion) return;
    navigator.clipboard.writeText(aiSuggestion);
    setCopied(true);
    if (hasEditable) {
      const field = profile.editable_fields[0];
      setEditData((prev) => ({ ...prev, [field]: aiSuggestion }));
      setSaved(false);
    }
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-11 w-11 rounded-full object-cover border border-border/30" />
        ) : (
          <div className={`flex h-11 w-11 items-center justify-center rounded-full ${p.bg}`}>
            <PIcon className={`h-5 w-5 ${p.accent}`} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold truncate">{displayName}</p>
          {handle && <p className="text-[12px] text-muted-foreground truncate">{handle}</p>}
        </div>
        <div className={`flex h-7 w-7 items-center justify-center rounded ${p.bg}`}>
          <PIcon className={`h-3.5 w-3.5 ${p.accent}`} />
        </div>
      </div>

      {/* Profile link */}
      {profileUrl && (
        <a href={profileUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-accent hover:underline truncate">
          <ExternalLink className="h-3 w-3 shrink-0" />{profileUrl}
        </a>
      )}

      {/* API edit warning — right under the link */}
      {!hasEditable && (
        <div className="flex items-center gap-1.5 text-[11px] text-warning">
          <Info className="h-3 w-3 shrink-0" />
          <span>This platform does not support profile editing via API.</span>
        </div>
      )}

      {/* Stats */}
      {stats.length > 0 && (
        <div className="flex gap-4 py-1">
          {stats.map((s) => (
            <div key={s.key}>
              <span className="text-[13px] font-bold tabular-nums">{s.value.toLocaleString()}</span>
              <span className="text-[10px] text-muted-foreground ml-1">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Info fields (read-only) */}
      {infoFields.map(([k, v]) => (
        <div key={k}>
          <span className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-wider">{fieldLabels[k] || k.replace(/_/g, " ")}</span>
          <p className="text-[12px] text-muted-foreground">{String(v)}</p>
        </div>
      ))}

      {/* Editable fields — textarea with buttons INSIDE */}
      {hasEditable && profile.editable_fields.map((field) => {
        const fLabel = profile.editable_labels?.[field] || fieldLabels[field] || field.replace(/_/g, " ");
        const originalVal = String(live[field] || profile.saved[field] || "");
        const currentVal = editData[field] ?? originalVal;
        const isDirty = currentVal !== originalVal;
        return (
          <div key={field} className="border-t border-border/20 pt-3">
            <label className="text-[10px] font-semibold text-accent/80 uppercase tracking-wider mb-1 block">{fLabel}</label>
            <div className="relative">
              <textarea value={currentVal} onChange={(e) => { setEditData((prev) => ({ ...prev, [field]: e.target.value })); setSaved(false); setPushed(false); }}
                rows={3} className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 pt-2 pb-9 text-[12px] focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none" />
              {/* Buttons inside the textarea area, bottom-right */}
              <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                {saved && <span className="text-[9px] text-success mr-1">Saved</span>}
                {pushed && <span className="text-[9px] text-success mr-1">Pushed</span>}
                {pushError && <span className="text-[9px] text-danger mr-1">{pushError}</span>}
                <button onClick={handleAiSuggest} disabled={generatingAi} title="Generate with AI"
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-all ${generatingAi ? "opacity-40" : "text-accent hover:bg-accent/10"}`}>
                  {generatingAi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                </button>
                {isDirty && (
                  <button onClick={handleSave} disabled={saving}
                    className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-40">
                    {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}Save
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* AI suggestion for non-editable — copy and go edit manually */}
      {aiSuggestion && !hasEditable && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-accent/20 bg-accent/5 p-3 space-y-2">
          <p className="text-[10px] font-semibold text-accent uppercase tracking-wider">AI Suggestion — copy and edit manually on {p.label}</p>
          <p className="text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap">{aiSuggestion}</p>
          <button onClick={handleCopySuggestion}
            className="flex items-center gap-1 text-[11px] text-accent hover:underline">
            {copied ? <><Check className="h-3 w-3" />Copied to clipboard</> : <><Copy className="h-3 w-3" />Copy to clipboard</>}
          </button>
        </motion.div>
      )}

      {/* Bottom actions — same for ALL platforms */}
      <div className="border-t border-border/20 pt-3 space-y-2">
        <div className="flex items-center gap-2">
          {!aiSuggestion && !hasEditable && (
            <button onClick={handleAiSuggest} disabled={generatingAi}
              className="flex items-center gap-1 rounded-md border border-accent/30 px-3 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40">
              {generatingAi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Suggest with AI
            </button>
          )}
          {hasEditable && pushed ? null : hasEditable && (
            <button onClick={handlePush} disabled={pushing}
              className="flex items-center gap-1 rounded-md border border-accent/30 px-3 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40">
              {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Push to {p.label}
            </button>
          )}
          {editUrl && (
            <a href={editUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground hover:opacity-90">
              <ExternalLink className="h-3 w-3" />Edit on {p.label}
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function PlatformsPage() {
  const [profiles, setProfiles] = useState<Record<string, PlatformProfile>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Record<string, PlatformProfile>>("/v1/workspace/platform-profiles")
      .then(setProfiles)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error) return <div className="flex items-center justify-center h-64"><div className="text-center space-y-2"><AlertCircle className="h-6 w-6 text-danger mx-auto" /><p className="text-sm text-muted-foreground">{error}</p></div></div>;

  const keys = Object.keys(profiles);

  return (
    <PageContainer>
      <div className="space-y-4">
        <div>
          <h1>Platforms</h1>
          <p className="text-sm text-muted-foreground">Live profile data from your connected accounts.</p>
        </div>
        {keys.length === 0 ? (
          <div className="rounded-md border border-border/20 bg-card py-12 text-center">
            <p className="text-sm text-muted-foreground">No connected platforms. Connect them in Settings.</p>
          </div>
        ) : (
          <motion.div variants={staggerContainer} initial="initial" animate="animate" className="grid gap-4 lg:grid-cols-2 items-start">
            {keys.map((k) => <PlatformCard key={k} profile={{ ...profiles[k], platform: k }} />)}
          </motion.div>
        )}
      </div>
    </PageContainer>
  );
}
