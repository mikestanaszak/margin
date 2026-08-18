import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("toolchain configuration", () => {
  it("keeps Vitest out of nested worktrees without dropping its default exclusions", () => {
    const inspectConfig = [
      'import { loadConfigFromFile } from "vite";',
      'import { configDefaults } from "vitest/config";',
      "const loaded = await loadConfigFromFile(",
      '  { command: "serve", mode: "test" },',
      '  "vite.config.ts",',
      ");",
      "process.stdout.write(JSON.stringify({",
      "  excluded: loaded?.config.test?.exclude ?? [],",
      "  defaults: configDefaults.exclude,",
      "}));",
    ].join("\n");
    const inspected = JSON.parse(
      execFileSync(
        process.execPath,
        ["--input-type=module", "--eval", inspectConfig],
        { encoding: "utf8" },
      ),
    ) as { excluded: string[]; defaults: string[] };

    expect(inspected.excluded).toContain("**/.worktrees/**");
    for (const defaultExclusion of inspected.defaults)
      expect(inspected.excluded).toContain(defaultExclusion);
  });

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
