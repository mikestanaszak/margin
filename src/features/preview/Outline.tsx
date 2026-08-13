import React, { useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "../../note-utils";

export type OutlineItem = { index: number; level: number; title: string };
type OutlineNode = OutlineItem & { children: OutlineNode[] };

export function extractOutlineItems(body: string): OutlineItem[] {
  return [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match, index) => ({
    index,
    level: match[1].length,
    title: match[2].trim(),
  }));
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
type PreviewScrollablePane = ScrollablePane & Pick<HTMLElement, "getBoundingClientRect">;
export function syncScrollPosition(source: ScrollablePane, target: ScrollablePane) {
  const next = scrollTopForProgress(
    scrollProgress(source.scrollTop, source.scrollHeight, source.clientHeight),
    target.scrollHeight,
    target.clientHeight,
  );
  if (Math.abs(target.scrollTop - next) > 1) target.scrollTop = next;
  return next;
}
export function scrollOutlineTargetIntoPreview(preview: PreviewScrollablePane, heading: HTMLElement) {
  const next = clamp(
    preview.scrollTop + heading.getBoundingClientRect().top - preview.getBoundingClientRect().top - 76,
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

export function Outline({
  items,
  dirty,
  width = 280,
  onClose,
}: {
  items: OutlineItem[];
  dirty: boolean;
  width?: number;
  onClose: () => void;
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
    setActiveIndex(items[0]?.index ?? null);
  }, [items]);
  useEffect(() => {
    const preview = document.querySelector<HTMLElement>(
      ".note-content .preview",
    );
    const outlineScroller = outline.current;
    if (!preview || !outlineScroller) return;
    const headings = () => [
      ...preview.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
    ];
    const syncActive = () => {
      const previewTop = preview.getBoundingClientRect().top;
      const headingOffsets = headings().map(
        (heading) =>
          heading.getBoundingClientRect().top - previewTop + preview.scrollTop,
      );
      setActiveIndex(
        activeOutlineIndexAtScroll(items, headingOffsets, preview.scrollTop),
      );
    };
    const syncOutline = () => {
      syncScrollPosition(preview, outlineScroller);
    };
    const syncPreview = () => {
      syncScrollPosition(outlineScroller, preview);
    };
    let lastPreviewScrollTop = preview.scrollTop;
    let lastOutlineScrollTop = outlineScroller.scrollTop;
    const onPreviewScroll = () => {
      syncActive();
      syncOutline();
      lastPreviewScrollTop = preview.scrollTop;
      lastOutlineScrollTop = outlineScroller.scrollTop;
    };
    const onOutlineScroll = () => {
      syncPreview();
      syncActive();
      syncOutline();
      lastPreviewScrollTop = preview.scrollTop;
      lastOutlineScrollTop = outlineScroller.scrollTop;
    };
    let frame = 0;
    const reconcileScrollPositions = () => {
      if (Math.abs(preview.scrollTop - lastPreviewScrollTop) > 1)
        onPreviewScroll();
      else if (Math.abs(outlineScroller.scrollTop - lastOutlineScrollTop) > 1)
        onOutlineScroll();
      frame = window.requestAnimationFrame(reconcileScrollPositions);
    };
    syncActive();
    syncOutline();
    preview.addEventListener("scroll", onPreviewScroll, { passive: true });
    outlineScroller.addEventListener("scroll", onOutlineScroll, {
      passive: true,
    });
    frame = window.requestAnimationFrame(reconcileScrollPositions);
    return () => {
      window.cancelAnimationFrame(frame);
      preview.removeEventListener("scroll", onPreviewScroll);
      outlineScroller.removeEventListener("scroll", onOutlineScroll);
    };
  }, [items]);

  const open = (item: OutlineItem) => {
    setActiveIndex(item.index);
    const preview = document.querySelector<HTMLElement>(".note-content .preview");
    const heading = document.querySelectorAll<HTMLElement>(
      ".note-content .preview h1, .note-content .preview h2, .note-content .preview h3, .note-content .preview h4, .note-content .preview h5, .note-content .preview h6",
    )[item.index];
    if (preview && heading) {
      scrollOutlineTargetIntoPreview(preview, heading);
      preview.dispatchEvent(new Event("scroll"));
      return;
    }
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
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
