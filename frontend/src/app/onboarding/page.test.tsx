import { http, HttpResponse } from "msw";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/server";
import OnboardingPage from "./page";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/components/chat", () => ({
  Chat: ({ initialMessage }: { initialMessage: string }) => <p>{initialMessage}</p>,
}));

describe("OnboardingPage", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    navigation.replace.mockReset();
    localStorage.setItem("rf_token", "owner-token");
    localStorage.setItem("rf_role", "owner");
  });

  it("reports the active LLM as offline from authenticated readiness data", async () => {
    let authorization: string | null = null;
    server.use(
      http.get("http://127.0.0.1:8080/v1/readiness", ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({
          systems: {
            database: { ready: true, group: "local" },
            llm: { ready: false, group: "active" },
          },
        });
      }),
    );

    render(<OnboardingPage />);

    expect(await screen.findByText("Agent Offline")).toBeVisible();
    expect(authorization).toBe("Bearer owner-token");
    expect(screen.getByText(/Instagram, LinkedIn, Facebook, Threads, or X/)).toBeVisible();
    expect(screen.queryByText(/TikTok|YouTube/)).not.toBeInTheDocument();
  });
});
