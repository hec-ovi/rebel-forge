import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/server";
import PlatformsPage from "./page";

const profile = {
  instagram: {
    platform: "instagram",
    live: { display_name: "Forge Studio", username: "forge", bio: "Original bio" },
    saved: {},
    editable_fields: ["bio"],
    editable_labels: { bio: "Bio" },
  },
};

describe("PlatformsPage", () => {
  beforeEach(() => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/workspace/platform-profiles", () => HttpResponse.json(profile)),
    );
  });

  it("saves an edited profile and confirms the observable result", async () => {
    let body: unknown;
    server.use(
      http.put("http://127.0.0.1:8080/v1/workspace/platform-profile/instagram", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ status: "saved" });
      }),
    );
    const user = userEvent.setup();
    render(<PlatformsPage />);

    const bio = await screen.findByRole("textbox", { name: "Bio" });
    await user.clear(bio);
    await user.type(bio, "Concrete builder updates");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(body).toEqual({ bio: "Concrete builder updates" }));
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("keeps edits visible and announces a profile save failure", async () => {
    server.use(
      http.put("http://127.0.0.1:8080/v1/workspace/platform-profile/instagram", () =>
        HttpResponse.json({ detail: "Instagram rejected the profile update" }, { status: 502 }),
      ),
    );
    const user = userEvent.setup();
    render(<PlatformsPage />);

    const bio = await screen.findByRole("textbox", { name: "Bio" });
    await user.clear(bio);
    await user.type(bio, "Keep this edit");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Instagram rejected the profile update");
    expect(bio).toHaveValue("Keep this edit");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("announces an AI suggestion failure", async () => {
    server.use(
      http.post("http://127.0.0.1:8080/v1/training/sample", () =>
        HttpResponse.json({ detail: "AI provider is offline" }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    render(<PlatformsPage />);

    await user.click(await screen.findByRole("button", { name: "Generate with AI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI provider is offline");
  });
});
