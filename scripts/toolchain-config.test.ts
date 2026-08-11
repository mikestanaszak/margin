import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("toolchain configuration", () => {
  it("pins pnpm and runs bundle inspection only after a production build", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.packageManager).toBe("pnpm@10.15.1");
    expect(pkg.scripts["test:unit"]).toContain("--exclude src/MermaidDiagram.integration.test.tsx");
    expect(pkg.scripts["test:unit"]).toContain("--exclude scripts/bundle-boundaries.test.ts");
    expect(pkg.scripts["test:integration"]).toContain("--maxWorkers=1");
    expect(pkg.scripts.test).toBe("pnpm test:unit && pnpm test:integration");
    expect(pkg.scripts["test:bundle"]).toBe(
      "pnpm build && vitest run scripts/bundle-boundaries.test.ts",
    );
    expect(pkg.scripts["test:all"]).toContain("pnpm test:bundle");
  });

  it("documents the configured suite without stale claims", () => {
    const agents = readFileSync("AGENTS.md", "utf8");
    const spec = readFileSync("PRODUCT_SPEC.md", "utf8");

    expect(agents).not.toContain("No automated test framework is currently configured");
    expect(agents).toContain("pnpm test");
    expect(spec.match(/code-fence language autocomplete/gi) ?? []).toHaveLength(0);
  });
});
