import { useEffect, useRef, useState } from "react";
import type { NoteSummary } from "../../app/types";
import { native } from "../../services/native";

export type LibrarySearchScope = "all" | readonly string[];

export interface UseLibrarySearchOptions {
  library: string | null;
  query: string;
  scope: LibrarySearchScope;
}

export interface LibrarySearchState {
  results: NoteSummary[];
  loading: boolean;
}

export function useLibrarySearch({
  library,
  query,
  scope,
}: UseLibrarySearchOptions): LibrarySearchState {
  const [state, setState] = useState<LibrarySearchState>({
    results: [],
    loading: false,
  });
  const requestId = useRef(0);
  const scopeKey = scope === "all" ? "*" : scope.join("\n");

  useEffect(() => {
    const currentRequest = ++requestId.current;
    if (!library) {
      setState({ results: [], loading: false });
      return;
    }

    const allowedPaths = scope === "all" ? null : new Set(scope);
    setState((current) => ({ ...current, loading: true }));
    void native
      .searchLibrary(library, query.trim())
      .then((results) => {
        if (requestId.current !== currentRequest) return;
        setState({
          results: allowedPaths
            ? results.filter((result) => allowedPaths.has(result.path))
            : results,
          loading: false,
        });
      })
      .catch(() => {
        if (requestId.current !== currentRequest) return;
        setState({ results: [], loading: false });
      });
  }, [library, query, scopeKey]);

  return state;
}
