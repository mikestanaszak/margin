import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./view-layout.css";

const DIVIDER_WIDTH = 9;
const DEFAULT_RATIO = 0.5;

export type ResizableSplitProps = {
  /** Content rendered before the divider. */
  left: ReactNode;
  /** Content rendered after the divider. */
  right: ReactNode;
  /** Initial left-pane share, expressed from 0 to 1. Defaults to 0.5. */
  initialRatio?: number;
  /** Minimum left-pane width in CSS pixels. Defaults to 240. */
  minLeftWidth?: number;
  /** Minimum right-pane width in CSS pixels. Defaults to 240. */
  minRightWidth?: number;
  /** When set, the ratio is restored from and saved to localStorage. */
  persistenceKey?: string;
  /** Called after the user changes the effective ratio. */
  onRatioChange?: (ratio: number) => void;
  /** Accessible name announced for the resize handle. */
  dividerLabel?: string;
  /** Extra class applied to the component root. */
  className?: string;
  /** Extra inline styles applied to the component root. */
  style?: CSSProperties;
};

function validRatio(value: unknown, fallback = DEFAULT_RATIO) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

function readStoredRatio(key: string | undefined, fallback: number) {
  if (!key || typeof window === "undefined") return fallback;

  try {
    const stored = Number.parseFloat(window.localStorage.getItem(key) ?? "");
    return Number.isFinite(stored) ? validRatio(stored, fallback) : fallback;
  } catch {
    // localStorage can be unavailable in private or restricted browsing contexts.
    return fallback;
  }
}

/**
 * A horizontal, two-pane layout with a pointer- and keyboard-operable divider.
 */
export function ResizableSplit({
  left,
  right,
  initialRatio = DEFAULT_RATIO,
  minLeftWidth = 240,
  minRightWidth = 240,
  persistenceKey,
  onRatioChange,
  dividerLabel = "Resize left and right panes",
  className,
  style,
}: ResizableSplitProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [ratio, setRatio] = useState(() =>
    readStoredRatio(persistenceKey, validRatio(initialRatio)),
  );

  const safeMinLeft = Math.max(0, minLeftWidth);
  const safeMinRight = Math.max(0, minRightWidth);
  const paneWidth = Math.max(0, availableWidth - DIVIDER_WIDTH);

  const clampRatio = useCallback(
    (nextRatio: number) => {
      if (paneWidth <= 0) return validRatio(nextRatio);

      const minimum = Math.min(1, safeMinLeft / paneWidth);
      const maximum = Math.max(0, 1 - safeMinRight / paneWidth);

      // The root's min-width normally makes this impossible. The fallback keeps
      // the handle stable while an ancestor is temporarily measuring the layout.
      if (minimum > maximum) return safeMinLeft / (safeMinLeft + safeMinRight || 1);
      return Math.min(maximum, Math.max(minimum, validRatio(nextRatio)));
    },
    [paneWidth, safeMinLeft, safeMinRight],
  );

  const effectiveRatio = clampRatio(ratio);

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;

    const updateWidth = () => setAvailableWidth(element.getBoundingClientRect().width);
    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const commitRatio = useCallback(
    (nextRatio: number) => {
      const next = Math.round(clampRatio(nextRatio) * 1_000_000) / 1_000_000;
      setRatio(next);
      onRatioChange?.(next);

      if (persistenceKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(persistenceKey, String(next));
        } catch {
          // Resizing should continue to work when storage is unavailable.
        }
      }
    },
    [clampRatio, onRatioChange, persistenceKey],
  );

  const ratioFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds || paneWidth <= 0) return effectiveRatio;
    const leftWidth = event.clientX - bounds.left - DIVIDER_WIDTH / 2;
    return leftWidth / paneWidth;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    commitRatio(ratioFromPointer(event));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    commitRatio(ratioFromPointer(event));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    let next: number | undefined;

    if (event.key === "ArrowLeft") next = effectiveRatio - step;
    if (event.key === "ArrowRight") next = effectiveRatio + step;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = 1;
    if (next === undefined) return;

    event.preventDefault();
    commitRatio(next);
  };

  const percentage = Math.round(effectiveRatio * 100);
  const rootClassName = ["nr-resizable-split", className].filter(Boolean).join(" ");

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      style={{
        ...style,
        minWidth: safeMinLeft + safeMinRight + DIVIDER_WIDTH,
        gridTemplateColumns: `${effectiveRatio}fr ${DIVIDER_WIDTH}px ${1 - effectiveRatio}fr`,
      }}
    >
      <div
        className="nr-resizable-split__pane nr-resizable-split__pane--left"
        style={{ minWidth: safeMinLeft }}
      >
        {left}
      </div>
      <div
        className="nr-resizable-split__divider"
        role="separator"
        aria-label={dividerLabel}
        aria-orientation="vertical"
        aria-valuemin={Math.round(clampRatio(0) * 100)}
        aria-valuemax={Math.round(clampRatio(1) * 100)}
        aria-valuenow={percentage}
        aria-valuetext={`Left pane ${percentage} percent`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <span aria-hidden="true" />
      </div>
      <div
        className="nr-resizable-split__pane nr-resizable-split__pane--right"
        style={{ minWidth: safeMinRight }}
      >
        {right}
      </div>
    </div>
  );
}
