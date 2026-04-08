export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8080";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("rf_token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...opts.headers,
    },
  });

  if (res.status === 401) {
    // Token invalid or missing — redirect to login
    if (typeof window !== "undefined") {
      localStorage.removeItem("rf_token");
      localStorage.removeItem("rf_role");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }

  return res.json();
}

export async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
