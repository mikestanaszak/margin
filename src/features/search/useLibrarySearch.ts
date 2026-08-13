import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "../../app/types";
import { native } from "../../services/native";

export type LibrarySearchScope = "all" | readonly string[];

export interface UseLibrarySearchOptions {
  library: string | null;
  query: string;
  source?: "notes" | "trash";
  scope: LibrarySearchScope;
}

export interface LibrarySearchState {
  results: SearchResult[];
  loading: boolean;
  error: string | null;
}

export const librarySearchErrorMessage = "Search is unavailable right now.";

export function useLibrarySearch({
  library,
  query,
  source = "notes",
  scope,
}: UseLibrarySearchOptions): LibrarySearchState {
  const [state, setState] = useState<LibrarySearchState>({
    results: [],
    loading: false,
    error: null,
  });
  const requestId = useRef(0);
  const scopeKey = scope === "all" ? "*" : scope.join("\n");

  useEffect(() => {
    const currentRequest = ++requestId.current;
    if (!library) {
      setState({ results: [], loading: false, error: null });
      return;
    }

    const allowedPaths = scope === "all" ? null : new Set(scope);
    setState({ results: [], loading: true, error: null });
    void (async () => {
      try {
        const results = await native.searchLibrary(library, query.trim(), source);
        if (requestId.current !== currentRequest) return;
        setState({
          results: allowedPaths
            ? results.filter((result) => allowedPaths.has(result.path))
            : results,
          loading: false,
          error: null,
        });
      } catch {
        if (requestId.current !== currentRequest) return;
        setState({
          results: [],
          loading: false,
          error: librarySearchErrorMessage,
        });
      }
    })();
  }, [library, query, scopeKey, source]);

  return state;
}
