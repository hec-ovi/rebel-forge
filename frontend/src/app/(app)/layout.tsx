"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { StoreProvider } from "@/components/store-provider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <ThemeProvider>
      <StoreProvider>
        <div className="flex h-screen overflow-hidden bg-background">
          {/* Subtle gradient background overlay */}
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top_right,oklch(0.72_0.2_40/4%)_0%,transparent_60%)]" />
          <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_bottom_left,oklch(0.72_0.15_255/3%)_0%,transparent_60%)]" />

          {/* Desktop sidebar */}
          <div className="hidden lg:block relative z-10">
            <AppSidebar />
          </div>

          {/* Mobile sidebar overlay */}
          <AnimatePresence>
            {sidebarOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
                  onClick={() => setSidebarOpen(false)}
                />
                <motion.div
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="fixed inset-y-0 left-0 z-50 lg:hidden"
                >
                  <AppSidebar />
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Main content */}
          <div className="flex flex-1 flex-col overflow-hidden relative z-10">
            <AppHeader onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
            <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
          </div>
        </div>
      </StoreProvider>
    </ThemeProvider>
  );
}
