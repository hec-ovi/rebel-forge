"use client";

import { Menu } from "lucide-react";
import { AgentStatus } from "@/components/widgets/agent-status";
import { ThemeToggle } from "./theme-toggle";

interface AppHeaderProps {
  onToggleSidebar?: () => void;
}

export function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  return (
    <header className="relative flex items-center">
      {/* Bottom gradient line — full width, on top of everything */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-foreground/[0.08] to-transparent z-30 pointer-events-none" />
      {/* Mobile menu */}
      {onToggleSidebar && (
        <button
          onClick={onToggleSidebar}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-surface-raised lg:hidden absolute left-3 top-3 z-20"
        >
          <Menu className="h-[18px] w-[18px]" />
        </button>
      )}

      {/* Agent Status Bar — takes center stage */}
      <div className="flex-1 flex items-center justify-center">
        <AgentStatus />
      </div>

      {/* Theme toggle — far right */}
      <div className="absolute right-3 top-3 z-20">
        <ThemeToggle />
      </div>
    </header>
  );
}
