import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: vi.fn() }),
}));

const {
  hideQuickCapture,
  currentWindowHide,
  loadSelectedLibrary,
  appendQuickNote,
} = vi.hoisted(() => ({
    hideQuickCapture: vi.fn().mockResolvedValue(undefined),
    currentWindowHide: vi.fn().mockResolvedValue(undefined),
    loadSelectedLibrary: vi.fn().mockResolvedValue("C:/Notes"),
    appendQuickNote: vi.fn(),
  }));

vi.mock("./services/native", () => ({
  native: { hideQuickCapture, loadSelectedLibrary, appendQuickNote },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: currentWindowHide }),
}));

import { CaptureWindow } from "./capture";

afterEach(() => {
  vi.useRealTimers();
  hideQuickCapture.mockReset().mockResolvedValue(undefined);
  currentWindowHide.mockReset().mockResolvedValue(undefined);
  appendQuickNote.mockReset();
});

describe("standalone Quick Capture sessions", () => {
  it("ignores an old native hide rejection after focus reopens capture", async () => {
    let rejectHide: (error: unknown) => void = () => undefined;
    hideQuickCapture.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectHide = reject;
      }),
    );

    const view = render(<CaptureWindow />);
    try {
      const input = await screen.findByPlaceholderText("Start typing…");
      fireEvent.click(screen.getByRole("button", { name: "Close quick capture" }));
      expect(hideQuickCapture).toHaveBeenCalledOnce();

      fireEvent.focus(window);
      fireEvent.change(input, { target: { value: "New capture" } });
      await act(async () => {
        rejectHide(new Error("native hide unavailable"));
      });

      expect(currentWindowHide).not.toHaveBeenCalled();
      expect(input).toHaveValue("New capture");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Adds to today’s Daily note",
      );
    } finally {
      view.unmount();
    }
  });

  it("falls back to the current window when native hide fails", async () => {
    hideQuickCapture.mockRejectedValueOnce(new Error("native hide unavailable"));

    const view = render(<CaptureWindow />);
    try {
      await screen.findByPlaceholderText("Start typing…");
      fireEvent.click(screen.getByRole("button", { name: "Close quick capture" }));
      await act(async () => undefined);

      expect(currentWindowHide).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
    }
  });

  it("ignores an old save completion after hide and reopen", async () => {
    let resolveAppend: (value: unknown) => void = () => undefined;
    appendQuickNote.mockReturnValue(
      new Promise((resolve) => {
        resolveAppend = resolve;
      }),
    );

    const view = render(<CaptureWindow />);
    try {
      const input = await screen.findByPlaceholderText("Start typing…");
      vi.useFakeTimers();
      fireEvent.change(input, { target: { value: "Old capture" } });
      fireEvent.click(screen.getByRole("button", { name: "Save capture" }));
      expect(appendQuickNote).toHaveBeenCalledOnce();

      fireEvent.click(screen.getByRole("button", { name: "Close quick capture" }));
      expect(hideQuickCapture).toHaveBeenCalledOnce();
      fireEvent.focus(window);
      fireEvent.change(input, { target: { value: "New capture" } });
      expect(input).toHaveValue("New capture");

      await act(async () => {
        resolveAppend({});
      });

      expect(input).toHaveValue("New capture");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Adds to today’s Daily note",
      );
      act(() => vi.advanceTimersByTime(1000));
      expect(hideQuickCapture).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
    }
  });
});
