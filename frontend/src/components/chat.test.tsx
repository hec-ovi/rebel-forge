import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/server";
import { Chat } from "./chat";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

function eventStream(...events: object[]) {
  const encoder = new TextEncoder();
  const payload = events.map((event) => `data: ${JSON.stringify(event)}`).join("\n");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
}

function chunkedEventStream(payload: string, splitAt: number) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload.slice(0, splitAt)));
      controller.enqueue(encoder.encode(payload.slice(splitAt)));
      controller.close();
    },
  });
  return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("Chat", () => {
  beforeEach(() => navigation.replace.mockReset());

  it("submits a trimmed conversation and renders a streamed response without a trailing newline", async () => {
    localStorage.setItem("rf_token", "owner-token");
    let requestBody: unknown;
    let authorization = "";
    server.use(
      http.get("http://127.0.0.1:8080/v1/conversations", () => HttpResponse.json([])),
      http.post("http://127.0.0.1:8080/v1/chat", async ({ request }) => {
        requestBody = await request.json();
        authorization = request.headers.get("authorization") || "";
        return eventStream({ content: "Hello from " }, { content: "Rebel" });
      }),
    );
    const user = userEvent.setup();
    render(<Chat mode="general" initialMessage="What are we working on?" />);

    expect(await screen.findByText("What are we working on?")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Chat message" }), "  Draft a launch post  ");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Hello from Rebel")).toBeVisible();
    expect(screen.getByText("Draft a launch post")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Chat message" })).toHaveValue("");
    expect(authorization).toBe("Bearer owner-token");
    expect(requestBody).toMatchObject({
      mode: "general",
      messages: [
        { role: "assistant", content: "What are we working on?" },
        { role: "user", content: "Draft a launch post" },
      ],
    });
  });

  it("preserves the user's message when the chat request fails", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/conversations", () => HttpResponse.json([])),
      http.post("http://127.0.0.1:8080/v1/chat", () => HttpResponse.error()),
    );
    const user = userEvent.setup();
    render(<Chat mode="general" />);

    await user.type(screen.getByRole("textbox", { name: "Chat message" }), "Keep this question");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Couldn't connect. Is the LLM running?")).toBeVisible();
    expect(screen.getByText("Keep this question")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("reconstructs completed tool results from conversation history", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/conversations", () => HttpResponse.json([
        {
          role: "assistant",
          content: "Search complete",
          tool_name: "web_search",
          tool_result: {
            type: "web_search",
            status: "completed",
            query: "staff engineering",
            results: [{ title: "Staff engineering guide", url: "https://example.com/guide", description: "A practical guide" }],
          },
        },
      ])),
    );
    render(<Chat mode="general" />);

    expect(await screen.findByText("Searched")).toBeVisible();
    expect(screen.getByText(/found 1 results for "staff engineering"/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Staff engineering guide" })).toHaveAttribute("href", "https://example.com/guide");
  });

  it("renders the imported-style-context transparency field from tool history", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/conversations", () => HttpResponse.json([
        {
          role: "assistant",
          content: "Loaded saved feedback",
          tool_name: "recall_training",
          tool_result: {
            type: "recall_training",
            status: "completed",
            platform: "linkedin",
            corrections_count: 0,
            has_style_guide: false,
            has_imported_style_context: true,
          },
        },
      ])),
    );
    render(<Chat mode="general" />);

    expect(await screen.findByText("Feedback Context Loaded")).toBeVisible();
    expect(screen.getByText("imported style examples loaded")).toBeVisible();
    expect(screen.queryByText("no saved feedback context yet")).not.toBeInTheDocument();
  });

  it("delivers a completed onboarding tool profile to the page", async () => {
    const onSummary = vi.fn();
    server.use(
      http.get("http://127.0.0.1:8080/v1/conversations", () => HttpResponse.json([])),
      http.post("http://127.0.0.1:8080/v1/chat", () => eventStream({
        tool_result: {
          type: "save_onboarding",
          status: "completed",
          summary: "Profile saved",
          profile: { voice: "direct", platforms: ["linkedin"] },
        },
      })),
    );
    const user = userEvent.setup();
    render(<Chat mode="onboarding" onSummary={onSummary} />);

    await user.type(screen.getByRole("textbox", { name: "Chat message" }), "Finish setup");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSummary).toHaveBeenCalledWith({ summary: true, voice: "direct", platforms: ["linkedin"] }));
    expect(screen.getByText("Profile Saved")).toBeVisible();
    expect(screen.getByRole("button", { name: /accept & go to rebel/i })).toBeVisible();
  });

  it("keeps the final explanation that follows a tool result across stream chunks", async () => {
    const toolEvent = JSON.stringify({
      tool_result: {
        type: "web_search",
        status: "completed",
        summary: "Research complete",
        query: "staff engineering",
        results: [],
      },
    });
    const contentEvent = JSON.stringify({ content: "Here is the final explanation." });
    const payload = `data: ${toolEvent}\n\ndata: ${contentEvent}\n\ndata: [DONE]\n\n`;
    server.use(
      http.get("http://127.0.0.1:8080/v1/conversations", () => HttpResponse.json([])),
      http.post("http://127.0.0.1:8080/v1/chat", () =>
        chunkedEventStream(payload, payload.indexOf("final explanation") + 5),
      ),
    );
    const user = userEvent.setup();
    render(<Chat mode="general" />);

    await user.type(screen.getByRole("textbox", { name: "Chat message" }), "Research this");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Searched")).toBeVisible();
    expect(await screen.findByText("Here is the final explanation.")).toBeVisible();
  });

  it("clears a rejected session and redirects to login without an LLM error", async () => {
    localStorage.setItem("rf_token", "expired-token");
    localStorage.setItem("rf_role", "owner");
    server.use(
      http.get("http://127.0.0.1:8080/v1/conversations", () => HttpResponse.json([])),
      http.post("http://127.0.0.1:8080/v1/chat", () =>
        HttpResponse.json({ detail: "Unauthorized" }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    render(<Chat mode="general" />);

    await user.type(screen.getByRole("textbox", { name: "Chat message" }), "Continue");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
    expect(localStorage.getItem("rf_token")).toBeNull();
    expect(localStorage.getItem("rf_role")).toBeNull();
    expect(screen.queryByText("Couldn't connect. Is the LLM running?")).not.toBeInTheDocument();
  });

  it("reports queued heartbeat drafts truthfully when the worker completes", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/conversations", () => HttpResponse.json([])),
      http.post("http://127.0.0.1:8080/v1/chat", () => eventStream({
        tool_result: {
          type: "heartbeat",
          status: "queued",
          message: "Heartbeat queued for the worker.",
        },
      })),
      http.get("http://127.0.0.1:8080/v1/heartbeat/status", () => HttpResponse.json({
        last_run: new Date(Date.now() + 1_000).toISOString(),
        last_result: { drafts_queued: 3, scout: { trends: ["AI agents"] } },
      })),
    );
    const user = userEvent.setup();
    render(<Chat mode="general" />);

    await user.type(screen.getByRole("textbox", { name: "Chat message" }), "Run heartbeat");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText(/Heartbeat done! 3 drafts queued\. Trends: AI agents/)).toBeVisible();
  });
});
