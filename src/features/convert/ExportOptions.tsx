import { Download } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { useWorkspace } from "../../stores/workspace";
export function ExportOptions() {
  const set = useWorkspace((s) => s.set);
  return (
    <Dialog
      title="Export a PDF"
      icon={<Download size={18} />}
      onClose={() => {
        set({ activeModal: null });
      }}
    >
      <p>
        Choose an editable document, page images, PostScript or plain text. Save As keeps a PDF
        copy.
      </p>
      <div className="export-options">
        <button className="button" onClick={() => set({ activeModal: "office-export" })}>
          Word, Excel, PowerPoint, Rich Text, HTML, CSV or XML
        </button>
        <button className="button" onClick={() => set({ activeModal: "convert" })}>
          PNG, JPEG, TIFF, PostScript, EPS or plain text
        </button>
        <button className="button" onClick={() => set({ activeModal: "compress" })}>
          Compressed PDF copy
        </button>
      </div>
    </Dialog>
  );
}
