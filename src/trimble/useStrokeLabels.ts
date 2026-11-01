import { useEffect, useRef } from "react";
import type { Camera, WorkspaceAPI } from "trimble-connect-workspace-api";
import { clearAnnotations, markupSignature } from "./annotations";
import { addWorkspaceEventHandler } from "./connection";
import { removeLeftovers, saveOwned } from "./ownedMarkups";
import { frameFromCamera, strokeLabels, type StrokeLabel, type ViewFrame } from "./valueLabels";

/** Wait for the camera to settle before re-orienting, so orbiting stays smooth. */
const CAMERA_SETTLE_MS = 300;

/**
 * Draws dimension values as strokes and keeps them readable: each time the camera stops moving, the
 * values are redrawn facing it. Only these strokes are replaced; the dimension lines stay put.
 */
export function useStrokeLabels(api: WorkspaceAPI | null, labels: StrokeLabel[], storageKey: string) {
  const ownedIds = useRef<number[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const view = useRef<ViewFrame | null>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    if (!api) return;
    queue.current = queue.current.then(() => removeLeftovers(api, storageKey).catch(() => undefined));
  }, [api, storageKey]);

  // Redraw the current labels for the current view, after anything already queued.
  const redraw = useRef<(() => void) | null>(null);
  redraw.current = () => {
    if (!api) return;
    queue.current = queue.current.then(async () => {
      const previous = ownedIds.current;
      ownedIds.current = [];
      try {
        await clearAnnotations(api, previous);
        saveOwned(storageKey, []);
        const lines = strokeLabels(labelsRef.current, view.current);
        if (!lines.length) return;
        const added = await api.markup.addLineMarkups(lines);
        const owned = added
          .filter((m) => m.id !== undefined)
          .map((m) => ({ id: m.id as number, signature: markupSignature(m) }));
        ownedIds.current = owned.map((o) => o.id);
        saveOwned(storageKey, owned);
      } catch (err) {
        console.warn("[SmartObjectInspector] value labels failed", err);
      }
    });
  };

  // New labels: orient them to the current camera straight away.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api.viewer
      .getCamera()
      .then((camera) => {
        if (!cancelled) view.current = frameFromCamera(camera) ?? view.current;
      })
      .catch(() => undefined)
      .finally(() => !cancelled && redraw.current?.());
    return () => {
      cancelled = true;
    };
  }, [api, labels]);

  // Camera moved: re-orient once it settles.
  useEffect(() => {
    if (!api) return;
    let timer: number | undefined;
    const unsubscribe = addWorkspaceEventHandler((event, payload) => {
      if (event !== "viewer.onCameraChanged" || !labelsRef.current.length) return;
      const next = frameFromCamera(payload?.data as Camera | undefined);
      if (!next) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        view.current = next;
        redraw.current?.();
      }, CAMERA_SETTLE_MS);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [api]);

  // Remove the strokes when the extension closes or the component unmounts.
  useEffect(() => {
    if (!api) return;
    const cleanup = () => {
      const ids = ownedIds.current;
      ownedIds.current = [];
      clearAnnotations(api, ids)
        .then(() => saveOwned(storageKey, []))
        .catch(() => undefined);
    };
    const unsubscribe = addWorkspaceEventHandler((event) => {
      if (event === "extension.closing") cleanup();
    });
    return () => {
      unsubscribe();
      cleanup();
    };
  }, [api, storageKey]);
}
