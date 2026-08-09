import { describe, expect, it } from "vitest";

import { validateReleaseAssets } from "./verify-release-assets.mjs";

const tag = "v0.3.2";
const completeAssetNames = [
  "Margin_0.3.2_x64-setup.exe",
  "Margin_0.3.2_x64-setup.exe.sig",
  "Margin_0.3.2_aarch64.dmg",
  "Margin_0.3.2_aarch64.app.tar.gz",
  "Margin_0.3.2_aarch64.app.tar.gz.sig",
  "Margin_0.3.2_amd64.deb",
  "Margin_0.3.2_amd64.deb.sig",
  "Margin_0.3.2_amd64.AppImage",
  "Margin_0.3.2_amd64.AppImage.sig",
  "latest.json",
];
const matchingManifest = {
  version: "0.3.2",
  platforms: {
    "windows-x86_64": {},
    "darwin-aarch64": {},
    "linux-x86_64": {},
  },
};

describe("validateReleaseAssets", () => {
  it("accepts the complete three-platform release contract", () => {
    expect(validateReleaseAssets(tag, completeAssetNames, matchingManifest)).toEqual([]);
  });

  it("reports a missing macOS updater signature", () => {
    const assetNames = completeAssetNames.filter(
      (name) => name !== "Margin_0.3.2_aarch64.app.tar.gz.sig",
    );

    expect(validateReleaseAssets(tag, assetNames, matchingManifest)).toContain(
      "Missing release asset: Margin_0.3.2_aarch64.app.tar.gz.sig",
    );
  });

  it("reports a missing Linux AppImage", () => {
    const assetNames = completeAssetNames.filter(
      (name) => name !== "Margin_0.3.2_amd64.AppImage",
    );

    expect(validateReleaseAssets(tag, assetNames, matchingManifest)).toContain(
      "Missing release asset: Margin_0.3.2_amd64.AppImage",
    );
  });

  it("reports an updater manifest version mismatch", () => {
    expect(
      validateReleaseAssets(tag, completeAssetNames, {
        version: "0.3.1",
      }),
    ).toContain("Updater manifest version 0.3.1 does not match 0.3.2");
  });
});
