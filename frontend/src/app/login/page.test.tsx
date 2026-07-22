import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/server";
import LoginPage from "./page";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

describe("LoginPage", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    navigation.replace.mockReset();
  });

  it("keeps sign in disabled until a non-blank token is entered", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const submit = screen.getByRole("button", { name: /sign in/i });
    const token = screen.getByLabelText(/access token/i);
    expect(submit).toBeDisabled();

    await user.type(token, "   ");
    expect(submit).toBeDisabled();

    await user.type(token, "owner-token");
    expect(submit).toBeEnabled();
    expect(screen.getByText(/provisioned by your local rebel forge administrator/i)).toBeVisible();
    expect(screen.queryByText(/get your token/i)).not.toBeInTheDocument();
  });

  it("trims the token, stores the authenticated session, and navigates home", async () => {
    let submittedBody: unknown;
    server.use(
      http.post("http://127.0.0.1:8080/v1/auth/login", async ({ request }) => {
        submittedBody = await request.json();
        return HttpResponse.json({ token: "session-token", role: "owner" });
      }),
    );
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/access token/i), "  owner-token  ");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/"));
    expect(submittedBody).toEqual({ password: "owner-token" });
    expect(localStorage.getItem("rf_token")).toBe("session-token");
    expect(localStorage.getItem("rf_role")).toBe("owner");
  });

  it("reports invalid credentials without storing a session", async () => {
    server.use(
      http.post("http://127.0.0.1:8080/v1/auth/login", () =>
        HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/access token/i), "wrong-token");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid token");
    expect(localStorage.getItem("rf_token")).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });

  it("reports a network failure and lets the user retry", async () => {
    server.use(
      http.post("http://127.0.0.1:8080/v1/auth/login", () => HttpResponse.error()),
    );
    const user = userEvent.setup();
    render(<LoginPage />);

    const token = screen.getByLabelText(/access token/i);
    await user.type(token, "owner-token");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot connect to backend");
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();

    await user.type(token, "2");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
