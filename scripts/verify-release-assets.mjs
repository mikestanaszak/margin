import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function validateReleaseAssets(tag, assetNames, latestManifest) {
  const version = tag.replace(/^v/, "");
  const required = [
    `Margin_${version}_x64-setup.exe`,
    `Margin_${version}_x64-setup.exe.sig`,
    `Margin_${version}_aarch64.dmg`,
    `Margin_${version}_aarch64.app.tar.gz`,
    `Margin_${version}_aarch64.app.tar.gz.sig`,
    `Margin_${version}_amd64.deb`,
    `Margin_${version}_amd64.deb.sig`,
    `Margin_${version}_amd64.AppImage`,
    `Margin_${version}_amd64.AppImage.sig`,
    "latest.json",
  ];
  const names = new Set(assetNames);
  const errors = required
    .filter((name) => !names.has(name))
    .map((name) => `Missing release asset: ${name}`);

  if (latestManifest.version !== version) {
    errors.push(
      `Updater manifest version ${latestManifest.version} does not match ${version}`,
    );
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
  const release = JSON.parse(readFileSync(releasePath, "utf8"));
  const latestManifest = JSON.parse(readFileSync(latestPath, "utf8"));
  const errors = validateReleaseAssets(
    tag,
    release.assets.map((asset) => asset.name),
    latestManifest,
  );

  errors.forEach((error) => console.error(error));
  if (errors.length > 0) process.exitCode = 1;
}
