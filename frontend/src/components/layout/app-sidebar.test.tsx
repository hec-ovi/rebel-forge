import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/lib/store";
import { AppSidebar } from "./app-sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("AppSidebar role navigation", () => {
  beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

  it("limits viewers to read-only management destinations", () => {
    localStorage.setItem("rf_role", "viewer");
    render(<AppSidebar />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Content" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Calendar" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Analytics" })).toBeVisible();
    expect(screen.queryByText("Agentic")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Rebel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Training" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });
});
