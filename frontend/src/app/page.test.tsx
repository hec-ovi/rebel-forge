import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "./page";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

describe("Home routing", () => {
  beforeEach(() => navigation.replace.mockReset());

  it("sends anonymous visitors to login", async () => {
    render(<Home />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  });

  it("sends authenticated first-time users to onboarding", async () => {
    localStorage.setItem("rf_token", "token");
    localStorage.setItem("rf_role", "owner");
    render(<Home />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/onboarding"));
  });

  it("sends viewers directly to their read-only dashboard", async () => {
    localStorage.setItem("rf_token", "viewer-token");
    localStorage.setItem("rf_role", "viewer");
    render(<Home />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("sends onboarded users to the agent", async () => {
    localStorage.setItem("rf_token", "token");
    localStorage.setItem("rf_role", "owner");
    localStorage.setItem("rf_onboarded", "true");
    render(<Home />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/rebel"));
  });
});
