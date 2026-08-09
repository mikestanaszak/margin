import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MermaidDiagram from "./MermaidDiagram";

const source = "flowchart LR\n  Start --> Finish";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe.sequential("Mermaid renderer integration", () => {
  it("renders a valid diagram with strict link handling", async () => {
    render(
      <MermaidDiagram
        source={[
          "flowchart LR",
          "  Unsafe[Unsafe link]",
          '  click Unsafe "javascript:alert(document.domain)"',
        ].join("\n")}
      />,
    );

    const diagram = await screen.findByRole("img", { name: "Mermaid diagram" });
    expect(diagram.querySelector('[href^="javascript:"]')).toBeNull();
    expect(diagram.querySelector("script")).toBeNull();
    expect(
      Array.from(diagram.querySelectorAll("*")).some((element) =>
        Array.from(element.attributes).some((attribute) =>
          attribute.name.toLowerCase().startsWith("on"),
        ),
      ),
    ).toBe(false);
  });

  it("regenerates the diagram when the app appearance changes", async () => {
    document.documentElement.dataset.theme = "light";
    render(<MermaidDiagram source={source} />);

    const diagram = await screen.findByRole("img", { name: "Mermaid diagram" });
    const lightStyles = diagram.querySelector("style")?.textContent;
    expect(lightStyles).toBeTruthy();

    document.documentElement.dataset.theme = "dark";

    await waitFor(() =>
      expect(
        screen
          .getByRole("img", { name: "Mermaid diagram" })
          .querySelector("style")?.textContent,
      ).not.toBe(lightStyles),
    );
  });

  it("regenerates the diagram when system appearance changes", async () => {
    const originalMatchMedia = window.matchMedia;
    const listeners = new Set<() => void>();
    let prefersDark = false;
    const mediaQuery = {
      get matches() {
        return prefersDark;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: () => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => mediaQuery),
    });
    document.documentElement.dataset.theme = "system";
    try {
      render(<MermaidDiagram source={source} />);

      const diagram = await screen.findByRole("img", { name: "Mermaid diagram" });
      const lightStyles = diagram.querySelector("style")?.textContent;
      prefersDark = true;
      listeners.forEach((listener) => listener());

      await waitFor(() =>
        expect(
          screen
            .getByRole("img", { name: "Mermaid diagram" })
            .querySelector("style")?.textContent,
        ).not.toBe(lightStyles),
      );
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });
});
