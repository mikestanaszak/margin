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

const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export type FenceLine = "open" | "inside" | "close" | null;

/** Classifies each line as a code-fence opener, closer, code, or prose. */
export function scanFences(lines: readonly string[]): FenceLine[] {
  let open: { marker: string; length: number } | null = null;
  return lines.map((line) => {
    const fence = fencePattern.exec(line);
    if (open) {
      if (
        fence &&
        fence[1][0] === open.marker &&
        fence[1].length >= open.length &&
        !fence[2].trim()
      ) {
        open = null;
        return "close";
      }
      return "inside";
    }
    // A backtick fence's info string cannot itself contain a backtick.
    if (fence && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      open = { marker: fence[1][0], length: fence[1].length };
      return "open";
    }
    return null;
  });
}

/**
 * Marks every line that belongs to a fenced code block, including the fences.
 * Content inside code is literal text: it never contributes a title, heading,
 * task, or table, matching both the preview and the native title logic.
 */
export function fencedCodeLines(lines: readonly string[]): boolean[] {
  return scanFences(lines).map((kind) => kind !== null);
}

/** Mirrors the native rule: the first `# ` line outside code is the title. */
export function titleFromBody(body: string) {
  const lines = body.split("\n");
  const fenced = fencedCodeLines(lines);
  const index = lines.findIndex(
    (line, lineIndex) => !fenced[lineIndex] && line.startsWith("# "),
  );
  return (index >= 0 && lines[index].slice(2).trim()) || "Untitled";
}

/** Decodes a URL component, keeping malformed escapes literal. */
export function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function fileStem(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.md$/i, "") || "Untitled";
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
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

/**
 * Applies a save's server-side rewrite to a draft that may have changed since.
 *
 * Renaming a note rewrites some lines of its body (companion image folders and
 * self links) without adding or removing lines. Each rewritten line is carried
 * into `current` at the nearest identical line, so edits made while the save
 * was in flight are kept and the rewrite is not undone by the next save.
 */
export function rebaseServerRewrite(
  sent: string,
  saved: string,
  current: string,
) {
  if (sent === saved) return current;
  if (current === sent) return saved;
  const sentLines = sent.split("\n");
  const savedLines = saved.split("\n");
  if (sentLines.length !== savedLines.length) return current;
  const lines = current.split("\n");
  sentLines.forEach((line, index) => {
    if (line === savedLines[index]) return;
    let match = -1;
    for (let distance = 0; distance < lines.length; distance += 1) {
      if (lines[index - distance] === line) match = index - distance;
      else if (lines[index + distance] === line) match = index + distance;
      if (match >= 0) break;
    }
    if (match >= 0) lines[match] = savedLines[index];
  });
  return lines.join("\n");
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

const taskPattern = /^((?:\s*>)*\s*(?:[-+*]|\d+[.)])\s+\[)[ xX](\])/;

/** Sets the n-th task (in preview order) without touching code examples. */
export function toggleTask(
  markdown: string,
  taskIndex: number,
  checked: boolean,
) {
  const lines = markdown.split("\n");
  const fenced = fencedCodeLines(lines);
  let current = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (fenced[index] || !taskPattern.test(lines[index])) continue;
    if (current++ !== taskIndex) continue;
    lines[index] = lines[index].replace(
      taskPattern,
      (_, before, after) => `${before}${checked ? "x" : " "}${after}`,
    );
    return lines.join("\n");
  }
  return markdown;
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
  const fenced = fencedCodeLines(lines);
  const tables: MarkdownTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (
      fenced[index] ||
      !lines[index].includes("|") ||
      !isTableDivider(lines[index + 1])
    )
      continue;
    const headers = splitTableCells(lines[index]);
    let end = index + 2;
    const rows: string[][] = [];
    while (
      end < lines.length &&
      !fenced[end] &&
      lines[end].includes("|") &&
      !/^\s*$/.test(lines[end])
    ) {
      // GFM pads short rows and drops extra cells; the editor must keep them
      // as part of the same table so applying an edit never leaves strays.
      const cells = splitTableCells(lines[end]);
      rows.push(headers.map((_, column) => cells[column] ?? ""));
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
  const escape = (value: string) =>
    value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const line = (cells: string[]) => `| ${cells.map(escape).join(" | ")} |`;
  const next = [
    line(headers),
    line(headers.map(() => "---")),
    ...rows.map(line),
  ];
  const lines = markdown.split("\n");
  lines.splice(table.start, table.end - table.start, ...next);
  return lines.join("\n");
}
