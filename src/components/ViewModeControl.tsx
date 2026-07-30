import type { ReactNode } from "react";
import "./view-layout.css";

export type ViewMode = "edit" | "split" | "preview";

export type ViewModeControlProps = {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Shortcut shown alongside Preview, such as "Ctrl+E" or "⌘E". */
  hotkeyHint?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
};

const modes: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: "edit", label: "Edit" },
  { value: "split", label: "Split" },
  { value: "preview", label: "Preview" },
];

/** A controlled, accessible three-way view selector. */
export function ViewModeControl({
  mode,
  onChange,
  hotkeyHint,
  ariaLabel = "View mode",
  disabled = false,
  className,
}: ViewModeControlProps) {
  const rootClassName = ["nr-view-mode", className].filter(Boolean).join(" ");

  return (
    <div className={rootClassName} role="group" aria-label={ariaLabel}>
      {modes.map((item) => {
        const isCurrent = mode === item.value;
        const shortcut = item.value === "preview" ? hotkeyHint : undefined;

        return (
          <button
            key={item.value}
            type="button"
            className="nr-view-mode__button"
            aria-label={`${item.label} view${shortcut ? ` (${shortcut})` : ""}`}
            aria-pressed={isCurrent}
            disabled={disabled}
            onClick={() => onChange(item.value)}
          >
            <span>{item.label}</span>
            {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

export type FocusModeToggleProps = {
  focused: boolean;
  onChange: (focused: boolean) => void;
  hotkeyHint?: string;
  /** Optional icon rendered before the visible label. */
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/** An optional companion control for entering and leaving a distraction-free view. */
export function FocusModeToggle({
  focused,
  onChange,
  hotkeyHint,
  icon,
  disabled = false,
  className,
}: FocusModeToggleProps) {
  const action = focused ? "Exit focus mode" : "Enter focus mode";
  const buttonClassName = ["nr-focus-mode", className].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={buttonClassName}
      aria-label={`${action}${hotkeyHint ? ` (${hotkeyHint})` : ""}`}
      aria-pressed={focused}
      disabled={disabled}
      onClick={() => onChange(!focused)}
    >
      {icon && <span className="nr-focus-mode__icon" aria-hidden="true">{icon}</span>}
      <span>{focused ? "Exit focus" : "Focus"}</span>
      {hotkeyHint && <kbd aria-hidden="true">{hotkeyHint}</kbd>}
    </button>
  );
}
