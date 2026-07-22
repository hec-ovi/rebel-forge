import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { server } from "./server";

vi.mock("motion/react", async () => {
  const React = await import("react");
  const cache = new Map<string, React.ComponentType<Record<string, unknown>>>();
  const motionOnlyProps = new Set([
    "animate", "custom", "exit", "initial", "layout", "layoutId", "transition",
    "variants", "whileDrag", "whileFocus", "whileHover", "whileInView", "whileTap",
  ]);
  const motion = new Proxy({}, {
    get: (_target, tag: string) => {
      if (!cache.has(tag)) {
        const Component = React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
          const domProps = { ...props };
          for (const prop of motionOnlyProps) delete domProps[prop];
          const children = domProps.children as React.ReactNode;
          delete domProps.children;
          return React.createElement(tag, { ...domProps, ref }, children);
        });
        Component.displayName = `MotionMock(${tag})`;
        cache.set(tag, Component);
      }
      return cache.get(tag);
    },
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.className = "";
  vi.useRealTimers();
});

afterAll(() => server.close());

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverMock {
  root = null;
  rootMargin = "0px";
  thresholds = [0];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});
