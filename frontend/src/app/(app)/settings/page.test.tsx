import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { useAppStore } from "@/lib/store";
import SettingsPage from "./page";

function installSettingsHandlers() {
  server.use(
    http.get("http://127.0.0.1:8080/v1/readiness", () => HttpResponse.json({
      systems: { database: { ready: true, label: "PostgreSQL", group: "core" }, codex: { ready: true, label: "Codex CLI", model: "codex", group: "active" } },
      platforms: {}, features: { chat: true, publishing: false }, setup_complete: true,
      summary: { systems_ready: 2, systems_total: 2, platforms_ready: 0, platforms_total: 0, features_available: 1, features_total: 2 },
    })),
    http.get("http://127.0.0.1:8080/v1/connections", () => HttpResponse.json([])),
    http.get("http://127.0.0.1:8080/v1/connections/:provider", () => HttpResponse.json({ credentials: {} })),
    http.get("http://127.0.0.1:8080/v1/heartbeat/status", () => HttpResponse.json({ last_run: null, interval_hours: 6 })),
    http.get("http://127.0.0.1:8080/v1/workspace", () => HttpResponse.json({ brand_profile: { style_notes: { heartbeat: { enabled: false, interval_hours: 6, auto_approve: false } } } })),
    http.get("http://127.0.0.1:8080/v1/providers", () => HttpResponse.json({
      active_provider: "codex", active_model: "codex", base_url: "",
      providers: [{ id: "codex", name: "Codex CLI", configured: true, active: true, default_model: "codex", fields: [] }],
    })),
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true);
    installSettingsHandlers();
  });

  it("describes Codex CLI authentication accurately and tests the provider", async () => {
    server.use(
      http.post("http://127.0.0.1:8080/v1/providers/test", () => HttpResponse.json({ status: "ok", models: ["codex 1.0"] })),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    await user.click(await screen.findByRole("button", { name: /codex cli/i }));
    expect(screen.getByText(/uses its existing local authentication and configuration/i)).toBeVisible();
    expect(screen.queryByText(/openai_api_key/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/ok.*codex 1\.0/i)).toBeVisible();
  });

  it("persists heartbeat changes with the current interval", async () => {
    let heartbeatBody: unknown;
    server.use(
      http.put("http://127.0.0.1:8080/v1/heartbeat/config", async ({ request }) => {
        heartbeatBody = await request.json();
        return HttpResponse.json({ status: "saved" });
      }),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    const heartbeat = await screen.findByRole("switch", { name: "Enable heartbeat" });
    await waitFor(() => expect(heartbeat).toHaveAttribute("aria-checked", "false"));
    await user.click(heartbeat);

    await waitFor(() => expect(heartbeatBody).toEqual({ enabled: true, interval_hours: 6, auto_approve: false }));
    expect(heartbeat).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("Active")).toHaveLength(2);
  });

  it("labels and persists heartbeat auto-approval without claiming publication", async () => {
    let heartbeatBody: unknown;
    server.use(
      http.put("http://127.0.0.1:8080/v1/heartbeat/config", async ({ request }) => {
        heartbeatBody = await request.json();
        return HttpResponse.json({ status: "saved" });
      }),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    const autoApprove = await screen.findByRole("switch", { name: "Auto-approve heartbeat drafts" });
    expect(screen.getByText("Approve new heartbeat drafts automatically. Publication still requires manual review.")).toBeVisible();
    await user.click(autoApprove);

    await waitFor(() => expect(heartbeatBody).toEqual({ enabled: false, interval_hours: 6, auto_approve: true }));
    expect(autoApprove).toHaveAttribute("aria-checked", "true");
  });

  it("rolls back an optimistic heartbeat change and announces persistence failure", async () => {
    server.use(
      http.put("http://127.0.0.1:8080/v1/heartbeat/config", () =>
        HttpResponse.json({ detail: "Heartbeat configuration could not be saved" }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    const heartbeat = await screen.findByRole("switch", { name: "Enable heartbeat" });
    await waitFor(() => expect(heartbeat).toHaveAttribute("aria-checked", "false"));
    await user.click(heartbeat);

    expect(await screen.findByRole("alert")).toHaveTextContent("Heartbeat configuration could not be saved");
    await waitFor(() => expect(heartbeat).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText("Off")).toBeVisible();
  });

  it("sends only edited connection fields and reports persistence failures", async () => {
    let submittedBody: unknown;
    server.use(
      http.get("http://127.0.0.1:8080/v1/connections", () => HttpResponse.json([
        {
          platform: "cloudflare_r2",
          connected: true,
          credentials: { endpoint_url: "https://old.example.com", access_key_id: "****1234", secret_access_key: "****cret" },
          fields: ["endpoint_url", "access_key_id", "secret_access_key"],
        },
      ])),
      http.put("http://127.0.0.1:8080/v1/connections/cloudflare_r2", async ({ request }) => {
        submittedBody = await request.json();
        return HttpResponse.json({ detail: "Credential persistence is unavailable" }, { status: 503 });
      }),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    await user.click(await screen.findByRole("button", { name: /cloudflare r2.*connected/i }));
    const endpointUrl = screen.getByLabelText("endpoint url");
    await user.clear(endpointUrl);
    await user.type(endpointUrl, "https://new.example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Credential persistence is unavailable");
    expect(submittedBody).toEqual({ credentials: { endpoint_url: "https://new.example.com" } });
  });

  it("reports when a saved connection requires an API and worker recreation", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/connections", () => HttpResponse.json([
        {
          platform: "firecrawl",
          connected: true,
          credentials: { api_key: "****1234", api_url: "https://old.example.com" },
          fields: ["api_key", "api_url"],
        },
      ])),
      http.put("http://127.0.0.1:8080/v1/connections/firecrawl", () => HttpResponse.json({
        platform: "firecrawl",
        connected: true,
        credentials: { api_key: "****1234", api_url: "https://new.example.com" },
        fields: ["api_key", "api_url"],
        recreate_required: true,
      })),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    await user.click(await screen.findByRole("button", { name: /firecrawl.*connected/i }));
    const apiUrl = screen.getByLabelText("api url");
    await user.clear(apiUrl);
    await user.type(apiUrl, "https://new.example.com");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/recreate the API and worker/i)).toHaveTextContent("docker compose up -d --force-recreate api worker");
  });

  it("persists a free-form OpenRouter model without a stale catalog", async () => {
    let activationBody: unknown;
    server.use(
      http.get("http://127.0.0.1:8080/v1/providers", () => HttpResponse.json({
        active_provider: "openai",
        active_model: "gpt-4.1",
        base_url: "https://api.openai.com/v1",
        providers: [
          { id: "openai", name: "OpenAI", configured: true, active: true, default_model: "gpt-4.1", fields: ["api_key", "model"] },
          { id: "openrouter", name: "OpenRouter", configured: false, active: false, default_model: "openai/gpt-4.1", fields: ["api_key", "model"] },
        ],
      })),
      http.put("http://127.0.0.1:8080/v1/providers/active", async ({ request }) => {
        activationBody = await request.json();
        return HttpResponse.json({ status: "activated" });
      }),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    await user.click(await screen.findByRole("button", { name: "OpenRouter" }));
    const model = screen.getByRole("textbox", { name: "model" });
    expect(model).toHaveAttribute("placeholder", "openai/gpt-4.1");
    expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
    await user.type(model, "vendor/current-model");
    await user.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() => expect(activationBody).toEqual({
      provider: "openrouter",
      api_key: "",
      model: "vendor/current-model",
      base_url: "",
    }));
  });

  it("uses a free-form fal.ai model field and warns that its test consumes usage", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/connections", () => HttpResponse.json([
        {
          platform: "fal_ai",
          connected: true,
          credentials: { api_key: "****1234", model: "fal-ai/custom-image-model" },
          fields: ["api_key", "model"],
        },
      ])),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);

    await user.click(await screen.findByRole("button", { name: /fal\.ai.*connected/i }));
    expect(screen.getByRole("textbox", { name: "model" })).toHaveValue("fal-ai/custom-image-model");
    expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
    expect(screen.getByText("This generates a real test image and may incur provider usage charges.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Run image test" })).toBeVisible();
  });

  it("requires explicit confirmation before exposing the reset action", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><SettingsPage /></ThemeProvider>);
    await screen.findByRole("heading", { name: "Settings" });

    await user.click(screen.getByRole("button", { name: "Reset Account" }));
    expect(screen.getByText("Delete ALL data. Are you sure?")).toBeVisible();
    expect(screen.getByRole("button", { name: "Yes, reset everything" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete ALL data. Are you sure?")).not.toBeInTheDocument();
  });
});
