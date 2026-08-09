import "./view-layout.css";

type ViewMode = "edit" | "split" | "preview";

type ViewModeControlProps = {
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
