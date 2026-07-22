import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { ApiError, apiFetch } from "./api";

describe("apiFetch", () => {
  it("adds bearer authentication without forcing a content type on GET requests", async () => {
    localStorage.setItem("rf_token", "viewer-token");
    let authorization: string | null = null;
    let contentType: string | null = null;
    server.use(
      http.get("http://127.0.0.1:8080/v1/example", ({ request }) => {
        authorization = request.headers.get("authorization");
        contentType = request.headers.get("content-type");
        return HttpResponse.json({ ok: true });
      }),
    );

    await expect(apiFetch<{ ok: boolean }>("/v1/example")).resolves.toEqual({ ok: true });
    expect(authorization).toBe("Bearer viewer-token");
    expect(contentType).toBeNull();
  });

  it("serializes JSON requests with caller headers intact", async () => {
    let headers: Headers | undefined;
    let body: unknown;
    server.use(
      http.post("http://127.0.0.1:8080/v1/example", async ({ request }) => {
        headers = request.headers;
        body = await request.json();
        return HttpResponse.json({ saved: true });
      }),
    );

    await apiFetch("/v1/example", {
      method: "POST",
      headers: { "X-Request-ID": "request-1" },
      body: JSON.stringify({ name: "Rebel" }),
    });

    expect(headers?.get("content-type")).toBe("application/json");
    expect(headers?.get("x-request-id")).toBe("request-1");
    expect(body).toEqual({ name: "Rebel" });
  });

  it("preserves a viewer session and exposes backend detail on forbidden actions", async () => {
    localStorage.setItem("rf_token", "viewer-token");
    localStorage.setItem("rf_role", "viewer");
    server.use(
      http.post("http://127.0.0.1:8080/v1/owner-only", () =>
        HttpResponse.json({ detail: "Owner token required" }, { status: 403 }),
      ),
    );

    const error = await apiFetch("/v1/owner-only", { method: "POST" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "Owner token required" });
    expect(localStorage.getItem("rf_token")).toBe("viewer-token");
    expect(localStorage.getItem("rf_role")).toBe("viewer");
  });

  it("supports successful responses with no body", async () => {
    server.use(
      http.delete("http://127.0.0.1:8080/v1/example", () => new HttpResponse(null, { status: 204 })),
    );
    await expect(apiFetch<void>("/v1/example", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("rejects malformed successful JSON with a typed error", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/example", () => new HttpResponse("not json", { status: 200 })),
    );
    const error = await apiFetch("/v1/example").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 200, message: "API returned invalid JSON" });
  });
});
