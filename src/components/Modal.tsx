import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";

type Layer = { depth: number; order: number };

// Open modal layers. The topmost is the most deeply nested, then the most
// recently opened, so Escape only dismisses that one. Depth matters because a
// nested modal's effects run before its parent's.
const modalStack: Layer[] = [];
let nextOrder = 0;
const LayerDepth = createContext(0);

function topLayer() {
  return modalStack.reduce<Layer | undefined>(
    (top, layer) =>
      !top ||
      layer.depth > top.depth ||
      (layer.depth === top.depth && layer.order > top.order)
        ? layer
        : top,
    undefined,
  );
}

/** True while any modal surface is open; app shortcuts stay out of its way. */
export function isModalOpen() {
  return modalStack.length > 0;
}

/**
 * Registers an overlay as a modal layer while it is mounted. Escape calls
 * `onClose` only for the top layer, and focus returns to whatever was focused
 * before the layer opened. Returns the layer's nesting depth.
 */
export function useModalLayer(onClose?: () => void) {
  const depth = useContext(LayerDepth) + 1;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const layer = { depth, order: nextOrder++ };
    modalStack.push(layer);
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        topLayer() !== layer ||
        !onCloseRef.current
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      modalStack.splice(modalStack.indexOf(layer), 1);
      if (previouslyFocused?.isConnected)
        previouslyFocused.focus({ preventScroll: true });
    };
    // A layer's depth is fixed for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return depth;
}

type ModalProps = {
  /** Called for Escape. Omit for surfaces that require an explicit choice. */
  onClose?: () => void;
  label?: string;
  className?: string;
  backdropClassName?: string;
  /** Render the surface as a form submitted with Enter. */
  onSubmit?: () => void;
  busy?: boolean;
  children: ReactNode;
};

/**
 * Shared modal frame: backdrop, dialog semantics, Escape handling, initial
 * focus, and focus restoration.
 */
export function Modal({
  onClose,
  label,
  className = "",
  backdropClassName = "",
  onSubmit,
  busy,
  children,
}: ModalProps) {
  const surface = useRef<HTMLElement & HTMLFormElement>(null);
  const depth = useModalLayer(onClose);
  useEffect(() => {
    const element = surface.current;
    if (!element || element.contains(document.activeElement)) return;
    const first =
      element.querySelector<HTMLElement>("[autofocus]") ??
      element.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      );
    (first ?? element).focus({ preventScroll: true });
  }, []);

  const shared = {
    className: `modal ${className}`.trim(),
    role: "dialog",
    "aria-modal": true,
    "aria-label": label,
    "aria-busy": busy,
    tabIndex: -1,
  } as const;
  const content = (
    <LayerDepth.Provider value={depth}>{children}</LayerDepth.Provider>
  );
  return (
    <div className={`modal-backdrop ${backdropClassName}`.trim()}>
      {onSubmit ? (
        <form
          ref={surface}
          {...shared}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {content}
        </form>
      ) : (
        <section ref={surface} {...shared}>
          {content}
        </section>
      )}
    </div>
  );
}
