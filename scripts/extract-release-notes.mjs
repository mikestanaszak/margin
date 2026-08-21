import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const normalizedVersion = (version) => version.trim().replace(/^v/, "");

const headingMatchesVersion = (heading, version) =>
  heading === version ||
  heading.startsWith(`${version} —`) ||
  heading.startsWith(`${version} -`);

export function extractReleaseNotes(changelog, requestedVersion) {
  const version = normalizedVersion(requestedVersion);
  if (!version) {
    throw new Error("A release version is required");
  }

  const normalized = changelog.replace(/\r\n?/g, "\n");
  const headings = [...normalized.matchAll(/^##\s+(.+)$/gm)];
  const matchingIndexes = headings
    .map((heading, index) =>
      headingMatchesVersion(heading[1].trim(), version) ? index : -1,
    )
    .filter((index) => index >= 0);

  if (matchingIndexes.length === 0) {
    throw new Error(`No changelog section found for ${version}`);
  }
  if (matchingIndexes.length > 1) {
    throw new Error(`Multiple changelog sections found for ${version}`);
  }

  const headingIndex = matchingIndexes[0];
  const heading = headings[headingIndex];
  const start = heading.index + heading[0].length;
  const end = headings[headingIndex + 1]?.index ?? normalized.length;
  const notes = normalized.slice(start, end).trim();
  if (!notes) {
    throw new Error(`Changelog section for ${version} is empty`);
  }

  return `${notes}\n`;
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) {
    return fallback;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const version = option(args, "--version");
  const changelogPath = option(args, "--changelog", "CHANGELOG.md");
  const outputPath = option(args, "--output");
  if (!version || !outputPath) {
    throw new Error(
      "Usage: node scripts/extract-release-notes.mjs --version <version> --output <file> [--changelog <file>]",
    );
  }

  const changelog = await readFile(changelogPath, "utf8");
  const notes = extractReleaseNotes(changelog, version);
  await writeFile(outputPath, notes, "utf8");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
