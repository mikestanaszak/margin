import { describe, expect, it } from "vitest";

import { validateReleaseAssets as validateReleaseAssetsContract } from "./verify-release-assets.mjs";

const tag = "v0.5.1";
const version = "0.5.1";
const completeAssetNames = [
  `Margin_${version}_x64-setup.exe`,
  `Margin_${version}_x64-setup.exe.sig`,
  `Margin_${version}_x64_en-US.msi`,
  `Margin_${version}_x64_en-US.msi.sig`,
  `Margin_${version}_aarch64.dmg`,
  `Margin_${version}_aarch64.app.tar.gz`,
  `Margin_${version}_aarch64.app.tar.gz.sig`,
  `Margin_${version}_amd64.deb`,
  `Margin_${version}_amd64.deb.sig`,
  `Margin_${version}_amd64.AppImage`,
  `Margin_${version}_amd64.AppImage.sig`,
  "latest.json",
  "SHA256SUMS",
];
const completeAssets = completeAssetNames.map((name, index) => ({
  name,
  apiUrl: `https://api.github.com/repos/mikestanaszak/margin/releases/assets/${1000 + index}`,
  digest: "",
}));
const assetUrl = (name: string) =>
  completeAssets.find((asset) => asset.name === name)?.apiUrl ?? "";
const matchingManifest = {
  version,
  platforms: {
    "windows-x86_64": {
      url: assetUrl(`Margin_${version}_x64-setup.exe`),
      signature: "windows-signature",
    },
    "windows-x86_64-nsis": {
      url: assetUrl(`Margin_${version}_x64-setup.exe`),
      signature: "windows-signature",
    },
    "windows-x86_64-msi": {
      url: assetUrl(`Margin_${version}_x64_en-US.msi`),
      signature: "windows-msi-signature",
    },
    "darwin-aarch64": {
      url: assetUrl(`Margin_${version}_aarch64.app.tar.gz`),
      signature: "mac-signature",
    },
    "darwin-aarch64-app": {
      url: assetUrl(`Margin_${version}_aarch64.app.tar.gz`),
      signature: "mac-signature",
    },
    "linux-x86_64": {
      url: assetUrl(`Margin_${version}_amd64.AppImage`),
      signature: "linux-signature",
    },
    "linux-x86_64-appimage": {
      url: assetUrl(`Margin_${version}_amd64.AppImage`),
      signature: "linux-signature",
    },
    "linux-x86_64-deb": {
      url: assetUrl(`Margin_${version}_amd64.deb`),
      signature: "linux-deb-signature",
    },
  },
};
const packageNames = [
  `Margin_${version}_x64-setup.exe`,
  `Margin_${version}_x64_en-US.msi`,
  `Margin_${version}_aarch64.dmg`,
  `Margin_${version}_aarch64.app.tar.gz`,
  `Margin_${version}_amd64.deb`,
  `Margin_${version}_amd64.AppImage`,
];
const completeChecksums = new Map(
  packageNames.map((name, index) => [name, `${index}`.repeat(64)]),
);
const completeArtifactChecksums = new Map([
  ...completeChecksums,
  ["SHA256SUMS", "a".repeat(64)],
]);
completeAssets.forEach((asset) => {
  asset.digest = `sha256:${completeArtifactChecksums.get(asset.name) ?? "b".repeat(64)}`;
});

function validateReleaseAssets(
  currentTag: string,
  assets: typeof completeAssets,
  manifest: typeof matchingManifest,
  checksums: Map<string, string>,
  artifactChecksums = completeArtifactChecksums,
) {
  return validateReleaseAssetsContract(
    currentTag,
    assets,
    manifest,
    checksums,
    artifactChecksums,
  );
}

describe("validateReleaseAssets", () => {
  it("accepts the complete three-platform release contract", () => {
    expect(
      validateReleaseAssets(
        tag,
        completeAssets,
        matchingManifest,
        completeChecksums,
      ),
    ).toEqual([]);
  });

  it("reports a missing macOS updater signature", () => {
    const assets = completeAssets.filter(
      ({ name }) => name !== `Margin_${version}_aarch64.app.tar.gz.sig`,
    );

    expect(
      validateReleaseAssets(tag, assets, matchingManifest, completeChecksums),
    ).toContain(
      `Missing release asset: Margin_${version}_aarch64.app.tar.gz.sig`,
    );
  });

  it("reports a package omitted from SHA256SUMS", () => {
    const checksums = new Map(completeChecksums);
    checksums.delete(`Margin_${version}_amd64.AppImage`);

    expect(
      validateReleaseAssets(tag, completeAssets, matchingManifest, checksums),
    ).toContain(`Missing checksum: Margin_${version}_amd64.AppImage`);
  });

  it("requires the secondary Windows MSI in SHA256SUMS", () => {
    const checksums = new Map(completeChecksums);
    checksums.delete(`Margin_${version}_x64_en-US.msi`);

    expect(
      validateReleaseAssets(tag, completeAssets, matchingManifest, checksums),
    ).toContain(`Missing checksum: Margin_${version}_x64_en-US.msi`);
  });

  it("rejects a well-formed checksum that does not match the artifact bytes", () => {
    const checksums = new Map(completeChecksums);
    const packageName = `Margin_${version}_amd64.AppImage`;
    checksums.set(packageName, "f".repeat(64));

    expect(
      validateReleaseAssets(
        tag,
        completeAssets,
        matchingManifest,
        checksums,
        completeChecksums,
      ),
    ).toContain(`Checksum mismatch: ${packageName}`);
  });

  it("rejects refreshed release metadata with the wrong uploaded digest", () => {
    const assets = structuredClone(completeAssets);
    const packageName = `Margin_${version}_aarch64.dmg`;
    const asset = assets.find(({ name }) => name === packageName);
    if (!asset) throw new Error("missing test asset");
    asset.digest = `sha256:${"f".repeat(64)}`;

    expect(
      validateReleaseAssets(tag, assets, matchingManifest, completeChecksums),
    ).toContain(`Release digest mismatch: ${packageName}`);
  });

  it("reports an updater manifest version mismatch", () => {
    expect(
      validateReleaseAssets(
        tag,
        completeAssets,
        { ...matchingManifest, version: "0.5.0" },
        completeChecksums,
      ),
    ).toContain("Updater manifest version 0.5.0 does not match 0.5.1");
  });

  it("rejects an empty updater signature", () => {
    const manifest = structuredClone(matchingManifest);
    manifest.platforms["darwin-aarch64"].signature = " ";

    expect(
      validateReleaseAssets(tag, completeAssets, manifest, completeChecksums),
    ).toContain("Missing updater signature for darwin-aarch64");
  });

  it("rejects a platform URL absent from the tagged release", () => {
    const manifest = structuredClone(matchingManifest);
    manifest.platforms["windows-x86_64"].url =
      "https://api.github.com/repos/mikestanaszak/margin/releases/assets/9999";

    expect(
      validateReleaseAssets(tag, completeAssets, manifest, completeChecksums),
    ).toContain("Invalid updater URL for windows-x86_64");
  });

  it("rejects a platform URL for the wrong artifact", () => {
    const manifest = structuredClone(matchingManifest);
    manifest.platforms["linux-x86_64"].url = assetUrl(
      `Margin_${version}_amd64.deb`,
    );

    expect(
      validateReleaseAssets(tag, completeAssets, manifest, completeChecksums),
    ).toContain("Invalid updater URL for linux-x86_64");
  });
});
