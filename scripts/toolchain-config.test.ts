import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("toolchain configuration", () => {
  it("pins pnpm and isolates the real Mermaid renderer", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.packageManager).toBe("pnpm@10.15.1");
    expect(pkg.scripts["test:unit"]).toContain("--exclude src/MermaidDiagram.integration.test.tsx");
    expect(pkg.scripts["test:integration"]).toContain("--maxWorkers=1");
    expect(pkg.scripts.test).toBe("pnpm test:unit && pnpm test:integration");
  });
});
