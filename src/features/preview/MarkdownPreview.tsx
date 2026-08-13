import React, { useMemo, useRef, useState } from "react";
import "./preview.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { all as highlightLanguages } from "lowlight";
import MermaidDiagram from "../../MermaidDiagram";
import type { NoteSummary } from "../../app/types";
import { parseMarkdownTables } from "../../note-utils";
import { native } from "../../services/native";

type MarkdownNode = { type?: string; lang?: string | null; checked?: boolean | null; children?: MarkdownNode[]; data?: { hProperties?: Record<string, unknown> } };

export function MarkdownPreview({
  markdown,
  notePath,
  notes,
  onOpen,
  onOpenExternalError = () => undefined,
  onEditTable,
  onToggleTask,
  editable = true,
}: {
  markdown: string;
  notePath: string;
  notes: NoteSummary[];
  onOpen: (note: NoteSummary) => void;
  onOpenExternalError?: (message: string) => void;
  onEditTable: (index: number) => void;
  onToggleTask: (index: number, checked: boolean) => void;
  editable?: boolean;
}) {
  const resolved = useMemo(
    () =>
      markdown.replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_, title, label) =>
          `[${label || title}](note:${encodeURIComponent(title.trim())})`,
      ),
    [markdown],
  );
  const directory = notePath.replace(/[\\/][^\\/]+$/, "");
  const localAsset = (src?: string) => {
    if (!src || /^(https?:|data:|asset:)/i.test(src)) return src;
    const separator = directory.includes("\\") ? "\\" : "/";
    const parent = directory.replace(/[\\/]+$/, "");
    let decoded = src;
    try {
      decoded = decodeURIComponent(src);
    } catch {
      // Keep malformed escapes literal so a bad Markdown URL cannot break preview.
    }
    const relative = decoded
      .replace(/^[\\/]+/, "")
      .replace(/[\\/]/g, separator);
    return convertFileSrc(`${parent}${separator}${relative}`);
  };
  const markdownTables = useMemo(() => parseMarkdownTables(markdown), [markdown]);
  const normalizePath = (path: string) => {
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    return parts.join("/").toLowerCase();
  };
  const markdownLinkTarget = (href?: string) => {
    const relativePath = href?.split(/[?#]/, 1)[0];
    if (
      !relativePath ||
      !/\.md$/i.test(relativePath) ||
      /^[a-z][a-z\d+.-]*:/i.test(relativePath)
    )
      return undefined;
    const targetPath = /^[\\/]|^[a-z]:[\\/]/i.test(relativePath)
      ? relativePath
      : `${directory}/${decodeURIComponent(relativePath)}`;
    return notes.find(
      (item) => normalizePath(item.path) === normalizePath(targetPath),
    );
  };
  const externalUrl = (href?: string) => {
    const value = href?.trim();
    if (!value) return undefined;
    if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
    return /^(?:www\.)?[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d-]+)+(?:[/?#].*)?$/i.test(
      value,
    )
      ? `https://${value}`
      : undefined;
  };
  const openExternal = (href?: string) => {
    const url = externalUrl(href);
    if (!url) {
      onOpenExternalError(
        "Could not open link: use a full web address such as https://example.com",
      );
      return;
    }
    void native.openExternalUrl(url).catch((error) =>
      onOpenExternalError(String(error)),
    );
  };
  const togglePreviewTask = (event: React.MouseEvent<HTMLElement>) => {
    const input =
      event.target instanceof HTMLInputElement &&
      event.target.type === "checkbox"
        ? event.target
        : null;
    const item = input?.closest<HTMLElement>("li[data-task-index]");
    const index = Number(item?.dataset.taskIndex);
    if (editable && input && Number.isInteger(index) && index >= 0)
      onToggleTask(index, input.checked);
  };
  const selectInlineCode = (event: React.MouseEvent<HTMLElement>) => {
    const code =
      event.target instanceof Element ? event.target.closest("code") : null;
    if (!code || code.parentElement?.tagName === "PRE") return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  return (
    <article
      className="preview"
      onClick={togglePreviewTask}
      onDoubleClick={selectInlineCode}
    >
      <ReactMarkdown
        urlTransform={(url) =>
          url.startsWith("note:") ? url : defaultUrlTransform(url)
        }
        remarkPlugins={[remarkGfm, annotateTaskIndexes, normalizeCodeLanguages]}
        rehypePlugins={[[rehypeHighlight, { languages: highlightLanguages }]]}
        components={{
          pre: ({ children, node: _node, ...props }) => {
            const child = React.Children.toArray(children)[0];
            if (
              React.isValidElement<{
                className?: string;
                children?: React.ReactNode;
              }>(child) &&
              child.props.className?.split(/\s+/).includes("language-mermaid")
            )
              return (
                <MermaidDiagram
                  source={String(child.props.children || "").replace(/\n$/, "")}
                />
              );
            return <PreviewCodeBlock {...props}>{children}</PreviewCodeBlock>;
          },
          a: ({ href, children }) => {
            if (href?.startsWith("note:")) {
              const title = decodeURIComponent(href.slice(5));
              const target = notes.find(
                (item) => item.title.toLowerCase() === title.toLowerCase(),
              );
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (target) onOpen(target);
                  }}
                >
                  {children}
                </a>
              );
            }
            const target = markdownLinkTarget(href);
            if (target)
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpen(target);
                  }}
                >
                  {children}
                </a>
              );
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  openExternal(href);
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => <img src={localAsset(src)} alt={alt || ""} />,
          table: ({ children, node, ...props }) => {
            const sourceLine = (
              node as { position?: { start?: { line?: number } } }
            ).position?.start?.line;
            const index = markdownTables.findIndex(
              (table) => table.start === (sourceLine || 0) - 1,
            );
            const openEditor = () => {
              if (editable && index >= 0) onEditTable(index);
            };
            return (
              <div className="preview-table-shell">
                {editable && (
                  <div className="preview-table-toolbar">
                    <span>Table</span>
                    <button
                      type="button"
                      className="preview-table-edit"
                      aria-label={`Edit table ${index + 1}`}
                      onClick={openEditor}
                    >
                      Edit table
                    </button>
                  </div>
                )}
                <table {...props} onClick={editable ? openEditor : undefined}>
                  {children}
                </table>
              </div>
            );
          },
          input: ({ type, checked, disabled: _disabled, ...props }) => {
            if (type !== "checkbox") return <input type={type} {...props} />;
            return (
              <input
                {...props}
                type="checkbox"
                checked={Boolean(checked)}
                disabled={!editable}
                onChange={() => undefined}
              />
            );
          },
        }}
      >
        {resolved}
      </ReactMarkdown>
    </article>
  );
}
export const MemoizedMarkdownPreview = React.memo(MarkdownPreview);

function PreviewCodeBlock({
  children,
  ...props
}: React.ComponentPropsWithoutRef<"pre">) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copyCode = async () => {
    const code = preRef.current?.querySelector("code")?.textContent;
    if (code === null || code === undefined) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  const buttonLabel =
    copyStatus === "copied"
      ? "Code copied"
      : copyStatus === "failed"
        ? "Could not copy code"
        : "Copy code";
  const buttonText =
    copyStatus === "copied"
      ? "Copied"
      : copyStatus === "failed"
        ? "Copy failed"
        : "Copy";

  return (
    <div className="preview-code-block">
      <pre ref={preRef} {...props}>{children}</pre>
      <button
        type="button"
        className="preview-code-copy"
        aria-label={buttonLabel}
        onClick={() => void copyCode()}
      >
        {buttonText}
      </button>
    </div>
  );
}

export function normalizeCodeLanguages() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "code" && node.lang)
        node.lang = node.lang.toLowerCase();
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
export function annotateTaskIndexes() {
  return (tree: MarkdownNode) => {
    let index = 0;
    const visit = (node: MarkdownNode) => {
      if (
        node.type === "listItem" &&
        node.checked !== null &&
        node.checked !== undefined
      ) {
        node.data = {
          ...node.data,
          hProperties: { ...node.data?.hProperties, "data-task-index": index },
        };
        index += 1;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
