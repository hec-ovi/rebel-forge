"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertCircle, Sparkles, Send, Star, CheckCircle2,
  Brain, TrendingUp, RefreshCw, Plus, Trash2, Package, X,
  Save,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { PageContainer } from "@/components/common/page-container";
import { platformList, getPlatform } from "@/lib/platforms";
import { apiFetch } from "@/lib/api";

interface TrainingStatus {
  corrections_count: number;
  total_drafts: number;
  has_recommendations: boolean;
  training_level: "none" | "basic" | "moderate" | "strong";
}

interface Correction {
  platform: string;
  original: string;
  corrected: string;
  feedback: string;
  rating: number;
  had_edits: boolean;
  source: string;
  created_at: string;
}

interface Product {
  id: string; name: string; description: string; target_audience: string;
  key_features: string[]; links: Record<string, string>; tags: string[];
}

const levelConfig: Record<string, { label: string; color: string; bg: string; progress: number }> = {
  none: { label: "Untrained", color: "text-muted-foreground", bg: "bg-muted", progress: 0 },
  basic: { label: "Learning", color: "text-warning", bg: "bg-warning", progress: 25 },
  moderate: { label: "Getting better", color: "text-info", bg: "bg-info", progress: 60 },
  strong: { label: "Well trained", color: "text-success", bg: "bg-success", progress: 90 },
};

// Only show connected platforms
const activePlatforms = platformList.filter((p) =>
  ["x", "linkedin", "instagram", "threads", "facebook"].includes(p.id)
);

function RatingStars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} onClick={() => onChange(s)} className={`transition-colors ${s <= value ? "text-warning" : "text-muted-foreground/20 hover:text-muted-foreground/50"}`}>
          <Star className={`h-5 w-5 ${s <= value ? "fill-current" : ""}`} />
        </button>
      ))}
      <span className="text-[11px] text-muted-foreground ml-2">
        {value === 0 ? "Rate this sample" : value <= 2 ? "Needs work" : value === 3 ? "OK" : value === 4 ? "Good" : "Perfect"}
      </span>
    </div>
  );
}

/* ============================================
   Correction Modal — centered overlay
   ============================================ */
function CorrectionModal({
  sample,
  platform,
  onSubmit,
  onClose,
}: {
  sample: string;
  platform: string;
  onSubmit: (data: { corrected: string; feedback: string; rating: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [corrected, setCorrected] = useState(sample);
  const [feedback, setFeedback] = useState("");
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const plat = getPlatform(platform);
  const PIcon = plat.icon;

  const handleSubmit = async () => {
    if (rating === 0) return;
    setSubmitting(true);
    try {
      await onSubmit({ corrected, feedback, rating });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg rounded-xl border border-border/40 bg-card shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/20">
          <div className="flex items-center gap-2">
            <PIcon className={`h-4 w-4 ${plat.accent}`} />
            <h3 className="text-[14px] font-bold">Rate & Correct</h3>
            <span className={`text-[11px] ${plat.accent}`}>{plat.label}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Original */}
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Original</span>
            <div className="mt-1 rounded-lg bg-muted/20 border border-border/10 p-3 text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{sample}</div>
          </div>

          {/* Rating */}
          <RatingStars value={rating} onChange={setRating} />

          {/* Feedback */}
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Notes for the agent</span>
            <input type="text" value={feedback} onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. too buzzy, avoid emojis, be more direct..."
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>

          {/* Your version */}
          <div>
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Your version</span>
            <textarea value={corrected} onChange={(e) => setCorrected(e.target.value)} rows={5}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none leading-relaxed" />
            {corrected !== sample && <p className="text-[10px] text-accent mt-1">Changes detected — agent will learn from edits.</p>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border/20">
          <button onClick={handleSubmit} disabled={submitting || rating === 0}
            className="flex items-center gap-1.5 rounded-lg bg-success px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {submitting ? "Submitting..." : "Submit Correction"}
          </button>
          {rating === 0 && <span className="text-[10px] text-muted-foreground">Rate first to submit</span>}
          <div className="flex-1" />
          <button onClick={onClose} className="text-[12px] text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ============================================
   Style Guide Input — reusable for general + per-platform
   ============================================ */
function StyleGuideInput({
  label, sublabel, placeholder, value, editingKey, currentEditing,
  styleText, saving, onEdit, onChange, onSave, onCancel,
  icon: Icon, accent,
}: {
  label: string; sublabel: string; placeholder: string; value: string;
  editingKey: string; currentEditing: string | null;
  styleText: string; saving: boolean;
  onEdit: () => void; onChange: (v: string) => void;
  onSave: () => void; onCancel: () => void;
  icon?: React.ElementType; accent?: string;
}) {
  const isEditing = currentEditing === editingKey;
  return (
    <div className="rounded-lg border border-border/20 bg-surface-raised/10 p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        {Icon && <Icon className={`h-3.5 w-3.5 ${accent || ""}`} />}
        {!Icon && <Brain className="h-3.5 w-3.5 text-accent" />}
        <span className="text-[11px] font-semibold">{label}</span>
        <span className="text-[9px] text-muted-foreground/40">{sublabel}</span>
        <div className="flex-1" />
        {!isEditing && <button onClick={onEdit} className="text-[10px] text-accent hover:underline">{value ? "edit" : "set"}</button>}
      </div>
      {isEditing ? (
        <div className="space-y-2">
          <textarea value={styleText} onChange={(e) => onChange(e.target.value)} rows={2}
            placeholder={placeholder}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none" />
          <div className="flex items-center gap-2">
            <button onClick={onSave} disabled={saving}
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save
            </button>
            <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      ) : value ? (
        <p className="text-[11px] text-muted-foreground leading-relaxed">{value}</p>
      ) : (
        <p className="text-[10px] text-muted-foreground/30 italic">{placeholder}</p>
      )}
    </div>
  );
}

/* ============================================
   Main Page
   ============================================ */
export default function TrainingPage() {
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [platformStyles, setPlatformStyles] = useState<Record<string, { description: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedPlatform, setSelectedPlatform] = useState("x");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [topic, setTopic] = useState("");
  const [generating, setGenerating] = useState(false);
  const [showProductForm, setShowProductForm] = useState(false);

  // Modal state — completely separate from generation
  const [modalSample, setModalSample] = useState<string | null>(null);
  const [modalPlatform, setModalPlatform] = useState("");

  // Platform style editing
  const [editingStyle, setEditingStyle] = useState<string | null>(null);
  const [styleText, setStyleText] = useState("");
  const [savingStyle, setSavingStyle] = useState(false);

  // History filter
  const [historyPlatformFilter, setHistoryPlatformFilter] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [s, p, c, ps] = await Promise.all([
        apiFetch<TrainingStatus>("/v1/training/status"),
        apiFetch<{ products: Product[] }>("/v1/products").catch(() => ({ products: [] })),
        apiFetch<{ corrections: Correction[] }>("/v1/training/corrections?limit=50").catch(() => ({ corrections: [] })),
        apiFetch<Record<string, { description: string }>>("/v1/training/platform-styles").catch(() => ({})),
      ]);
      setStatus(s);
      setProducts(p.products || []);
      setCorrections(c.corrections || []);
      setPlatformStyles(ps);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const body: Record<string, string> = { platform: selectedPlatform };
      if (topic) body.topic = topic;
      if (selectedProduct) body.product_id = selectedProduct;
      const data = await apiFetch<{ sample: string }>("/v1/training/sample", { method: "POST", body: JSON.stringify(body) });
      if (data.sample) {
        setModalSample(data.sample);
        setModalPlatform(selectedPlatform);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setGenerating(false); }
  };

  const handleModalSubmit = async (data: { corrected: string; feedback: string; rating: number }) => {
    if (!modalSample) return;
    const body: Record<string, unknown> = {
      original: modalSample,
      corrected: data.corrected,
      feedback: data.feedback || undefined,
      platform: modalPlatform,
      rating: data.rating,
    };
    if (topic) body.topic = topic;
    if (selectedProduct) body.product_id = selectedProduct;
    await apiFetch("/v1/training/feedback", { method: "POST", body: JSON.stringify(body) });
    setModalSample(null);
    loadData();
  };

  const handleSaveStyle = async (platform: string) => {
    setSavingStyle(true);
    try {
      await apiFetch(`/v1/training/platform-styles/${platform}`, {
        method: "PUT",
        body: JSON.stringify({ platform, style_description: styleText }),
      });
      setPlatformStyles((prev) => ({ ...prev, [platform]: { description: styleText } }));
      setEditingStyle(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSavingStyle(false); }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await apiFetch(`/v1/products/${id}`, { method: "DELETE" });
      setProducts((p) => p.filter((x) => x.id !== id));
      if (selectedProduct === id) setSelectedProduct("");
    } catch {}
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const level = status ? levelConfig[status.training_level] : levelConfig.none;
  const filteredCorrections = historyPlatformFilter
    ? corrections.filter((c) => c.platform === historyPlatformFilter)
    : corrections;

  return (
    <PageContainer>
      <motion.div variants={staggerContainer} initial="initial" animate="animate" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1>Training Center</h1>
            <p className="text-sm text-muted-foreground">Teach the agent your voice — per platform.</p>
          </div>
          <button onClick={loadData} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
        </div>

        {error && (
          <div className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-[12px] text-danger flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5" />{error}
            <button onClick={() => setError(null)} className="ml-auto text-muted-foreground hover:text-foreground">dismiss</button>
          </div>
        )}

        {/* Training Level bar */}
        <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4">
          <div className="flex items-center gap-4">
            <Brain className="h-5 w-5 text-accent shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-semibold">Training Level</span>
                <span className={`text-[12px] font-semibold ${level.color}`}>{level.label}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${level.progress}%` }} transition={{ duration: 0.8 }} className={`h-full rounded-full ${level.bg}`} />
              </div>
            </div>
            <div className="text-center shrink-0">
              <p className="text-lg font-bold tabular-nums">{status?.corrections_count ?? 0}</p>
              <p className="text-[9px] text-muted-foreground">corrections</p>
            </div>
          </div>
        </motion.div>

        {/* Platform tabs + Generate */}
        <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-4">
          <h3 className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" />Generate & Train</h3>

          {/* Platform selector */}
          <div className="flex items-center gap-1 flex-wrap">
            {activePlatforms.map((p) => {
              const Icon = p.icon;
              const styleExists = !!platformStyles[p.id]?.description;
              return (
                <button key={p.id} onClick={() => setSelectedPlatform(p.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all ${selectedPlatform === p.id ? `${p.bg} ${p.accent} border border-current/20` : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-surface-raised border border-transparent"}`}>
                  <Icon className="h-3.5 w-3.5" />
                  {p.label}
                  {styleExists && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
                </button>
              );
            })}
          </div>

          {/* General voice — applies to all platforms */}
          <StyleGuideInput
            label="General Voice"
            sublabel="Applies to all platforms"
            placeholder="e.g. No fluff. No emojis. Write like a builder, not a marketer. Never invent stats."
            value={platformStyles["general"]?.description || ""}
            editingKey="general"
            currentEditing={editingStyle}
            styleText={styleText}
            saving={savingStyle}
            onEdit={() => { setEditingStyle("general"); setStyleText(platformStyles["general"]?.description || ""); }}
            onChange={setStyleText}
            onSave={() => handleSaveStyle("general")}
            onCancel={() => setEditingStyle(null)}
          />

          {/* Per-platform style */}
          <StyleGuideInput
            label={`${getPlatform(selectedPlatform).label} Style`}
            sublabel="Overrides general voice for this platform"
            placeholder={`e.g. ${selectedPlatform === "x" ? "Max 2 sentences. No hashtags. Raw and confrontational." : selectedPlatform === "linkedin" ? "3-5 paragraphs. Storytelling. End with engagement question." : "Keep it visual-friendly. Short hook first line."}`}
            value={platformStyles[selectedPlatform]?.description || ""}
            editingKey={selectedPlatform}
            currentEditing={editingStyle}
            styleText={styleText}
            saving={savingStyle}
            onEdit={() => { setEditingStyle(selectedPlatform); setStyleText(platformStyles[selectedPlatform]?.description || ""); }}
            onChange={setStyleText}
            onSave={() => handleSaveStyle(selectedPlatform)}
            onCancel={() => setEditingStyle(null)}
            icon={getPlatform(selectedPlatform).icon}
            accent={getPlatform(selectedPlatform).accent}
          />

          {/* Topic + Product */}
          <div className="flex items-center gap-2">
            <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional)"
              className="flex-1 rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/30" />
            <button onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-1.5 rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50 shrink-0">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "Generating..." : "Generate Sample"}
            </button>
          </div>

          {selectedProduct && (
            <div className="flex items-center gap-2 text-[11px]">
              <Package className="h-3 w-3 text-accent" /><span className="text-muted-foreground">For:</span>
              <span className="text-accent font-medium">{products.find((p) => p.id === selectedProduct)?.name}</span>
              <button onClick={() => setSelectedProduct("")} className="text-muted-foreground/40 hover:text-foreground">clear</button>
            </div>
          )}
        </motion.div>

        {/* Two columns: History (left) + Products (right) */}
        <div className="grid gap-5 lg:grid-cols-3 items-start">

          {/* History — 2/3 width */}
          <div className="lg:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Training History
              </h3>
              <span className="text-[11px] text-muted-foreground tabular-nums">{filteredCorrections.length} corrections</span>
              <div className="flex-1" />
              {/* Platform filter for history */}
              <div className="flex items-center gap-1">
                <button onClick={() => setHistoryPlatformFilter(null)}
                  className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${!historyPlatformFilter ? "bg-accent/10 text-accent" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
                  All
                </button>
                {activePlatforms.map((p) => {
                  const Icon = p.icon;
                  return (
                    <button key={p.id} onClick={() => setHistoryPlatformFilter(historyPlatformFilter === p.id ? null : p.id)}
                      className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md transition-colors ${historyPlatformFilter === p.id ? `${p.bg} ${p.accent}` : "text-muted-foreground/30 hover:text-muted-foreground"}`}>
                      <Icon className="h-3 w-3" />
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredCorrections.length === 0 ? (
              <div className="rounded-md border border-border/20 bg-surface-raised/10 p-6 text-center">
                <p className="text-[12px] text-muted-foreground/50">No corrections yet. Generate a sample and train the agent.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredCorrections.map((c, i) => {
                  const cp = getPlatform(c.platform);
                  const CIcon = cp.icon;
                  return (
                    <div key={i} className="rounded-md border-l-[3px] border border-border/20 bg-surface-raised/10 p-3 space-y-1.5"
                      style={{ borderLeftColor: c.had_edits ? `var(--platform-${c.platform})` : "var(--muted)" }}>
                      <div className="flex items-center gap-2">
                        <CIcon className={`h-3 w-3 ${cp.accent}`} />
                        <span className={`text-[11px] font-medium ${cp.accent}`}>{cp.label}</span>
                        <div className="flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <Star key={s} className={`h-2.5 w-2.5 ${s <= c.rating ? "text-warning fill-current" : "text-muted-foreground/15"}`} />
                          ))}
                        </div>
                        <span className="ml-auto text-[10px] text-muted-foreground/40 tabular-nums">
                          {c.created_at ? new Date(c.created_at).toLocaleDateString("en", { month: "short", day: "numeric" }) : ""}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2">{c.original}</p>
                      {c.had_edits && (
                        <p className="text-[11px] text-success/80 line-clamp-2 bg-success/5 rounded px-2 py-1">{c.corrected}</p>
                      )}
                      {c.feedback && (
                        <p className="text-[10px] text-info/70 italic">&ldquo;{c.feedback}&rdquo;</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Products — 1/3 width */}
          <div className="space-y-4">
            <motion.div variants={staggerItem} className="rounded-md border border-border/40 bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2"><Package className="h-4 w-4" />Products</h3>
                <button onClick={() => setShowProductForm(!showProductForm)} className="flex items-center gap-1 text-[11px] text-accent hover:underline"><Plus className="h-3 w-3" />Add</button>
              </div>

              <AnimatePresence>
                {showProductForm && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <ProductForm onSave={() => { setShowProductForm(false); loadData(); }} onCancel={() => setShowProductForm(false)} />
                  </motion.div>
                )}
              </AnimatePresence>

              {products.length > 0 ? (
                <div className="space-y-1.5">
                  {products.map((product) => (
                    <div key={product.id} className={`flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors ${selectedProduct === product.id ? "bg-accent/10 border border-accent/20" : "bg-surface-raised/20 border border-transparent hover:bg-surface-raised/40"}`}
                      onClick={() => setSelectedProduct(selectedProduct === product.id ? "" : product.id)}>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{product.name}</p>
                        {product.description && <p className="text-[10px] text-muted-foreground truncate">{product.description}</p>}
                      </div>
                      {selectedProduct === product.id && <span className="text-[9px] text-accent font-semibold">Selected</span>}
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteProduct(product.id); }} className="text-muted-foreground/30 hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground/50 py-2">No products yet.</p>
              )}
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Correction Modal */}
      <AnimatePresence>
        {modalSample && (
          <CorrectionModal
            sample={modalSample}
            platform={modalPlatform}
            onSubmit={handleModalSubmit}
            onClose={() => setModalSample(null)}
          />
        )}
      </AnimatePresence>
    </PageContainer>
  );
}

/* ============================================
   Product Form (unchanged)
   ============================================ */
function ProductForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [features, setFeatures] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/v1/products", { method: "POST", body: JSON.stringify({ name, description, target_audience: audience, key_features: features.split(",").map((f) => f.trim()).filter(Boolean), links: {}, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) }) });
      onSave();
    } catch {} finally { setSaving(false); }
  };

  return (
    <div className="rounded-md border border-accent/20 bg-accent/5 p-3 space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name *" className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/30" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={2} className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/30 resize-none" />
      <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Target audience" className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/30" />
      <input value={features} onChange={(e) => setFeatures(e.target.value)} placeholder="Key features (comma-separated)" className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/30" />
      <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags (comma-separated)" className="w-full rounded-md border border-border bg-surface-raised/30 px-2.5 py-1.5 text-[12px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-accent/30" />
      <div className="flex items-center gap-2">
        <button onClick={handleSave} disabled={saving || !name.trim()} className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[11px] font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}Save
        </button>
        <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    </div>
  );
}
