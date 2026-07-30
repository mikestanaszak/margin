import { isMac } from "./platform";

export type ComparableNoteDocument = {
  path: string;
  title: string;
  body: string;
  tags: readonly string[];
};

export type MarkdownTable = {
  start: number;
  end: number;
  headers: string[];
  rows: string[][];
};

export function titleFromBody(body: string) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Untitled";
}

export function fileStem(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.md$/i, "") || "Untitled";
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function wikiTargets(body: string) {
  return [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((match) =>
    match[1].trim(),
  );
}

export function hasUnsavedChanges(
  draft: ComparableNoteDocument,
  original: ComparableNoteDocument | null,
) {
  return (
    !original ||
    draft.path !== original.path ||
    draft.title !== original.title ||
    draft.body !== original.body ||
    draft.tags.join("\0") !== original.tags.join("\0")
  );
}

export function normalizedKey(
  event: Pick<globalThis.KeyboardEvent, "key" | "code">,
) {
  return event.code === "Space" ? "space" : event.key.toLowerCase();
}

export function matchesShortcut(
  event: globalThis.KeyboardEvent,
  binding: string,
) {
  const pieces = binding.toLowerCase().split("+").filter(Boolean);
  const key = pieces[pieces.length - 1];
  if (!key || normalizedKey(event) !== key) return false;
  return (
    event.metaKey === pieces.includes("meta") &&
    event.ctrlKey === pieces.includes("ctrl") &&
    event.altKey === pieces.includes("alt") &&
    event.shiftKey === pieces.includes("shift")
  );
}

export function formatShortcut(binding: string) {
  return binding
    .split("+")
    .map(
      (part) =>
        ({
          meta: "⌘",
          ctrl: "Ctrl",
          alt: isMac ? "⌥" : "Alt",
          shift: isMac ? "⇧" : "Shift",
          space: "Space",
          "\\": "\\",
        })[part] || part.toUpperCase(),
    )
    .join(isMac ? "" : "+");
}

export function nativeShortcut(binding: string) {
  return binding
    .split("+")
    .map(
      (part) =>
        ({
          meta: "Command",
          ctrl: "Control",
          alt: "Alt",
          shift: "Shift",
          space: "Space",
          "\\": "Backslash",
        })[part] || part.toUpperCase(),
    )
    .join("+");
}

export function toggleTask(markdown: string, taskIndex: number, checked: boolean) {
  let current = 0;
  return markdown.replace(
    /^(\s*(?:[-+*]|\d+\.)\s+\[)[ xX](\])/gm,
    (whole, before, after) =>
      current++ === taskIndex
        ? `${before}${checked ? "x" : " "}${after}`
        : whole,
  );
}

export function splitTableCells(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of trimmed) {
    if (character === "|" && !escaped) {
      cells.push(cell.trim().replace(/\\\|/g, "|"));
      cell = "";
    } else {
      cell += character;
    }
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  cells.push(cell.trim().replace(/\\\|/g, "|"));
  return cells;
}

function isTableDivider(line: string) {
  const cells = splitTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split("\n");
  const tables: MarkdownTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !isTableDivider(lines[index + 1])) continue;
    const headers = splitTableCells(lines[index]);
    let end = index + 2;
    const rows: string[][] = [];
    while (end < lines.length && lines[end].includes("|") && !/^\s*$/.test(lines[end])) {
      const cells = splitTableCells(lines[end]);
      if (cells.length < headers.length) break;
      rows.push(cells.slice(0, headers.length));
      end += 1;
    }
    tables.push({ start: index, end, headers, rows });
    index = end - 1;
  }
  return tables;
}

export function replaceMarkdownTable(
  markdown: string,
  index: number,
  headers: string[],
  rows: string[][],
) {
  const table = parseMarkdownTables(markdown)[index];
  if (!table) return markdown;
  const escape = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const line = (cells: string[]) => `| ${cells.map(escape).join(" | ")} |`;
  const next = [line(headers), line(headers.map(() => "---")), ...rows.map(line)];
  const lines = markdown.split("\n");
  lines.splice(table.start, table.end - table.start, ...next);
  return lines.join("\n");
}
