export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("rf_token");
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("rf_token");
  localStorage.removeItem("rf_role");
}

export async function apiFetch<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const headers = new Headers(opts.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (opts.body && !(opts.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      clearAuthSession();
      window.location.href = "/login";
    }
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
        detail = body.detail;
      }
    } catch {
      // The HTTP status still provides a useful fallback for non-JSON errors.
    }
    throw new ApiError(res.status, detail || `API ${res.status}: ${res.statusText}`);
  }

  if (res.status === 204) return undefined as T;
  const body = await res.text();
  if (!body) return undefined as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ApiError(res.status, "API returned invalid JSON");
  }
}
