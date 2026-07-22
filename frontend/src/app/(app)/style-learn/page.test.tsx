import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/server";
import StyleLearnPage from "./page";

const post = {
  platform: "x",
  platform_id: "post-1",
  text: "A concrete release note from production.",
  created_at: "2026-07-18T10:00:00Z",
  permalink: "https://x.example/post-1",
  media_type: "TEXT_POST",
  metrics: { impressions: 120, likes: 8, replies: 2 },
};

describe("StyleLearnPage", () => {
  beforeEach(() => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/training/status", () => HttpResponse.json({ style_context_platforms: [] })),
    );
  });

  it("fetches posts and imports them transparently as prompt examples", async () => {
    let requestBody: unknown;
    server.use(
      http.get("http://127.0.0.1:8080/v1/fetch-posts/x", () => HttpResponse.json({ posts: [post] })),
      http.post("http://127.0.0.1:8080/v1/training/style-learn", async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ status: "saved", imported: true, posts_imported: 1 });
      }),
    );
    const user = userEvent.setup();
    render(<StyleLearnPage />);

    expect(await screen.findByRole("heading", { name: "Style Context" })).toBeVisible();
    expect(screen.getByText(/representative posts as platform-specific examples for future prompt context/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Fetch My Posts" }));
    expect(await screen.findByText(post.text)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Import Style Examples" }));

    await waitFor(() => expect(requestBody).toEqual({ platform: "x", posts: [post] }));
    expect(await screen.findByText("1 style example imported")).toBeVisible();
  });

  it("announces a post-fetch failure", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/fetch-posts/x", () =>
        HttpResponse.json({ detail: "X credentials are missing" }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    render(<StyleLearnPage />);

    await user.click(await screen.findByRole("button", { name: "Fetch My Posts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("X credentials are missing");
  });
});
