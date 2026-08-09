import { useEffect, useState } from "react";

let nextDiagramId = 0;
let mermaidModulePromise: Promise<typeof import("mermaid")> | undefined;
let renderQueue: Promise<void> = Promise.resolve();

type MermaidTheme = "default" | "dark";

function effectiveMermaidTheme(): MermaidTheme {
  const preference = document.documentElement.dataset.theme;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return preference === "dark" || (preference !== "light" && prefersDark)
    ? "dark"
    : "default";
}

function useMermaidTheme() {
  const [theme, setTheme] = useState<MermaidTheme>(effectiveMermaidTheme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setTheme(effectiveMermaidTheme());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    media.addEventListener("change", updateTheme);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", updateTheme);
    };
  }, []);

  return theme;
}

function loadMermaid() {
  if (!mermaidModulePromise)
    mermaidModulePromise = import("mermaid").catch((error) => {
      mermaidModulePromise = undefined;
      throw error;
    });
  return mermaidModulePromise;
}

function queueRender(work: () => Promise<string | undefined>) {
  const result = renderQueue.then(work);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export default function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const theme = useMermaidTheme();

  useEffect(() => {
    let active = true;
    const id = `margin-mermaid-${nextDiagramId++}`;
    setSvg(null);
    setFailed(false);

    void loadMermaid()
      .then(({ default: mermaid }) =>
        queueRender(async () => {
          if (!active) return undefined;
          mermaid.initialize({
            securityLevel: "strict",
            startOnLoad: false,
            suppressErrorRendering: true,
            theme,
          });
          const result = await mermaid.render(id, source);
          return result.svg;
        }),
      )
      .then((renderedSvg) => {
        if (active && renderedSvg) setSvg(renderedSvg);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [source, theme]);

  if (failed)
    return (
      <div
        className="mermaid-fallback"
        aria-label="Mermaid diagram could not be rendered"
      >
        <p>Could not render Mermaid diagram.</p>
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
      </div>
    );

  if (!svg)
    return (
      <pre>
        <code className="language-mermaid">{source}</code>
      </pre>
    );

  return (
    <figure
      className="mermaid-diagram"
      role="img"
      aria-label="Mermaid diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
