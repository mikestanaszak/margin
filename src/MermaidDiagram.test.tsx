import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => {
  const sources: string[] = [];
  const releases: Array<() => void> = [];
  let active = 0;
  let maximumActive = 0;
  return {
    sources,
    releases,
    get maximumActive() {
      return maximumActive;
    },
    render: vi.fn((_id: string, source: string) => {
      sources.push(source);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return new Promise<{ svg: string }>((resolve) => {
        releases.push(() => {
          active -= 1;
          resolve({ svg: `<svg><text>${source}</text></svg>` });
        });
      });
    }),
  };
});

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: renderer.render,
  },
}));

import MermaidDiagram from "./MermaidDiagram";

describe("Mermaid rendering coordination", () => {
  it("serializes diagrams and skips source updates made obsolete in the queue", async () => {
    const first = render(<MermaidDiagram source="first" />);
    const second = render(<MermaidDiagram source="second" />);
    second.rerender(<MermaidDiagram source="latest" />);

    await waitFor(() => expect(renderer.sources).toEqual(["first"]));
    expect(renderer.maximumActive).toBe(1);

    renderer.releases.shift()?.();

    await waitFor(() => expect(renderer.sources).toEqual(["first", "latest"]));
    expect(renderer.maximumActive).toBe(1);
    renderer.releases.shift()?.();

    await waitFor(() => {
      expect(first.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
      expect(second.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
    });
  });
});
