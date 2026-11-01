import { useEffect, useRef } from "react";
import type { Camera, WorkspaceAPI } from "trimble-connect-workspace-api";
import { addWorkspaceEventHandler } from "./connection";
import { toOwned } from "./markups";
import { useMarkupLayer } from "./ownedMarkups";
import { frameFromCamera, strokeLabels, type StrokeLabel, type ViewFrame } from "./valueLabels";

/** Wait for the camera to settle before re-orienting, so orbiting stays smooth. */
const CAMERA_SETTLE_MS = 300;

/**
 * Draws dimension values as strokes and keeps them readable: each time the camera stops moving, the
 * values are redrawn facing it. Only these strokes are replaced; the dimension lines stay put.
 */
export function useStrokeLabels(api: WorkspaceAPI | null, labels: StrokeLabel[], storageKey: string) {
  const layer = useMarkupLayer(api, storageKey);
  const view = useRef<ViewFrame | null>(null);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  // Redraws the current labels for the current view, after anything already queued on the layer.
  const redraw = useRef<() => void>(() => undefined);
  redraw.current = () => {
    layer
      ?.replace(async () => {
        const lines = strokeLabels(labelsRef.current, view.current);
        return lines.length ? { owned: toOwned(await layer.api.markup.addLineMarkups(lines)) } : null;
      })
      .catch((err) => console.warn("[SmartObjectInspector] value labels failed", err));
  };

  // New labels: orient them to the current camera straight away.
  useEffect(() => {
    if (!layer) return;
    let cancelled = false;
    layer.api.viewer
      .getCamera()
      .then((camera) => {
        if (!cancelled) view.current = frameFromCamera(camera) ?? view.current;
      })
      .catch(() => undefined)
      .finally(() => !cancelled && redraw.current());
    return () => {
      cancelled = true;
    };
  }, [layer, labels]);

  // Camera moved: re-orient once it settles. Nothing to do while there are no stroked values.
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = addWorkspaceEventHandler((event, payload) => {
      if (event !== "viewer.onCameraChanged" || !labelsRef.current.length) return;
      const next = frameFromCamera(payload?.data as Camera | undefined);
      if (!next) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        view.current = next;
        redraw.current();
      }, CAMERA_SETTLE_MS);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}
