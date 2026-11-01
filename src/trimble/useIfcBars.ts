import { useCallback, useEffect, useState } from "react";
import type { IfcBarIndex } from "./annotations";
import { readIfcBars, type IfcBarGroup } from "./ifcBars";
import type { IfcWorkerRequest, IfcWorkerResponse } from "./ifcWorker";

const DB_NAME = "soi";
const STORE = "files";
const KEY = "ifc";

/** What is kept between sessions: the parsed bar positions, not the (much larger) IFC text. */
interface StoredIfc {
  name: string;
  groups?: IfcBarGroup[];
  /** Older versions stored the raw text; it is parsed once and replaced by `groups`. */
  text?: string;
}

/** IndexedDB keeps the parsed IFC across reloads; any failure just means it must be loaded again. */
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

/**
 * Parses in a Web Worker so large files don't freeze the panel. Falls back to the main thread when
 * workers are unavailable (e.g. blocked by the host page's security policy).
 */
function parseIfc(request: IfcWorkerRequest): Promise<IfcBarGroup[]> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./ifcWorker.ts", import.meta.url), { type: "module" });
  } catch {
    const text = "file" in request ? request.file.text() : Promise.resolve(request.text);
    return text.then((t) => [...readIfcBars(t).values()]);
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<IfcWorkerResponse>) => {
      worker.terminate();
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data.groups);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Reading the IFC file failed."));
    };
    worker.postMessage(request);
  });
}

const toIndex = (groups: IfcBarGroup[]): IfcBarIndex => new Map(groups.map((g) => [g.globalId, g]));

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

  const use = useCallback((name: string, groups: IfcBarGroup[]) => {
    if (!groups.length) throw new Error(`No reinforcing bars with geometry found in ${name}.`);
    setIndex(toIndex(groups));
    setFileName(name);
    setError(null);
  }, []);

  const store = (name: string, groups: IfcBarGroup[]) =>
    withStore("readwrite", (s) => s.put({ name, groups } satisfies StoredIfc, KEY));

  useEffect(() => {
    withStore<StoredIfc>("readonly", (s) => s.get(KEY)).then(async (stored) => {
      if (!stored) return;
      try {
        if (stored.groups) {
          use(stored.name, stored.groups);
        } else if (stored.text) {
          setLoading(true);
          const groups = await parseIfc({ text: stored.text });
          use(stored.name, groups);
          await store(stored.name, groups);
        }
      } catch {
        // A stored file that no longer parses is simply ignored.
      } finally {
        setLoading(false);
      }
    });
  }, [use]);

  const load = useCallback(
    (file: File) => {
      setLoading(true);
      setError(null);
      parseIfc({ file })
        .then(async (groups) => {
          use(file.name, groups);
          await store(file.name, groups);
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
