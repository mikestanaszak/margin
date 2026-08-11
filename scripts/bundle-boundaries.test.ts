import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const distDirectory = join(process.cwd(), "dist");

function readCaptureEntry() {
  const captureHtml = readFileSync(join(distDirectory, "capture.html"), "utf8");
  const entryMatch = captureHtml.match(/<script[^>]+src="\/assets\/([^"?]+)[^"]*"/);
  const stylesheetMatches = [
    ...captureHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/([^"?]+)[^"]*"/g),
  ];

  if (!entryMatch) {
    throw new Error("The capture build did not emit an entry script.");
  }

  return {
    captureHtml,
    entry: readFileSync(join(distDirectory, "assets", entryMatch[1]), "utf8"),
    styles: stylesheetMatches.map((match) =>
      readFileSync(join(distDirectory, "assets", match[1]), "utf8"),
    ).join("\n"),
  };
}

describe("production bundle boundaries", () => {
  test("the capture page ships independently from the workspace entry and preview stack", () => {
    expect(existsSync(join(distDirectory, "capture.html"))).toBe(true);

    const { captureHtml, entry, styles } = readCaptureEntry();
    const emittedAssets = readdirSync(join(distDirectory, "assets"));

    expect(captureHtml).not.toContain("/src/main.tsx");
    expect(captureHtml).not.toMatch(/main-[^"']+\.js/);
    expect(entry).not.toMatch(/codemirror|react-markdown|lowlight|mermaid/i);
    expect(styles).not.toMatch(/\.app-shell|\.preview|\.settings-dialog/);
    expect(emittedAssets.some((asset) => asset.endsWith(".css"))).toBe(true);
  });
});
