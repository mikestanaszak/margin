import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { isModalOpen, Modal } from "./Modal";

function Stack({ onOuterClose }: { onOuterClose: () => void }) {
  const [innerOpen, setInnerOpen] = useState(true);
  return (
    <Modal label="Outer" onClose={onOuterClose}>
      <button>Outer action</button>
      {innerOpen && (
        <Modal label="Inner" onClose={() => setInnerOpen(false)}>
          <input aria-label="Inner field" />
        </Modal>
      )}
    </Modal>
  );
}

describe("Modal", () => {
  it("lets Escape dismiss only the topmost modal", () => {
    const onOuterClose = vi.fn();
    render(<Stack onOuterClose={onOuterClose} />);
    expect(screen.getByLabelText("Inner field")).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Inner" })).toBeNull();
    expect(onOuterClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOuterClose).toHaveBeenCalledTimes(1);
  });

  it("keeps required-choice dialogs open and restores focus on close", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <Modal label="Choose">
        <button>Keep</button>
      </Modal>,
    );
    expect(isModalOpen()).toBe(true);
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Choose" })).toBeInTheDocument();

    unmount();
    expect(isModalOpen()).toBe(false);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
