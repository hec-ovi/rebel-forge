import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerGuard } from "./owner-guard";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

describe("OwnerGuard", () => {
  beforeEach(() => navigation.replace.mockReset());

  it("redirects viewers before owner controls render", async () => {
    localStorage.setItem("rf_role", "viewer");
    render(<OwnerGuard><p>Provider secrets</p></OwnerGuard>);

    expect(screen.queryByText("Provider secrets")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Redirecting to dashboard");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("renders owner controls for owners", () => {
    localStorage.setItem("rf_role", "owner");
    render(<OwnerGuard><p>Provider secrets</p></OwnerGuard>);

    expect(screen.getByText("Provider secrets")).toBeVisible();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
