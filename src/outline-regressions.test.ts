import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: vi.fn() }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "test", hide: vi.fn() }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(() => Promise.resolve()),
}));

import {
  activeOutlineAncestors,
  activeOutlineIndexAtScroll,
  outlineTree,
  scrollProgress,
  scrollOutlineTargetIntoPreview,
  scrollTopForProgress,
  syncScrollPosition,
} from "./features/preview/Outline";

const headings = [
  { index: 0, level: 1, title: "Project plan" },
  { index: 1, level: 2, title: "Goals" },
  { index: 2, level: 3, title: "This week" },
  { index: 3, level: 2, title: "Tasks" },
  { index: 4, level: 3, title: "Launch" },
  { index: 5, level: 1, title: "Appendix" },
];

describe("outline active-section hierarchy", () => {
  it("keeps only the current heading's ancestors highlighted", () => {
    expect([...activeOutlineAncestors(headings, 4)]).toEqual([3, 0]);
    expect([...activeOutlineAncestors(headings, 5)]).toEqual([]);
  });

  it("starts a fresh branch when a heading level returns to an earlier level", () => {
    const tree = outlineTree(headings);

    expect(tree.map(node => node.title)).toEqual(["Project plan", "Appendix"]);
    expect(tree[0].children.map(node => node.title)).toEqual(["Goals", "Tasks"]);
    expect(tree[0].children[0].children.map(node => node.title)).toEqual(["This week"]);
    expect(tree[0].children[1].children.map(node => node.title)).toEqual(["Launch"]);
  });

  it("maps the preview and outline scroll positions proportionally", () => {
    expect(scrollProgress(150, 800, 200)).toBe(0.25);
    expect(scrollProgress(0, 200, 200)).toBe(0);
    expect(scrollTopForProgress(0.5, 900, 300)).toBe(300);
    expect(scrollTopForProgress(0.8, 300, 300)).toBe(0);
  });

  it("uses the reading offset to select the active outline heading", () => {
    expect(activeOutlineIndexAtScroll(headings, [0, 140, 320, 500, 680, 860], 250)).toBe(2);
    expect(activeOutlineIndexAtScroll(headings, [0, 140, 320, 500, 680, 860], 450)).toBe(3);
  });

  it("keeps both panes synchronized for a long note with many headings", () => {
    const preview = { scrollTop: 1_500, scrollHeight: 2_400, clientHeight: 400 } as HTMLElement;
    const outline = { scrollTop: 0, scrollHeight: 1_680, clientHeight: 280 } as HTMLElement;

    expect(syncScrollPosition(preview, outline)).toBe(1_050);
    expect(outline.scrollTop).toBe(1_050);

    outline.scrollTop = 280;
    expect(syncScrollPosition(outline, preview)).toBe(400);
    expect(preview.scrollTop).toBe(400);
  });

  it("moves a long preview to the selected late heading", () => {
    const preview = {
      scrollTop: 0,
      scrollHeight: 4_000,
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 0 }),
    } as HTMLElement;
    const heading = { getBoundingClientRect: () => ({ top: 3_800 }) } as HTMLElement;

    expect(scrollOutlineTargetIntoPreview(preview, heading)).toBe(3_600);
    expect(preview.scrollTop).toBe(3_600);
  });

  it("calculates the target from the preview's scrollable coordinate space", () => {
    const preview = {
      scrollTop: 100,
      scrollHeight: 4_000,
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 120 }),
    } as HTMLElement;
    const heading = {
      getBoundingClientRect: () => ({ top: 2_000 }),
    } as HTMLElement;

    expect(scrollOutlineTargetIntoPreview(preview, heading)).toBe(1_904);
    expect(preview.scrollTop).toBe(1_904);
  });
});
