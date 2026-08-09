export type CaptureMarkdownEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export function captureMarkdownEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  key: string,
  shiftKey = false,
): CaptureMarkdownEdit | undefined {
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  if (key === "Tab") {
    const indentation =
      value.slice(lineStart, selectionStart).match(/^(?: {1,2}|\t)/)?.[0] || "";
    if (shiftKey && indentation)
      return {
        value: `${value.slice(0, lineStart)}${value.slice(lineStart + indentation.length)}`,
        selectionStart: Math.max(
          lineStart,
          selectionStart - indentation.length,
        ),
        selectionEnd: Math.max(lineStart, selectionEnd - indentation.length),
      };
    if (!shiftKey)
      return {
        value: `${value.slice(0, lineStart)}  ${value.slice(lineStart)}`,
        selectionStart: selectionStart + 2,
        selectionEnd: selectionEnd + 2,
      };
    return undefined;
  }
  if (key !== "Enter" || selectionStart !== selectionEnd) return undefined;
  const beforeCaret = value.slice(lineStart, selectionStart);
  const task = beforeCaret.match(/^([ \t]*)([-+*]) \[[ xX]\]\s?(.*)$/);
  const bullet = beforeCaret.match(/^([ \t]*)([-+*])\s+(.*)$/);
  const ordered = beforeCaret.match(/^([ \t]*)(\d+)([.)])\s+(.*)$/);
  const quote = beforeCaret.match(/^([ \t]*>\s?)(.*)$/);
  const match = task || bullet || ordered || quote;
  if (!match) return undefined;
  const content = match[match.length - 1];
  const indent = task || bullet || ordered ? match[1] : "";
  if (!content.trim())
    return {
      value: `${value.slice(0, lineStart)}${indent}${value.slice(selectionStart)}`,
      selectionStart: lineStart + indent.length,
      selectionEnd: lineStart + indent.length,
    };
  const prefix = task
    ? `${match[1]}${match[2]} [ ] `
    : bullet
      ? `${match[1]}${match[2]} `
      : ordered
        ? `${match[1]}${Number(match[2]) + 1}${match[3]} `
        : `${match[1]}`;
  const insertion = `\n${prefix}`;
  return {
    value: `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`,
    selectionStart: selectionStart + insertion.length,
    selectionEnd: selectionStart + insertion.length,
  };
}
