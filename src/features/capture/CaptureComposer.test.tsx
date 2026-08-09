import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CaptureComposer,
  type CaptureComposerProps,
} from "./CaptureComposer";

const defaultProps = {
  shortcut: "Ctrl+Alt+Shift+Space",
  status: "Adds to today’s Daily note",
  disabled: false,
  onClose: vi.fn(),
};

function enterCapture(text: string) {
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Save capture" }));
  return input;
}

describe("CaptureComposer save results", () => {
  it("retains the draft when a save returns false", async () => {
    const unsuccessfulSave = vi.fn().mockResolvedValue(false);
    render(<CaptureComposer {...defaultProps} onSave={unsuccessfulSave} />);

    const input = enterCapture("Keep this for later");

    await waitFor(() => expect(unsuccessfulSave).toHaveBeenCalledOnce());
    expect(input).toHaveValue("Keep this for later");
  });

  it("retains the draft when a save does not report success", async () => {
    const legacyNonSuccess = vi.fn().mockResolvedValue(undefined) as unknown as
      CaptureComposerProps["onSave"];
    render(<CaptureComposer {...defaultProps} onSave={legacyNonSuccess} />);

    const input = enterCapture("Keep this thought");

    await waitFor(() => expect(legacyNonSuccess).toHaveBeenCalledOnce());
    expect(input).toHaveValue("Keep this thought");
  });

  it("retains the draft when a save rejects", async () => {
    const rejectedSave = vi.fn().mockRejectedValue(new Error("disk unavailable"));
    render(<CaptureComposer {...defaultProps} onSave={rejectedSave} />);

    const input = enterCapture("Try this again");

    await waitFor(() => expect(rejectedSave).toHaveBeenCalledOnce());
    expect(input).toHaveValue("Try this again");
  });

  it("clears the draft only when a save succeeds", async () => {
    const successfulSave = vi.fn().mockResolvedValue(true);
    render(<CaptureComposer {...defaultProps} onSave={successfulSave} />);

    const input = enterCapture("Ship this thought");

    await waitFor(() => expect(input).toHaveValue(""));
  });
});
