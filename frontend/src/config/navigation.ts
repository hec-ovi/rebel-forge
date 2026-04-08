import {
  Flame,
  LayoutDashboard,
  FileText,
  CalendarDays,
  BarChart3,
  Activity,
  Settings,
  Sparkles,
  GraduationCap,
  Globe,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  badge?: "pending" | "approved" | "events";
  group: "main" | "manager" | "system";
}

export const navigation: NavItem[] = [
  // Agentic
  { id: "rebel", label: "Rebel", icon: Flame, href: "/rebel", group: "main" },
  { id: "onboarding", label: "Onboarding", icon: Sparkles, href: "/setup", group: "main" },
  { id: "training", label: "Training", icon: GraduationCap, href: "/training", group: "main" },
  { id: "style-learn", label: "Style Learn", icon: BookOpen, href: "/style-learn", group: "main" },
  { id: "platforms", label: "Platforms", icon: Globe, href: "/platforms", group: "main" },

  // Manager
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/dashboard", group: "manager" },
  { id: "content", label: "Content", icon: FileText, href: "/drafts", badge: "pending", group: "manager" },
  { id: "calendar", label: "Calendar", icon: CalendarDays, href: "/calendar", group: "manager" },

  // System
  { id: "analytics", label: "Analytics", icon: BarChart3, href: "/analytics", group: "system" },
  { id: "tasks", label: "Activity", icon: Activity, href: "/tasks", badge: "events", group: "system" },
  { id: "settings", label: "Settings", icon: Settings, href: "/settings", group: "system" },
];
