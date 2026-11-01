import { connect, type WorkspaceAPI, type WorkspaceEventCallback } from "trimble-connect-workspace-api";

/** Payload shape shared by every Workspace API event (see EventArgument in the package typings). */
export interface WorkspaceEventPayload {
  data?: unknown;
  action?: string;
  /** Set by the host when the event was caused by this client's own API call. */
  origin?: { isSelf?: boolean };
}

export type WorkspaceEventHandler = (event: string, payload: WorkspaceEventPayload) => void;

const CONNECT_TIMEOUT_MS = 30_000;

const handlers = new Set<WorkspaceEventHandler>();
let connection: Promise<WorkspaceAPI> | null = null;

/** True when the page is hosted inside another window (Trimble Connect loads extensions in an iframe). */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top throws, which itself means we are framed.
    return true;
  }
}

function dispatch(event: string, payload: WorkspaceEventPayload) {
  handlers.forEach((handler) => {
    try {
      handler(event, payload);
    } catch (err) {
      console.error(`[SmartObjectInspector] handler failed for ${event}`, err);
    }
  });
}

/**
 * Connects to the hosting Trimble Connect window exactly once.
 * The Workspace API only accepts a single event callback per connection, so events
 * are fanned out to listeners registered with {@link addWorkspaceEventHandler}.
 */
export function connectToWorkspace(): Promise<WorkspaceAPI> {
  if (!connection) {
    connection = connect(window.parent, dispatch as unknown as WorkspaceEventCallback, CONNECT_TIMEOUT_MS).catch(
      (err: unknown) => {
        connection = null;
        throw err;
      },
    );
  }
  return connection;
}

/** Registers an event listener; returns a function that removes it. */
export function addWorkspaceEventHandler(handler: WorkspaceEventHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
