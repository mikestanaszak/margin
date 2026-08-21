import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { extractReleaseNotes } from "./extract-release-notes.mjs";

describe("release note extraction", () => {
  it("returns only the requested changelog section", () => {
    const changelog = [
      "# Changelog",
      "",
      "## 0.6.0 — 2026-09-01",
      "",
      "### Added",
      "",
      "- Newer work.",
      "",
      "## 0.5.1 — 2026-08-21",
      "",
      "### Fixed",
      "",
      "- The requested fix.",
      "",
      "## 0.5.0 — 2026-08-13",
      "",
      "- Older work.",
      "",
    ].join("\n");

    expect(extractReleaseNotes(changelog, "v0.5.1")).toBe(
      "### Fixed\n\n- The requested fix.\n",
    );
  });

  it("supports Windows changelog line endings", () => {
    const changelog =
      "# Changelog\r\n\r\n## 1.2.3 — 2026-08-21\r\n\r\n### Added\r\n\r\n- Notes.\r\n";

    expect(extractReleaseNotes(changelog, "1.2.3")).toBe(
      "### Added\n\n- Notes.\n",
    );
  });

  it("rejects missing or duplicate version sections", () => {
    expect(() => extractReleaseNotes("## 1.0.0\n\n- Notes.\n", "2.0.0")).toThrow(
      "No changelog section found for 2.0.0",
    );
    expect(() =>
      extractReleaseNotes(
        "## 1.0.0\n\n- First.\n\n## 1.0.0 — later\n\n- Second.\n",
        "1.0.0",
      ),
    ).toThrow("Multiple changelog sections found for 1.0.0");
  });

  it("rejects an empty version section", () => {
    expect(() => extractReleaseNotes("## 1.0.0\n\n## 0.9.0\n", "1.0.0")).toThrow(
      "Changelog section for 1.0.0 is empty",
    );
  });

  it("publishes the extracted changelog section in the release workflow", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain("node scripts/extract-release-notes.mjs");
    expect(workflow).toContain("gh release edit");
    expect(workflow).toContain("--notes-file release-notes.md");
  });
});
