import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(() => Promise.resolve()),
}));

import { MarkdownPreview } from "./MarkdownPreview";

const notes = [
  {
    id: "alpha",
    path: "/library/Alpha.md",
    title: "Alpha",
    tags: [],
    updated: 0,
    excerpt: "",
    folder: "",
  },
];

function renderPreview(markdown: string) {
  return render(
    <MarkdownPreview
      markdown={markdown}
      notePath="/library/Plan.md"
      notes={notes}
      onOpen={() => undefined}
      onEditTable={() => undefined}
      onToggleTask={() => undefined}
    />,
  ).container;
}

describe("Markdown preview", () => {
  it("links wiki notes in prose but leaves code literal", () => {
    const preview = renderPreview(
      "See [[Alpha]] and [[Alpha|the first]] or `[[Alpha]]`.\n\n```bash\nif [[ -f a ]]; then echo ok; fi\n```\n",
    );
    const links = [...preview.querySelectorAll("a")];
    expect(links.map((link) => link.textContent)).toEqual([
      "Alpha",
      "the first",
    ]);
    expect(preview.querySelector("p code")?.textContent).toBe("[[Alpha]]");
    expect(preview.querySelector("pre")?.textContent).toContain("[[ -f a ]]");
  });

  it("keeps rendering links with malformed percent escapes", () => {
    const preview = renderPreview("[Budget](100%.md) and ![chart](50%.png)");
    expect(preview.querySelector("a")?.textContent).toBe("Budget");
    expect(preview.querySelector("img")).not.toBeNull();
  });

  it("marks headings with their source line for the outline", () => {
    const preview = renderPreview("# Plan\n\nIntro\n\nNext\n----\n");
    expect(
      [...preview.querySelectorAll("[data-source-line]")].map((heading) =>
        heading.getAttribute("data-source-line"),
      ),
    ).toEqual(["1", "5"]);
  });
});
