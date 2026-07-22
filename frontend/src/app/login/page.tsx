"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flame, ArrowRight, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { API_BASE } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: token.trim() }),
      });

      if (!res.ok) {
        setError("Invalid token");
        setLoading(false);
        return;
      }

      const data: unknown = await res.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("token" in data) ||
        typeof data.token !== "string" ||
        !("role" in data) ||
        (data.role !== "owner" && data.role !== "viewer")
      ) {
        setError("Backend returned an invalid login response");
        return;
      }
      localStorage.setItem("rf_token", data.token);
      localStorage.setItem("rf_role", data.role);
      router.push("/");
    } catch {
      setError("Cannot connect to backend");
    } finally {
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
                <label htmlFor="access-token" className="text-[11px] font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2 block">
                  Access Token
                </label>
                <input
                  id="access-token"
                  type="password"
                  placeholder="Paste your owner or viewer token"
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setError("");
                  }}
                  autoComplete="current-password"
                  aria-describedby="token-help"
                  aria-invalid={!!error}
                  className="w-full rounded-xl border border-border bg-surface-raised/50 px-4 py-3 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all"
                />
                <p id="token-help" className="mt-2 text-[11px] leading-relaxed text-muted-foreground/60">
                  Use an owner or viewer token provisioned by your local Rebel Forge administrator.
                </p>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-sm text-danger"
                  role="alert"
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

          </div>
        </motion.div>
      </div>
    </ThemeProvider>
  );
}
