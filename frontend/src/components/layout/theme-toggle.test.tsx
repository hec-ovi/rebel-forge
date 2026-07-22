import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  it("persists and applies the selected theme", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(localStorage.getItem("rf_theme")).toBe("light");
    expect(document.documentElement).toHaveClass("light");
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
  });
});
