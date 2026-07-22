export interface Draft {
  id: string;
  workspace_id: string;
  platform: string;
  status: "draft" | "reviewed" | "approved" | "scheduled" | "published" | "failed";
  concept: string;
  caption: string;
  hook: string;
  cta: string;
  hashtags: string[];
  alt_text: string;
  media_prompt: string | null;
  script?: string | null;
  image_url?: string | null;
  published_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  brand_profile?: BrandProfile;
}

export interface BrandProfile {
  id: string;
  voice_summary?: string;
  audience_summary?: string;
  goals: Record<string, unknown>;
  style_notes: Record<string, unknown>;
  reference_examples: unknown[];
}
