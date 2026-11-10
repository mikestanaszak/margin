import React, { useMemo, useRef, useState } from "react";
import "./preview.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { all as highlightLanguages } from "lowlight";
import MermaidDiagram from "../../MermaidDiagram";
import type { NoteSummary } from "../../app/types";
import { parseMarkdownTables, safeDecodeURIComponent } from "../../note-utils";
import {
  noteForMarkdownLink,
  noteForWikiTitle,
  openExternalLink,
} from "./links";

type MarkdownNode = {
  type?: string;
  lang?: string | null;
  checked?: boolean | null;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start?: { line?: number } };
  data?: { hProperties?: Record<string, unknown> };
};
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

const headingTags: HeadingTag[] = ["h1", "h2", "h3", "h4", "h5", "h6"];
/** Headings expose their source line so the outline can find them exactly. */
const headingComponents = Object.fromEntries(
  headingTags.map((Tag) => [
    Tag,
    ({
      node,
      ...props
    }: React.ComponentPropsWithoutRef<HeadingTag> & {
      node?: MarkdownNode;
    }) => <Tag {...props} data-source-line={node?.position?.start?.line} />,
  ]),
);

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
  const directory = notePath.replace(/[\\/][^\\/]+$/, "");
  const localAsset = (src?: string) => {
    if (!src || /^(https?:|data:|asset:)/i.test(src)) return src;
    const separator = directory.includes("\\") ? "\\" : "/";
    const parent = directory.replace(/[\\/]+$/, "");
    // Keep malformed escapes literal so a bad Markdown URL cannot break preview.
    const decoded = safeDecodeURIComponent(src);
    // Tauri's asset protocol rejects paths containing parent components.
    // Resolve them before conversion, preserving drive and UNC roots; native
    // asset scope checks still decide whether the final file may be read.
    const root =
      parent.match(
        /^(?:\\\\\?\\UNC\\[^\\]+\\[^\\]+|\\\\\?\\[a-z]:|\\\\[^\\]+\\[^\\]+|[a-z]:|\/)/i,
      )?.[0] ?? "";
    const parts = parent.slice(root.length).split(/[\\/]/).filter(Boolean);
    for (const part of decoded.split(/[\\/]/)) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) return undefined;
        parts.pop();
      } else parts.push(part);
    }
    return convertFileSrc(
      `${root}${root.endsWith(separator) ? "" : separator}${parts.join(separator)}`,
    );
  };
  const markdownTables = useMemo(
    () => parseMarkdownTables(markdown),
    [markdown],
  );
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
        remarkPlugins={[
          remarkGfm,
          wikiLinks,
          annotateTaskIndexes,
          normalizeCodeLanguages,
        ]}
        rehypePlugins={[[rehypeHighlight, { languages: highlightLanguages }]]}
        components={{
          ...headingComponents,
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
              const title = safeDecodeURIComponent(href.slice(5));
              const target = noteForWikiTitle(title, notes);
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
            const target = noteForMarkdownLink(href, notePath, notes);
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
                  openExternalLink(href, onOpenExternalError);
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
        {markdown}
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
      <pre ref={preRef} {...props}>
        {children}
      </pre>
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
const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Turns `[[Title]]` and `[[Title|label]]` in prose into note links. Running on
 * the syntax tree keeps code blocks and inline code literal, so shell tests
 * such as `[[ -f file ]]` render unchanged.
 */
export function wikiLinks() {
  const linkify = (text: string): MarkdownNode[] => {
    const nodes: MarkdownNode[] = [];
    let cursor = 0;
    for (const match of text.matchAll(wikiLinkPattern)) {
      const start = match.index ?? 0;
      if (start > cursor)
        nodes.push({ type: "text", value: text.slice(cursor, start) });
      nodes.push({
        type: "link",
        url: `note:${encodeURIComponent(match[1].trim())}`,
        children: [{ type: "text", value: match[2] || match[1] }],
      });
      cursor = start + match[0].length;
    }
    if (cursor < text.length)
      nodes.push({ type: "text", value: text.slice(cursor) });
    return nodes;
  };
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (
        !node.children ||
        node.type === "link" ||
        node.type === "linkReference"
      )
        return;
      node.children = node.children.flatMap((child) =>
        child.type === "text" && child.value?.includes("[[")
          ? linkify(child.value)
          : [child],
      );
      node.children.forEach(visit);
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
