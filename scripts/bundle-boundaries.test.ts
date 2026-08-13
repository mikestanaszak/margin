import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const distDirectory = join(process.cwd(), "dist");

type ManifestEntry = {
  file: string;
  imports?: string[];
  css?: string[];
  isEntry?: boolean;
};

function readCaptureBundle() {
  const captureHtml = readFileSync(join(distDirectory, "capture.html"), "utf8");
  const manifestPath = join(distDirectory, ".vite", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    ManifestEntry
  >;
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    manifest[key]?.imports?.forEach(visit);
  };

  visit("capture.html");
  const entries = [...seen].map((key) => manifest[key]);
  const files = entries.map((entry) => entry.file);
  const styles = entries.flatMap((entry) => entry.css || []);

  return {
    captureHtml,
    entryText: files.map((file) => readFileSync(join(distDirectory, file), "utf8")).join("\n"),
    styleText: styles.map((file) => readFileSync(join(distDirectory, file), "utf8")).join("\n"),
    files,
    styles,
  };
}

describe("production bundle boundaries", () => {
  test("the capture page ships independently from the workspace entry and preview stack", () => {
    expect(existsSync(join(distDirectory, "capture.html"))).toBe(true);

    expect(existsSync(join(distDirectory, ".vite", "manifest.json"))).toBe(true);

    const { captureHtml, entryText, styleText, files, styles } = readCaptureBundle();

    expect(captureHtml).not.toContain("/src/main.tsx");
    expect(captureHtml).not.toMatch(/main-[^"']+\.js/);
    expect(files.some((file) => /main-[\w-]+\.js/.test(file))).toBe(false);
    expect(entryText).not.toMatch(/codemirror|react-markdown|lowlight|mermaid/i);
    expect(styleText).not.toMatch(/\.app-shell|\.preview|\.settings-dialog/);
    expect(styles.length).toBeGreaterThan(0);
  });
});
