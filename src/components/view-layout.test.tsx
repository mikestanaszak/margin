import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResizableSplit } from "./ResizableSplit";
import { FocusModeToggle, ViewModeControl } from "./ViewModeControl";

beforeEach(() => localStorage.clear());

describe("view controls", () => {
  it("exposes all three modes as a controlled accessible group", () => {
    const onChange = vi.fn();
    render(<ViewModeControl mode="preview" hotkeyHint="Ctrl+E" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Preview view (Ctrl+E)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Split view" }));
    expect(onChange).toHaveBeenCalledWith("split");
  });

  it("toggles focus mode and honors disabled state", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FocusModeToggle focused={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter focus mode" }));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<FocusModeToggle focused onChange={onChange} disabled />);
    expect(screen.getByRole("button", { name: "Exit focus mode" })).toBeDisabled();
  });
});

describe("resizable split view", () => {
  it("resizes from the keyboard and persists the chosen ratio", () => {
    const onRatioChange = vi.fn();
    render(
      <ResizableSplit
        left={<p>Editor</p>}
        right={<p>Preview</p>}
        initialRatio={0.4}
        persistenceKey="test.split"
        onRatioChange={onRatioChange}
      />,
    );
    const divider = screen.getByRole("separator", { name: "Resize left and right panes" });
    expect(divider).toHaveAttribute("aria-valuenow", "40");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.42);
    expect(localStorage.getItem("test.split")).toBe("0.42");
    fireEvent.keyDown(divider, { key: "ArrowLeft", shiftKey: true });
    expect(onRatioChange).toHaveBeenLastCalledWith(0.32);
  });

  it("restores a saved ratio and supports Home and End", () => {
    localStorage.setItem("test.split", "0.7");
    const onRatioChange = vi.fn();
    render(
      <ResizableSplit
        left="Editor"
        right="Preview"
        persistenceKey="test.split"
        onRatioChange={onRatioChange}
      />,
    );
    const divider = screen.getByRole("separator");
    expect(divider).toHaveAttribute("aria-valuenow", "70");
    fireEvent.keyDown(divider, { key: "Home" });
    expect(onRatioChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(divider, { key: "End" });
    expect(onRatioChange).toHaveBeenLastCalledWith(1);
  });
});
