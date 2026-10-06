import type { ComponentType } from "react";
import type { ViewerController } from "../viewer/controller";
import { StampDialog } from "../annotations/StampDialog";
import { FlattenDialog } from "../document/FlattenDialog";

export interface DocumentToolProps {
  controller: ViewerController | null;
  onClose: () => void;
}

/** Document tools opened as modals, keyed by their `activeModal` and menu identifiers. */
export const DOCUMENT_TOOL_DIALOGS: Readonly<Record<string, ComponentType<DocumentToolProps>>> = {
  stamp: StampDialog,
  flatten: FlattenDialog,
};
