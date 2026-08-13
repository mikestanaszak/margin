import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  loadSelectedLibrary.mockReset().mockResolvedValue("C:/Notes");
  appendQuickNote.mockReset();
});

describe("standalone Quick Capture sessions", () => {
  it("loads a library selected after the persistent window mounted", async () => {
    loadSelectedLibrary
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("C:/Selected Notes");
    appendQuickNote.mockResolvedValue({});

    const view = render(<CaptureWindow />);
    try {
      const input = await screen.findByPlaceholderText("Start typing…");
      await waitFor(() => expect(loadSelectedLibrary).toHaveBeenCalledOnce());

      fireEvent.focus(window);
      await waitFor(() => expect(loadSelectedLibrary).toHaveBeenCalledTimes(2));
      fireEvent.change(input, { target: { value: "First captured note" } });
      fireEvent.click(screen.getByRole("button", { name: "Save capture" }));

      await waitFor(() =>
        expect(appendQuickNote).toHaveBeenCalledWith(
          "C:/Selected Notes",
          "First captured note",
          expect.any(String),
        ),
      );
    } finally {
      view.unmount();
    }
  });

  it("uses a newly selected library after focus reopens capture", async () => {
    loadSelectedLibrary
      .mockResolvedValueOnce("C:/Library A")
      .mockResolvedValueOnce("C:/Library B");
    appendQuickNote.mockResolvedValue({});

    const view = render(<CaptureWindow />);
    try {
      const input = await screen.findByPlaceholderText("Start typing…");
      await waitFor(() => expect(loadSelectedLibrary).toHaveBeenCalledOnce());

      fireEvent.focus(window);
      await waitFor(() => expect(loadSelectedLibrary).toHaveBeenCalledTimes(2));
      fireEvent.change(input, { target: { value: "Save in the new library" } });
      fireEvent.click(screen.getByRole("button", { name: "Save capture" }));

      await waitFor(() =>
        expect(appendQuickNote).toHaveBeenCalledWith(
          "C:/Library B",
          "Save in the new library",
          expect.any(String),
        ),
      );
      expect(appendQuickNote).not.toHaveBeenCalledWith(
        "C:/Library A",
        expect.any(String),
        expect.any(String),
      );
    } finally {
      view.unmount();
    }
  });

  it("ignores a stale library response from an older capture session", async () => {
    let resolveOldLibrary: (library: string) => void = () => undefined;
    loadSelectedLibrary
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldLibrary = resolve;
        }),
      )
      .mockResolvedValueOnce("C:/Current Library");
    appendQuickNote.mockResolvedValue({});

    const view = render(<CaptureWindow />);
    try {
      const input = await screen.findByPlaceholderText("Start typing…");
      expect(loadSelectedLibrary).toHaveBeenCalledOnce();
      fireEvent.focus(window);
      await waitFor(() => expect(loadSelectedLibrary).toHaveBeenCalledTimes(2));

      await act(async () => resolveOldLibrary("C:/Old Library"));
      fireEvent.change(input, { target: { value: "Current session note" } });
      fireEvent.click(screen.getByRole("button", { name: "Save capture" }));

      await waitFor(() =>
        expect(appendQuickNote).toHaveBeenCalledWith(
          "C:/Current Library",
          "Current session note",
          expect.any(String),
        ),
      );
      expect(appendQuickNote).not.toHaveBeenCalledWith(
        "C:/Old Library",
        expect.any(String),
        expect.any(String),
      );
    } finally {
      view.unmount();
    }
  });

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
