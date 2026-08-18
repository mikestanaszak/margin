import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseChecksumManifest } from "./release-checksums.mjs";

export function validateReleaseAssets(
  tag,
  releaseAssets,
  latestManifest,
  checksums,
) {
  const version = tag.replace(/^v/, "");
  const packages = [
    `Margin_${version}_x64-setup.exe`,
    `Margin_${version}_x64_en-US.msi`,
    `Margin_${version}_aarch64.dmg`,
    `Margin_${version}_aarch64.app.tar.gz`,
    `Margin_${version}_amd64.deb`,
    `Margin_${version}_amd64.AppImage`,
  ];
  const required = [
    ...packages,
    `Margin_${version}_x64-setup.exe.sig`,
    `Margin_${version}_x64_en-US.msi.sig`,
    `Margin_${version}_aarch64.app.tar.gz.sig`,
    `Margin_${version}_amd64.deb.sig`,
    `Margin_${version}_amd64.AppImage.sig`,
    "latest.json",
    "SHA256SUMS",
  ];
  const assets = releaseAssets.map((asset) =>
    typeof asset === "string" ? { name: asset, apiUrl: undefined } : asset,
  );
  const names = new Set(assets.map((asset) => asset.name));
  const assetUrls = new Map(assets.map((asset) => [asset.name, asset.apiUrl]));
  const errors = required
    .filter((name) => !names.has(name))
    .map((name) => `Missing release asset: ${name}`);

  if (latestManifest.version !== version) {
    errors.push(
      `Updater manifest version ${latestManifest.version} does not match ${version}`,
    );
  }

  if (!(checksums instanceof Map)) {
    errors.push("Missing or invalid SHA256SUMS manifest");
  } else {
    for (const name of packages) {
      if (!checksums.has(name)) errors.push(`Missing checksum: ${name}`);
    }
  }

  const expectedPlatforms = new Map([
    ["windows-x86_64", `Margin_${version}_x64-setup.exe`],
    ["windows-x86_64-nsis", `Margin_${version}_x64-setup.exe`],
    ["windows-x86_64-msi", `Margin_${version}_x64_en-US.msi`],
    ["darwin-aarch64", `Margin_${version}_aarch64.app.tar.gz`],
    ["darwin-aarch64-app", `Margin_${version}_aarch64.app.tar.gz`],
    ["linux-x86_64", `Margin_${version}_amd64.AppImage`],
    ["linux-x86_64-appimage", `Margin_${version}_amd64.AppImage`],
    ["linux-x86_64-deb", `Margin_${version}_amd64.deb`],
  ]);
  const platforms = latestManifest.platforms ?? {};
  for (const [platform, artifact] of expectedPlatforms) {
    const entry = platforms[platform];
    if (!entry) {
      errors.push(`Missing updater platform: ${platform}`);
      continue;
    }
    if (typeof entry.signature !== "string" || entry.signature.trim() === "") {
      errors.push(`Missing updater signature for ${platform}`);
    }
    const expectedUrl = assetUrls.get(artifact);
    if (entry.url !== expectedUrl) errors.push(`Invalid updater URL for ${platform}`);
  }
  for (const platform of Object.keys(platforms)) {
    if (!expectedPlatforms.has(platform)) {
      errors.push(`Unexpected updater platform: ${platform}`);
    }
  }

  return errors;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];

  if (index === -1 || !value) {
    throw new Error(`Missing required argument: ${name}`);
  }

  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = readArgument("--tag");
  const releasePath = readArgument("--release");
  const latestPath = readArgument("--latest");
  const checksumsPath = readArgument("--checksums");
  const release = JSON.parse(readFileSync(releasePath, "utf8"));
  const latestManifest = JSON.parse(readFileSync(latestPath, "utf8"));
  const checksums = parseChecksumManifest(readFileSync(checksumsPath, "utf8"));
  const errors = validateReleaseAssets(
    tag,
    release.assets,
    latestManifest,
    checksums,
  );

  errors.forEach((error) => console.error(error));
  if (errors.length > 0) process.exitCode = 1;
}
