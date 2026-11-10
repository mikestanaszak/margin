import { describe, expect, it } from "vitest";
import { externalUrl, noteForMarkdownLink, noteForWikiTitle } from "./links";

const notes = [
  {
    id: "a",
    path: "/lib/Work/Read me.md",
    title: "Read me",
    tags: [],
    updated: 0,
    excerpt: "",
    folder: "Work",
  },
  {
    id: "b",
    path: "/lib/Plan.md",
    title: "Plan",
    tags: [],
    updated: 0,
    excerpt: "",
    folder: "",
  },
];

describe("shared link rules", () => {
  it("resolves wiki titles and relative Markdown links", () => {
    expect(noteForWikiTitle(" plan ", notes)?.path).toBe("/lib/Plan.md");
    expect(
      noteForMarkdownLink("Work/Read%20me.md#top", "/lib/Plan.md", notes)
        ?.title,
    ).toBe("Read me");
    expect(
      noteForMarkdownLink("../Plan.md", "/lib/Work/Read me.md", notes)?.title,
    ).toBe("Plan");
    expect(
      noteForMarkdownLink("https://x.md", "/lib/Plan.md", notes),
    ).toBeUndefined();
  });

  it("recognizes web addresses", () => {
    expect(externalUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(externalUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(externalUrl("notes/plan")).toBeUndefined();
  });
});
