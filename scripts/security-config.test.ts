import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(repositoryRoot, relativePath), "utf8")) as T;
}

function readText(relativePath: string) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

describe("desktop security configuration", () => {
  it("does not register superseded snapshot commands", () => {
    const source = readText("src-tauri/src/lib.rs");

    for (const checkoutSource of [source, source.replace(/\r?\n/g, "\r\n")]) {
      const normalizedSource = checkoutSource.replace(/\r\n/g, "\n");
      const start = normalizedSource.indexOf("tauri::generate_handler![");
      const end = normalizedSource.indexOf("])\n", start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const handler = normalizedSource.slice(start, end + 2);

      for (const command of ["load_library,", "load_folders,", "load_trash,", "rename_note,"]) {
        expect(handler).not.toContain(command);
      }

      expect(handler).toContain("load_library_snapshot,");
    }
  });

  it("keeps development sources and global file globs out of production", () => {
    const config = readJson<{
      app: {
        security: {
          csp: string;
          devCsp?: string;
          assetProtocol: { scope: string[] };
        };
      };
    }>("src-tauri/tauri.conf.json");
    const { security } = config.app;

    expect(security.assetProtocol.scope).toEqual(["$HOME/**"]);
    expect(security.csp).not.toMatch(
      /unsafe-eval|http:\/\/localhost:1420|ws:\/\/localhost:1420/,
    );
    expect(security.devCsp).toMatch(/http:\/\/localhost:1420/);
    expect(security.devCsp).toMatch(/ws:\/\/localhost:1420/);
  });

  it("grants plugin permissions only to the window that uses them", () => {
    const shared = readJson<{ windows: string[]; permissions: string[] }>(
      "src-tauri/capabilities/default.json",
    );
    const desktop = readJson<{ windows: string[]; permissions: string[] }>(
      "src-tauri/capabilities/desktop.json",
    );

    expect(shared.windows).toEqual(["main", "capture"]);
    expect(shared.permissions).toEqual(["core:default"]);
    expect(desktop.windows).toEqual(["main"]);
    expect(desktop.permissions).toEqual([
      "dialog:allow-open",
      "updater:allow-check",
      "updater:allow-download-and-install",
      "process:allow-restart",
    ]);
  });
});

describe("workflow supply-chain configuration", () => {
  it("pins every external action to an immutable commit", () => {
    for (const workflow of [
      ".github/workflows/test.yml",
      ".github/workflows/release.yml",
    ]) {
      const actionReferences = [...readText(workflow).matchAll(/uses:\s+([^\s#]+)/g)].map(
        ([, reference]) => reference,
      );

      expect(actionReferences.length).toBeGreaterThan(0);
      for (const reference of actionReferences) {
        expect(reference, `${workflow}: ${reference}`).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });

  it("keeps manual installation on the checksummed trust path", () => {
    for (const installer of ["install.ps1", "install.sh", "install-linux.sh"]) {
      expect(readText(installer), installer).toContain("SHA256SUMS");
    }

    const readme = readText("README.md");
    expect(readme).toContain("Manual downloads do not yet carry Windows Authenticode");
    expect(readme).toContain("signed in-app updates");
  });

  it("selects exactly one versioned installer asset and rejects suffix decoys", () => {
    const windows = readText("install.ps1");
    expect(windows).toContain(
      '$expectedInstallerName = "Margin_${releaseVersion}_x64-setup.exe"',
    );
    expect(windows).toContain("$installers.Count -ne 1");
    expect(windows).not.toContain('Where-Object { $_.name -match "_x64-setup\\.exe$" }');
    expect(windows).not.toContain("Select-Object -First 1");

    const mac = readText("install.sh");
    expect(mac).toContain('ARTIFACT_NAME="Margin_${RELEASE_VERSION}_${ARCHITECTURE}.dmg"');
    expect(mac).toContain('[[ "$DOWNLOAD_COUNT" -eq 1 ]]');
    expect(mac).not.toContain('grep -E "_${ARCHITECTURE}\\.dmg$"');
    expect(mac).not.toContain("head -n 1");

    const linux = readText("install-linux.sh");
    expect(linux).toContain('ARTIFACT_NAME="Margin_${RELEASE_VERSION}_amd64.AppImage"');
    expect(linux).toContain('[[ "$DOWNLOAD_COUNT" -eq 1 ]]');
    expect(linux).not.toContain("grep -E '\\.AppImage$'");
    expect(linux).not.toContain("head -n 1");
  });
});
