import { SiInstagram, SiTiktok, SiFacebook, SiThreads, SiYoutube } from "react-icons/si";
import { FaXTwitter, FaLinkedinIn } from "react-icons/fa6";

export interface PlatformInfo {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  bg: string;
  gradient: string;
  color: string;
}

export const platforms: Record<string, PlatformInfo> = {
  x: {
    id: "x",
    label: "X",
    icon: FaXTwitter,
    accent: "text-platform-x",
    bg: "bg-platform-x/10",
    gradient: "from-platform-x/20 to-transparent",
    color: "bg-platform-x",
  },
  twitter: {
    id: "twitter",
    label: "X",
    icon: FaXTwitter,
    accent: "text-platform-x",
    bg: "bg-platform-x/10",
    gradient: "from-platform-x/20 to-transparent",
    color: "bg-platform-x",
  },
  instagram: {
    id: "instagram",
    label: "Instagram",
    icon: SiInstagram,
    accent: "text-platform-instagram",
    bg: "bg-platform-instagram/10",
    gradient: "from-platform-instagram/20 to-transparent",
    color: "bg-platform-instagram",
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    icon: FaLinkedinIn,
    accent: "text-platform-linkedin",
    bg: "bg-platform-linkedin/10",
    gradient: "from-platform-linkedin/20 to-transparent",
    color: "bg-platform-linkedin",
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok",
    icon: SiTiktok,
    accent: "text-platform-tiktok",
    bg: "bg-platform-tiktok/10",
    gradient: "from-platform-tiktok/20 to-transparent",
    color: "bg-platform-tiktok",
  },
  facebook: {
    id: "facebook",
    label: "Facebook",
    icon: SiFacebook,
    accent: "text-platform-facebook",
    bg: "bg-platform-facebook/10",
    gradient: "from-platform-facebook/20 to-transparent",
    color: "bg-platform-facebook",
  },
  threads: {
    id: "threads",
    label: "Threads",
    icon: SiThreads,
    accent: "text-platform-threads",
    bg: "bg-platform-threads/10",
    gradient: "from-platform-threads/20 to-transparent",
    color: "bg-platform-threads",
  },
  youtube: {
    id: "youtube",
    label: "YouTube",
    icon: SiYoutube,
    accent: "text-platform-youtube",
    bg: "bg-platform-youtube/10",
    gradient: "from-platform-youtube/20 to-transparent",
    color: "bg-platform-youtube",
  },
};

const defaultPlatform: PlatformInfo = {
  id: "custom",
  label: "Custom",
  icon: ({ className }) => <span className={className}>?</span>,
  accent: "text-muted-foreground",
  bg: "bg-muted/50",
  gradient: "from-muted/20 to-transparent",
  color: "bg-muted-foreground",
};

export function getPlatform(id: string): PlatformInfo {
  return platforms[id] || defaultPlatform;
}

export const platformList = Object.values(platforms).filter(
  (p) => p.id !== "twitter"
);
