"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Flame } from "lucide-react";
import { motion } from "motion/react";
import { navigation, type NavItem } from "@/config/navigation";
import { useAppStore } from "@/lib/store";

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className="relative ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground tabular-nums px-1"
    >
      {count > 99 ? "99+" : count}
    </motion.span>
  );
}

function SidebarLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const draftCounts = useAppStore((s) => s.draftCounts);
  const events = useAppStore((s) => s.events);

  let badgeCount = 0;
  if (item.badge === "pending") badgeCount = draftCounts.pending;
  else if (item.badge === "approved") badgeCount = draftCounts.approved;
  else if (item.badge === "events") {
    badgeCount = events.filter((e) => {
      const age = Date.now() - new Date(e.created_at).getTime();
      return age < 3600000;
    }).length;
  }

  return (
    <Link
      href={item.href}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200 ${
        isActive
          ? "text-accent-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {isActive && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-xl gradient-accent glow-accent"
          style={{ opacity: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
        />
      )}
      {!isActive && (
        <div className="absolute inset-0 rounded-xl bg-transparent group-hover:bg-surface-raised transition-colors duration-200" />
      )}
      <item.icon className="relative h-[18px] w-[18px] shrink-0" />
      <span className="relative tracking-wide">{item.label}</span>
      <NavBadge count={badgeCount} />
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  const mainItems = navigation.filter((n) => n.group === "main");
  const managerItems = navigation.filter((n) => n.group === "manager");
  const systemItems = navigation.filter((n) => n.group === "system");

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border/30 bg-surface/80 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg gradient-accent glow-accent">
          <Flame className="h-5 w-5 text-white" />
        </div>
        <div>
          <span className="text-sm font-bold tracking-tight">Rebel Forge</span>
          <p className="text-[10px] text-muted-foreground tracking-widest uppercase">Agent System</p>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 space-y-1 px-3 py-3">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
          Agentic
        </p>
        {mainItems.map((item) => (
          <SidebarLink key={item.id} item={item} isActive={isActive(item.href)} />
        ))}

        <div className="my-4 mx-3 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
          Manager
        </p>
        {managerItems.map((item) => (
          <SidebarLink key={item.id} item={item} isActive={isActive(item.href)} />
        ))}

        <div className="my-4 mx-3 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
          System
        </p>
        {systemItems.map((item) => (
          <SidebarLink key={item.id} item={item} isActive={isActive(item.href)} />
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/20 px-3 py-3">
        <button
          onClick={() => {
            localStorage.removeItem("rf_token");
            localStorage.removeItem("rf_role");
            sessionStorage.clear();
            window.location.href = "/login";
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] text-muted-foreground/60 transition-all hover:text-foreground hover:bg-surface-raised"
        >
          <LogOut className="h-4 w-4" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
