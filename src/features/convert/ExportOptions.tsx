import { Dialog } from "../../components/Dialog";
import { useWorkspace } from "../../stores/workspace";
export function ExportOptions() {
  const set = useWorkspace((s) => s.set);
  return (
    <Dialog title="Export a PDF" onClose={() => set({ activeModal: null })}>
      <p>
        Choose an editable Office document, page images, or plain text. Save As keeps a PDF copy.
      </p>
      <div className="export-options">
        <button className="button" onClick={() => set({ activeModal: "office-export" })}>
          Word, PowerPoint, Excel or Rich Text
        </button>
        <button className="button" onClick={() => set({ activeModal: "convert" })}>
          PNG, JPEG or plain text
        </button>
        <button className="button" onClick={() => set({ activeModal: "compress" })}>
          Compressed PDF copy
        </button>
      </div>
    </Dialog>
  );
}
