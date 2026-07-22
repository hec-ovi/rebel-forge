import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth-guard";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

describe("AuthGuard", () => {
  beforeEach(() => navigation.replace.mockReset());

  it("redirects before protected content renders when the token is absent", async () => {
    render(<AuthGuard><p>Protected settings</p></AuthGuard>);

    expect(screen.queryByText("Protected settings")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking authentication");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  });

  it("renders protected content when a valid token and role exist", () => {
    localStorage.setItem("rf_token", "viewer-token");
    localStorage.setItem("rf_role", "viewer");
    render(<AuthGuard><p>Protected settings</p></AuthGuard>);

    expect(screen.getByText("Protected settings")).toBeVisible();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("clears and redirects an incomplete local session", async () => {
    localStorage.setItem("rf_token", "token-without-role");
    render(<AuthGuard><p>Protected settings</p></AuthGuard>);

    expect(screen.queryByText("Protected settings")).not.toBeInTheDocument();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
    expect(localStorage.getItem("rf_token")).toBeNull();
  });
});
