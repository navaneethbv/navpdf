import { useState } from "react";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";

export const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The operation could not be completed.";

/**
 * Applies a byte-level edit to the open document with undo history. The edit is discarded if
 * another document was opened meanwhile, and failures stay in the dialog for a retry.
 */
export function useDocumentEdit(controller: ViewerController | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = useWorkspace((state) => state.set);

  const apply = async (
    status: string,
    edit: (bytes: Uint8Array) => Promise<Uint8Array>,
  ): Promise<boolean> => {
    const source = controller?.pdf;
    if (!controller || !source || busy) return false;
    setBusy(true);
    setError("");
    try {
      const bytes = await source.saveDocument();
      const changed = await edit(bytes);
      await controller.replaceWithBytes(changed, status, {
        expectedSource: source,
        preMutationBytes: bytes,
      });
      set({ status });
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { apply, busy, error, setError };
}
