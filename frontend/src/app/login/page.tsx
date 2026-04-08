"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flame, ArrowRight, AlertCircle, Copy, Check } from "lucide-react";
import { motion } from "motion/react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { API_BASE } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchedToken, setFetchedToken] = useState<string | null>(null);
  const [fetchingToken, setFetchingToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGetToken = async () => {
    setFetchingToken(true);
    try {
      const res = await fetch(`${API_BASE}/v1/auth/tokens`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const ownerToken = data.owner_token || data.token || (Array.isArray(data) ? data[0] : "");
      setFetchedToken(ownerToken);
    } catch {
      setError("Cannot reach backend to fetch token");
    } finally {
      setFetchingToken(false);
    }
  };

  const handleCopy = () => {
    if (!fetchedToken) return;
    navigator.clipboard.writeText(fetchedToken);
    setToken(fetchedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: token }),
      });

      if (!res.ok) {
        setError("Invalid token");
        setLoading(false);
        return;
      }

      const data = await res.json();
      localStorage.setItem("rf_token", data.token);
      localStorage.setItem("rf_role", data.role);
      router.push("/");
    } catch {
      setError("Cannot connect to backend");
      setLoading(false);
    }
  };

  return (
    <ThemeProvider>
      <div className="relative flex min-h-screen items-center justify-center bg-background overflow-hidden">
        {/* Background gradient blobs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-accent/10 blur-[120px]" />
          <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-info/8 blur-[120px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-sm"
        >
          <div className="glass-card rounded-xl p-8 space-y-8">
            {/* Logo */}
            <div className="text-center space-y-3">
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.15, type: "spring", stiffness: 200 }}
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl gradient-accent glow-accent"
              >
                <Flame className="h-8 w-8 text-white" />
              </motion.div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Rebel Forge</h1>
                <p className="text-[13px] text-muted-foreground mt-1">
                  Local-first AI agent system
                </p>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2 block">
                  Access Token
                </label>
                <input
                  type="password"
                  placeholder="Paste your owner or viewer token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-raised/50 px-4 py-3 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all"
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-sm text-danger"
                >
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </motion.div>
              )}

              <motion.button
                type="submit"
                disabled={loading || !token.trim()}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex w-full items-center justify-center gap-2 rounded-xl gradient-accent py-3 text-sm font-semibold text-white hover:opacity-90 transition-all disabled:opacity-40 glow-accent"
              >
                {loading ? "Verifying..." : "Sign In"}
                <ArrowRight className="h-4 w-4" />
              </motion.button>
            </form>

            <div className="text-center space-y-2">
              {!fetchedToken ? (
                <p className="text-[12px] text-muted-foreground/60">
                  Don&apos;t have an account?{" "}
                  <button
                    onClick={handleGetToken}
                    disabled={fetchingToken}
                    className="text-accent hover:underline font-medium"
                  >
                    {fetchingToken ? "Fetching..." : "Get your token here!"}
                  </button>
                </p>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-2"
                >
                  <p className="text-[11px] text-success">Your token:</p>
                  <div className="flex items-center gap-2 rounded-md bg-surface-raised/50 border border-border/30 px-3 py-2">
                    <code className="flex-1 text-[11px] font-mono text-foreground truncate">
                      {fetchedToken}
                    </code>
                    <button
                      onClick={handleCopy}
                      className="shrink-0 flex items-center gap-1 text-[11px] text-accent hover:text-foreground transition-colors"
                    >
                      {copied ? (
                        <><Check className="h-3.5 w-3.5 text-success" /> Copied</>
                      ) : (
                        <><Copy className="h-3.5 w-3.5" /> Copy</>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </ThemeProvider>
  );
}
