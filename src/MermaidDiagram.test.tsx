import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renderer = vi.hoisted(() => {
  const sources: string[] = [];
  const releases: Array<() => void> = [];
  let active = 0;
  let maximumActive = 0;
  return {
    sources,
    releases,
    initialize: vi.fn(),
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
    initialize: renderer.initialize,
    render: renderer.render,
  },
}));

import MermaidDiagram from "./MermaidDiagram";

describe("Mermaid rendering coordination", () => {
  beforeEach(() => {
    renderer.sources.splice(0);
    renderer.releases.splice(0);
    renderer.initialize.mockClear();
    renderer.render.mockClear();
  });

  it("serializes diagrams and skips source updates made obsolete in the queue", async () => {
    const first = render(<MermaidDiagram source="first" />);
    const second = render(<MermaidDiagram source="second" />);
    second.rerender(<MermaidDiagram source="latest" />);

    await waitFor(() => expect(renderer.sources).toEqual(["first"]));
    expect(renderer.maximumActive).toBe(1);
    expect(renderer.initialize).toHaveBeenCalledWith({
      securityLevel: "strict",
      startOnLoad: false,
      suppressErrorRendering: true,
      theme: "default",
    });

    renderer.releases.shift()?.();

    await waitFor(() => expect(renderer.sources).toEqual(["first", "latest"]));
    expect(renderer.maximumActive).toBe(1);
    renderer.releases.shift()?.();

    await waitFor(() => {
      expect(first.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
      expect(second.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
    });
  });

  it("falls back to the source when the renderer rejects", async () => {
    renderer.render.mockRejectedValueOnce(new Error("invalid diagram"));

    render(<MermaidDiagram source="not valid mermaid" />);

    expect(
      await screen.findByLabelText("Mermaid diagram could not be rendered"),
    ).toHaveTextContent("not valid mermaid");
  });
});
