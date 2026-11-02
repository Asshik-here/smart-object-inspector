import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectProject,
  ModelObjectIds,
  ModelSpec,
  PointPickedDetail,
  WorkspaceAPI,
} from "trimble-connect-workspace-api";
import { addWorkspaceEventHandler, connectToWorkspace, isEmbedded, type WorkspaceEventPayload } from "./connection";

export type ConnectionStatus = "standalone" | "connecting" | "connected" | "error";

export interface LoggedEvent {
  id: number;
  time: Date;
  event: string;
  data: unknown;
  /** True when the event was caused by this extension's own API call. */
  isSelf: boolean;
}

export interface WorkspaceState {
  status: ConnectionStatus;
  error: string | null;
  api: WorkspaceAPI | null;
  project: ConnectProject | null;
  models: ModelSpec[];
  selection: ModelObjectIds[];
  lastPick: PointPickedDetail | null;
  events: LoggedEvent[];
  reconnect: () => void;
  refreshModels: () => void;
  /** Reads the viewer's current selection, e.g. right after the extension changed it. */
  refreshSelection: () => Promise<void>;
}

const MAX_LOGGED_EVENTS = 50;

/** Order-independent identity of a selection, for detecting repeated identical events. */
export function selectionKey(selection: ModelObjectIds[]): string {
  return selection
    .flatMap((m) => (m.objectRuntimeIds ?? []).map((id) => `${m.modelId}:${id}`))
    .sort()
    .join(",");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function useWorkspace(): WorkspaceState {
  const embedded = isEmbedded();
  const [status, setStatus] = useState<ConnectionStatus>(embedded ? "connecting" : "standalone");
  const [error, setError] = useState<string | null>(null);
  const [api, setApi] = useState<WorkspaceAPI | null>(null);
  const [project, setProject] = useState<ConnectProject | null>(null);
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [selection, setSelection] = useState<ModelObjectIds[]>([]);
  const [lastPick, setLastPick] = useState<PointPickedDetail | null>(null);
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const [attempt, setAttempt] = useState(0);
  const eventId = useRef(0);
  const apiRef = useRef<WorkspaceAPI | null>(null);

  const refreshModels = useCallback(() => {
    const current = apiRef.current;
    if (!current) return;
    current.viewer
      .getModels("loaded")
      .then(setModels)
      .catch((err) => setError(`getModels failed: ${errorMessage(err)}`));
  }, []);

  // Event subscription lives for the component's lifetime, independent of connection attempts.
  useEffect(() => {
    return addWorkspaceEventHandler((event: string, payload: WorkspaceEventPayload) => {
      const isSelf = payload?.origin?.isSelf === true;
      // Not logged: our own markup calls echoing back, and camera moves (dozens per second while
      // orbiting) — each log entry re-renders the panel.
      const noisy = event === "viewer.onCameraChanged" || (isSelf && event === "viewer.onMarkupChanged");
      if (!noisy) {
        setEvents((prev) =>
          [{ id: ++eventId.current, time: new Date(), event, data: payload?.data, isSelf }, ...prev].slice(
            0,
            MAX_LOGGED_EVENTS,
          ),
        );
      }
      switch (event) {
        case "viewer.onSelectionChanged": {
          // Includes selections the extension made itself (ticks in the search): they are the
          // panel's selection too. Repeats of an identical selection are dropped just below.
          const next = (payload?.data as ModelObjectIds[] | undefined) ?? [];
          // The viewer re-sends the same selection (e.g. after markups are added). Keeping the
          // previous array when nothing changed stops that echo from triggering a redraw loop.
          setSelection((prev) => (selectionKey(prev) === selectionKey(next) ? prev : next));
          break;
        }
        case "viewer.onPicked":
          setLastPick((payload?.data as PointPickedDetail | undefined) ?? null);
          break;
        case "viewer.onModelStateChanged":
        case "viewer.onModelReset":
          refreshModels();
          break;
        case "project.onChanged":
          setProject(((payload?.data as { new?: ConnectProject } | undefined)?.new) ?? null);
          break;
      }
    });
  }, [refreshModels]);

  useEffect(() => {
    if (!embedded) return;
    let cancelled = false;
    setStatus("connecting");
    setError(null);

    connectToWorkspace()
      .then(async (workspace) => {
        if (cancelled) return;
        apiRef.current = workspace;
        setApi(workspace);
        setStatus("connected");

        const [projectResult, modelsResult, selectionResult] = await Promise.allSettled([
          workspace.project.getProject(),
          workspace.viewer.getModels("loaded"),
          workspace.viewer.getSelection(),
        ]);
        if (cancelled) return;
        if (projectResult.status === "fulfilled") setProject(projectResult.value);
        if (modelsResult.status === "fulfilled") setModels(modelsResult.value);
        if (selectionResult.status === "fulfilled") setSelection(selectionResult.value ?? []);

        const failures = [projectResult, modelsResult, selectionResult]
          .filter((r): r is PromiseRejectedResult => r.status === "rejected")
          .map((r) => errorMessage(r.reason));
        if (failures.length) setError(failures.join(" · "));
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(errorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [embedded, attempt]);

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  const refreshSelection = useCallback(async () => {
    const current = apiRef.current;
    if (!current) return;
    const next = (await current.viewer.getSelection()) ?? [];
    setSelection((prev) => (selectionKey(prev) === selectionKey(next) ? prev : next));
  }, []);

  return {
    status,
    error,
    api,
    project,
    models,
    selection,
    lastPick,
    events,
    reconnect,
    refreshModels,
    refreshSelection,
  };
}
