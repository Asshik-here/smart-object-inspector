/**
 * Reads an IFC file off the main thread, so a large model doesn't freeze the panel.
 * Receives a File (or text) and replies with the bar groups, or an error message.
 */
import { readIfcBars, type IfcBarGroup } from "./ifcBars";

export type IfcWorkerRequest = { file: File } | { text: string };
export type IfcWorkerResponse = { groups: IfcBarGroup[] } | { error: string };

/** The dedicated worker scope; the project compiles against DOM types, where `self` is a Window. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<IfcWorkerRequest>) => void) | null;
  postMessage: (message: IfcWorkerResponse) => void;
};

scope.onmessage = async (event) => {
  try {
    const text = "file" in event.data ? await event.data.file.text() : event.data.text;
    scope.postMessage({ groups: [...readIfcBars(text).values()] });
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
