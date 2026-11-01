import { useCallback, useEffect, useState } from "react";
import type { IfcBarIndex } from "./annotations";
import { readIfcBars } from "./ifcBars";

const DB_NAME = "soi";
const STORE = "files";
const KEY = "ifc";

interface StoredIfc {
  name: string;
  text: string;
}

/** IndexedDB keeps the loaded IFC across reloads; any failure just means it must be loaded again. */
function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        try {
          const request = run(open.result.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      };
    } catch {
      resolve(undefined);
    }
  });
}

export interface IfcBarsState {
  index: IfcBarIndex | null;
  fileName: string | null;
  /** Bar groups found in the file. */
  groupCount: number;
  loading: boolean;
  error: string | null;
  load: (file: File) => void;
  clear: () => void;
}

/** The model's IFC file, loaded once by the user, read for exact per-bar positions. */
export function useIfcBars(): IfcBarsState {
  const [index, setIndex] = useState<IfcBarIndex | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const use = useCallback((name: string, text: string) => {
    const groups = readIfcBars(text);
    if (!groups.size) throw new Error(`No reinforcing bars with geometry found in ${name}.`);
    setIndex(groups);
    setFileName(name);
    setError(null);
  }, []);

  useEffect(() => {
    withStore<StoredIfc>("readonly", (s) => s.get(KEY)).then((stored) => {
      if (!stored) return;
      try {
        use(stored.name, stored.text);
      } catch {
        // A stored file that no longer parses is simply ignored.
      }
    });
  }, [use]);

  const load = useCallback(
    (file: File) => {
      setLoading(true);
      file
        .text()
        .then((text) => {
          use(file.name, text);
          return withStore("readwrite", (s) => s.put({ name: file.name, text } satisfies StoredIfc, KEY));
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    },
    [use],
  );

  const clear = useCallback(() => {
    setIndex(null);
    setFileName(null);
    withStore("readwrite", (s) => s.delete(KEY));
  }, []);

  return { index, fileName, groupCount: index?.size ?? 0, loading, error, load, clear };
}
