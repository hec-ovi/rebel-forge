import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import type { Draft } from "@/lib/types";
import AnalyticsPage from "./page";

const publishedDraft: Draft = {
  id: "published-1",
  workspace_id: "workspace-1",
  platform: "x",
  status: "published",
  concept: "A real published post",
  caption: "Post body",
  hook: "Hook",
  cta: "CTA",
  hashtags: [],
  alt_text: "",
  media_prompt: "",
};

describe("AnalyticsPage", () => {
  it("aggregates real engagement responses loaded at the HTTP boundary", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json([publishedDraft])),
      http.get("http://127.0.0.1:8080/v1/drafts/published-1/engagement", () =>
        HttpResponse.json({
          draft_id: "published-1",
          published: true,
          platform: "x",
          metrics: { views: 1000, likes: 50, comments: 20, shares: 10 },
        }),
      ),
    );
    render(<AnalyticsPage />);

    expect(await screen.findByText("A real published post")).toBeVisible();
    expect(screen.getAllByText("1,000")).toHaveLength(2);
    expect(screen.getAllByText("50")).toHaveLength(2);
    expect(screen.getAllByText("20")).toHaveLength(2);
    expect(screen.getAllByText("10")).toHaveLength(2);
    expect(screen.getByText("8.0%")).toBeVisible();
    expect(screen.queryByText(/sample data/i)).not.toBeInTheDocument();
  });

  it("shows an honest empty state when nothing has been published", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json([])),
    );
    render(<AnalyticsPage />);

    expect(await screen.findByText("No published content yet")).toBeVisible();
    expect(screen.getByText(/analytics appear after a draft is published/i)).toBeVisible();
  });

  it("retains available metrics while reporting a partial upstream failure", async () => {
    const secondDraft = { ...publishedDraft, id: "published-2", concept: "Second post" };
    server.use(
      http.get("http://127.0.0.1:8080/v1/drafts", () => HttpResponse.json([publishedDraft, secondDraft])),
      http.get("http://127.0.0.1:8080/v1/drafts/published-1/engagement", () =>
        HttpResponse.json({ draft_id: "published-1", published: true, platform: "x", metrics: { views: 20 } }),
      ),
      http.get("http://127.0.0.1:8080/v1/drafts/published-2/engagement", () =>
        HttpResponse.json({ detail: "Platform unavailable" }, { status: 503 }),
      ),
    );
    render(<AnalyticsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load metrics for 1 published post");
    expect(screen.getByText("A real published post")).toBeVisible();
    expect(screen.queryByText("Second post")).not.toBeInTheDocument();
  });
});
