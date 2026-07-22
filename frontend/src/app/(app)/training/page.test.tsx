import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "@/test/server";
import TrainingPage from "./page";

function installTrainingHandlers() {
  server.use(
    http.get("http://127.0.0.1:8080/v1/training/status", () => HttpResponse.json({ corrections_count: 0, total_drafts: 0, has_recommendations: false, training_level: "none" })),
    http.get("http://127.0.0.1:8080/v1/products", () => HttpResponse.json({ products: [] })),
    http.get("http://127.0.0.1:8080/v1/training/corrections", () => HttpResponse.json({ corrections: [] })),
    http.get("http://127.0.0.1:8080/v1/training/platform-styles", () => HttpResponse.json({})),
  );
}

describe("TrainingPage", () => {
  beforeEach(installTrainingHandlers);

  it("generates, edits, rates, and submits a training sample", async () => {
    let sampleRequest: unknown;
    let feedbackRequest: unknown;
    server.use(
      http.post("http://127.0.0.1:8080/v1/training/sample", async ({ request }) => {
        sampleRequest = await request.json();
        return HttpResponse.json({ sample: "An overly generic sample" });
      }),
      http.post("http://127.0.0.1:8080/v1/training/feedback", async ({ request }) => {
        feedbackRequest = await request.json();
        return HttpResponse.json({ status: "saved", had_edits: true });
      }),
    );
    const user = userEvent.setup();
    render(<TrainingPage />);

    expect(await screen.findByRole("heading", { name: "Training Center" })).toBeVisible();
    expect(screen.getByText(/Save corrections and style guidance as context for future generations/)).toBeVisible();
    expect(screen.getByText("No feedback")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Training topic" }), "release engineering");
    await user.click(screen.getByRole("button", { name: "Generate Sample" }));

    const dialog = await screen.findByRole("dialog", { name: "Rate & Correct" });
    expect(dialog).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit Correction" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "4 stars" }));
    await user.type(screen.getByLabelText("Notes for the agent"), "Use concrete details");
    await user.clear(screen.getByLabelText("Your version"));
    await user.type(screen.getByLabelText("Your version"), "A specific release engineering lesson");
    await user.click(screen.getByRole("button", { name: "Submit Correction" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sampleRequest).toEqual({ platform: "x", topic: "release engineering" });
    expect(feedbackRequest).toEqual({
      original: "An overly generic sample",
      corrected: "A specific release engineering lesson",
      feedback: "Use concrete details",
      platform: "x",
      rating: 4,
      topic: "release engineering",
    });
  });

  it("validates and creates a product with normalized list fields", async () => {
    let productRequest: unknown;
    server.use(
      http.post("http://127.0.0.1:8080/v1/products", async ({ request }) => {
        productRequest = await request.json();
        return HttpResponse.json({ id: "product-1" }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<TrainingPage />);
    await screen.findByRole("heading", { name: "Training Center" });

    await user.click(screen.getByRole("button", { name: "Add" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Product name"), "Forge CLI");
    await user.type(screen.getByLabelText("Product description"), "Local automation");
    await user.type(screen.getByLabelText("Product target audience"), "Engineering teams");
    await user.type(screen.getByLabelText("Product key features"), " local, fast , auditable ");
    await user.type(screen.getByLabelText("Product tags"), " cli, automation ");
    await user.click(save);

    await waitFor(() => expect(screen.queryByLabelText("Product name")).not.toBeInTheDocument());
    expect(productRequest).toEqual({
      name: "Forge CLI",
      description: "Local automation",
      target_audience: "Engineering teams",
      key_features: ["local", "fast", "auditable"],
      links: {},
      tags: ["cli", "automation"],
    });
  });

  it("keeps the product form open and announces a creation failure", async () => {
    server.use(
      http.post("http://127.0.0.1:8080/v1/products", () =>
        HttpResponse.json({ detail: "Product storage is unavailable" }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    render(<TrainingPage />);
    await screen.findByRole("heading", { name: "Training Center" });

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.type(screen.getByLabelText("Product name"), "Forge CLI");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Product storage is unavailable");
    expect(screen.getByLabelText("Product name")).toHaveValue("Forge CLI");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("deletes a product through the API and updates the rendered list", async () => {
    let deleted = false;
    server.use(
      http.get("http://127.0.0.1:8080/v1/products", () => HttpResponse.json({ products: [{ id: "product-1", name: "Forge CLI", description: "Local automation", target_audience: "Teams", key_features: [], links: {}, tags: [] }] })),
      http.delete("http://127.0.0.1:8080/v1/products/product-1", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    render(<TrainingPage />);

    await user.click(await screen.findByRole("button", { name: "Delete Forge CLI" }));
    await waitFor(() => expect(deleted).toBe(true));
    expect(screen.queryByText("Forge CLI")).not.toBeInTheDocument();
  });

  it("keeps a product visible and announces a deletion failure", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/products", () => HttpResponse.json({ products: [{ id: "product-1", name: "Forge CLI", description: "Local automation", target_audience: "Teams", key_features: [], links: {}, tags: [] }] })),
      http.delete("http://127.0.0.1:8080/v1/products/product-1", () =>
        HttpResponse.json({ detail: "Product is referenced by an active job" }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    render(<TrainingPage />);

    await user.click(await screen.findByRole("button", { name: "Delete Forge CLI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Product is referenced by an active job");
    expect(screen.getByText("Forge CLI")).toBeVisible();
  });

  it("renders the primary status failure and allows dismissal", async () => {
    server.use(
      http.get("http://127.0.0.1:8080/v1/training/status", () => HttpResponse.json({ detail: "Training unavailable" }, { status: 503 })),
    );
    const user = userEvent.setup();
    render(<TrainingPage />);

    expect(await screen.findByText("Training unavailable")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "dismiss" }));
    expect(screen.queryByText("Training unavailable")).not.toBeInTheDocument();
  });
});
