import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

function validateFilename(name) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    /[\x00-\x1f\x7f/\\]/.test(name)
  ) {
    throw new Error(`Unsafe checksum filename: ${String(name)}`);
  }
}

export function createChecksumManifest(files) {
  const names = new Set();
  const entries = files.map(({ name, bytes }) => {
    validateFilename(name);
    if (names.has(name)) throw new Error(`Duplicate checksum filename: ${name}`);
    names.add(name);
    return {
      name,
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  return entries.map(({ name, hash }) => `${hash}  ${name}\n`).join("");
}

export function parseChecksumManifest(text) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error("Checksum manifest is empty or contains a blank entry");
  }

  const checksums = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`Malformed checksum entry: ${line}`);
    const [, hash, name] = match;
    validateFilename(name);
    if (checksums.has(name)) throw new Error(`Duplicate checksum filename: ${name}`);
    checksums.set(name, hash);
  }
  return checksums;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || !value) throw new Error(`Missing required argument: ${name}`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = readArgument("--directory");
  const output = readArgument("--output");
  const outputName = basename(output);
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== outputName)
    .map((entry) => ({
      name: entry.name,
      bytes: readFileSync(join(directory, entry.name)),
    }));
  writeFileSync(output, createChecksumManifest(files), "utf8");
}
