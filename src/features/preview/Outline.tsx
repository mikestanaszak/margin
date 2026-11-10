import React, { useEffect, useMemo, useRef, useState } from "react";
import { clamp, fencedCodeLines } from "../../note-utils";

/** `line` is the 1-based source line, matching the preview's data-source-line. */
export type OutlineItem = {
  index: number;
  level: number;
  title: string;
  line?: number;
};
type OutlineNode = OutlineItem & { children: OutlineNode[] };

const atxHeading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const setextUnderline = /^ {0,3}(=+|-+)[ \t]*$/;
const plainParagraphLine = /^ {0,3}(?![#>*+|-]|\d+[.)]\s|$)/;

/**
 * Lists the headings the preview renders, in document order. Lines inside
 * fenced code (for example shell comments) are not headings.
 */
export function extractOutlineItems(body: string): OutlineItem[] {
  const lines = body.split("\n");
  const fenced = fencedCodeLines(lines);
  const items: OutlineItem[] = [];
  lines.forEach((rawLine, lineIndex) => {
    if (fenced[lineIndex]) return;
    const line = rawLine.replace(/^(?: {0,3}>[ \t]?)+/, "");
    const atx = atxHeading.exec(line);
    if (atx?.[2].trim()) {
      items.push({
        index: items.length,
        level: atx[1].length,
        title: atx[2].trim(),
        line: lineIndex + 1,
      });
      return;
    }
    const previous = lines[lineIndex - 1];
    const underline = setextUnderline.exec(rawLine);
    if (
      underline &&
      lineIndex > 0 &&
      !fenced[lineIndex - 1] &&
      previous.trim() &&
      plainParagraphLine.test(previous) &&
      !items.some((item) => item.line === lineIndex)
    )
      items.push({
        index: items.length,
        level: underline[1].startsWith("=") ? 1 : 2,
        title: previous.trim(),
        line: lineIndex,
      });
  });
  return items;
}

export function outlineTree(items: OutlineItem[]) {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const item of items) {
    const node: OutlineNode = { ...item, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level)
      stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}
export function activeOutlineAncestors(
  items: OutlineItem[],
  activeIndex: number | null,
) {
  const ancestors = new Set<number>();
  const position = items.findIndex((item) => item.index === activeIndex);
  if (position < 0) return ancestors;
  let level = items[position].level;
  for (let index = position - 1; index >= 0; index -= 1) {
    if (items[index].level < level) {
      ancestors.add(items[index].index);
      level = items[index].level;
    }
  }
  return ancestors;
}
export function scrollProgress(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
) {
  const maximum = Math.max(0, scrollHeight - clientHeight);
  return maximum ? clamp(scrollTop / maximum, 0, 1) : 0;
}
export function scrollTopForProgress(
  progress: number,
  scrollHeight: number,
  clientHeight: number,
) {
  return clamp(progress, 0, 1) * Math.max(0, scrollHeight - clientHeight);
}
type ScrollablePane = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>;
type PreviewScrollablePane = ScrollablePane &
  Pick<HTMLElement, "getBoundingClientRect">;
export function syncScrollPosition(
  source: ScrollablePane,
  target: ScrollablePane,
) {
  const next = scrollTopForProgress(
    scrollProgress(source.scrollTop, source.scrollHeight, source.clientHeight),
    target.scrollHeight,
    target.clientHeight,
  );
  if (Math.abs(target.scrollTop - next) > 1) target.scrollTop = next;
  return next;
}
export function scrollOutlineTargetIntoPreview(
  preview: PreviewScrollablePane,
  heading: HTMLElement,
) {
  const next = clamp(
    preview.scrollTop +
      heading.getBoundingClientRect().top -
      preview.getBoundingClientRect().top -
      76,
    0,
    Math.max(0, preview.scrollHeight - preview.clientHeight),
  );
  preview.scrollTop = next;
  return next;
}
export function activeOutlineIndexAtScroll(
  items: OutlineItem[],
  headingOffsets: number[],
  scrollTop: number,
  offset = 76,
) {
  let activeItem = 0;
  for (let index = 0; index < headingOffsets.length; index += 1) {
    if (headingOffsets[index] > scrollTop + offset) break;
    activeItem = index;
  }
  return items[activeItem]?.index ?? items[0]?.index ?? null;
}

/** Finds the rendered heading for each outline item by its source line. */
function renderedHeadings(preview: HTMLElement, items: OutlineItem[]) {
  const pairs: { item: OutlineItem; heading: HTMLElement }[] = [];
  for (const item of items) {
    const heading =
      item.line === undefined
        ? null
        : preview.querySelector<HTMLElement>(
            `[data-source-line="${item.line}"]`,
          );
    if (heading) pairs.push({ item, heading });
  }
  return pairs;
}

function previewPane() {
  return document.querySelector<HTMLElement>(".note-content .preview");
}

export function Outline({
  items,
  dirty,
  width = 280,
  onClose,
  onNavigate,
}: {
  items: OutlineItem[];
  dirty: boolean;
  width?: number;
  onClose: () => void;
  /** Used when no preview is visible, for example in Edit mode. */
  onNavigate?: (item: OutlineItem) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(
    () => items[0]?.index ?? null,
  );
  const outline = useRef<HTMLElement>(null);
  const tree = useMemo(() => outlineTree(items), [items]);
  const activeAncestors = useMemo(
    () => activeOutlineAncestors(items, activeIndex),
    [items, activeIndex],
  );

  useEffect(() => {
    const preview = previewPane();
    const outlineScroller = outline.current;
    if (!preview || !outlineScroller) {
      setActiveIndex((current) =>
        items.some((item) => item.index === current)
          ? current
          : (items[0]?.index ?? null),
      );
      return;
    }
    const syncActive = () => {
      const previewTop = preview.getBoundingClientRect().top;
      const pairs = renderedHeadings(preview, items);
      const headingOffsets = pairs.map(
        ({ heading }) =>
          heading.getBoundingClientRect().top - previewTop + preview.scrollTop,
      );
      setActiveIndex(
        activeOutlineIndexAtScroll(
          pairs.map(({ item }) => item),
          headingOffsets,
          preview.scrollTop,
        ) ??
          items[0]?.index ??
          null,
      );
    };
    // Scroll handlers set the other pane programmatically, which emits its own
    // scroll event. Ignore that echo so the two panes do not fight.
    let echo: HTMLElement | null = null;
    const follow = (source: HTMLElement, target: HTMLElement) => () => {
      if (echo === source) {
        echo = null;
        return;
      }
      const before = target.scrollTop;
      syncScrollPosition(source, target);
      if (target.scrollTop !== before) echo = target;
      syncActive();
    };
    const onPreviewScroll = follow(preview, outlineScroller);
    const onOutlineScroll = follow(outlineScroller, preview);
    syncActive();
    syncScrollPosition(preview, outlineScroller);
    preview.addEventListener("scroll", onPreviewScroll, { passive: true });
    outlineScroller.addEventListener("scroll", onOutlineScroll, {
      passive: true,
    });
    return () => {
      preview.removeEventListener("scroll", onPreviewScroll);
      outlineScroller.removeEventListener("scroll", onOutlineScroll);
    };
  }, [items]);

  const open = (item: OutlineItem) => {
    setActiveIndex(item.index);
    const preview = previewPane();
    const heading = preview && renderedHeadings(preview, [item])[0]?.heading;
    if (preview && heading) {
      scrollOutlineTargetIntoPreview(preview, heading);
      return;
    }
    onNavigate?.(item);
  };
  const renderNode = (node: OutlineNode) => (
    <div
      key={`${node.index}-${node.title}`}
      className={`outline-node level-${node.level}${node.children.length ? " has-children" : ""}${activeAncestors.has(node.index) ? " active-ancestor" : ""}`}
      style={
        {
          "--outline-indent": `${(node.level - 1) * 13}px`,
        } as React.CSSProperties
      }
    >
      <button
        type="button"
        data-outline-index={node.index}
        className={activeIndex === node.index ? "active" : ""}
        aria-current={activeIndex === node.index ? "location" : undefined}
        onClick={() => open(node)}
      >
        <span className="outline-node-marker" aria-hidden="true">
          <span className="outline-node-dot" />
        </span>
        <span className="outline-node-label">{node.title}</span>
        {activeIndex === node.index && dirty && (
          <span className="outline-unsaved" aria-label="Unsaved changes" />
        )}
      </button>
      {node.children.length > 0 && (
        <div className="outline-children">{node.children.map(renderNode)}</div>
      )}
    </div>
  );
  return (
    <aside
      ref={outline}
      className="outline"
      style={{ "--outline-pane-width": `${width}px` } as React.CSSProperties}
      aria-label="Note outline"
    >
      <header>
        <strong>Outline</strong>
        <button
          type="button"
          aria-label="Close outline"
          title="Close outline (Esc)"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {items.length ? (
        <nav className="outline-tree">{tree.map(renderNode)}</nav>
      ) : (
        <p>Add headings to create an outline.</p>
      )}
    </aside>
  );
}
