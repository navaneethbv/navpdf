import { useId, useMemo, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";
import { downloadBytes, safeFileName } from "../../utils/download";
import { errorMessage } from "../document/use-document-edit";
import { parsePageRange } from "./page-range";
import {
  imposePages,
  type ImposeLayout,
  type SheetOrientation,
  type SheetSize,
} from "../../services/pdf/impose";

const LAYOUTS: [ImposeLayout, string][] = [
  ["2", "2 pages per sheet"],
  ["4", "4 pages per sheet"],
  ["6", "6 pages per sheet"],
  ["9", "9 pages per sheet"],
  ["16", "16 pages per sheet"],
  ["booklet", "Booklet (fold in half)"],
];

const SHEET_LABELS: [SheetSize, string][] = [
  ["letter", "Letter"],
  ["legal", "Legal"],
  ["tabloid", "Tabloid"],
  ["a4", "A4"],
  ["a3", "A3"],
];

export function ImposeDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const documentName = useWorkspace((state) => state.document?.name ?? "document.pdf");
  const pageCount = useWorkspace((state) => state.info?.pages ?? 1);
  const set = useWorkspace((state) => state.set);
  const [layout, setLayout] = useState<ImposeLayout>("4");
  const [sheet, setSheet] = useState<SheetSize>("letter");
  const [orientation, setOrientation] = useState<SheetOrientation>("auto");
  const [border, setBorder] = useState(true);
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pages = useMemo(() => {
    if (!range.trim()) return { pages: undefined, error: "" };
    try {
      return { pages: parsePageRange(range, pageCount).map((page) => page + 1), error: "" };
    } catch (cause) {
      return { pages: undefined, error: errorMessage(cause) };
    }
  }, [pageCount, range]);

  const submit = async () => {
    if (!controller?.pdf) return;
    setBusy(true);
    setError("");
    try {
      const result = await imposePages(await controller.pdf.saveDocument(), {
        layout,
        sheet,
        orientation,
        margin: 18,
        gap: 9,
        border,
        pages: pages.pages,
      });
      const base = safeFileName(documentName.replace(/\.pdf$/i, ""), "document");
      const suffix = layout === "booklet" ? "booklet" : `${layout}-up`;
      if (await downloadBytes(result.bytes, `${base}-${suffix}.pdf`)) {
        set({ status: `Saved a ${result.sheets}-sheet ${suffix} PDF` });
        onClose();
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolDialog
      title="Pages per Sheet and Booklets"
      icon={<LayoutGrid size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || pages.error}
      primaryLabel="Save PDF"
      busyLabel="Arranging…"
      primaryDisabled={Boolean(pages.error) || !controller?.pdf}
      onPrimary={() => void submit()}
    >
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-layout`}>
          Layout
        </label>
        <select
          id={`${ids}-layout`}
          className="text-input"
          value={layout}
          onChange={(event) => setLayout(event.target.value as ImposeLayout)}
        >
          {LAYOUTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="setting-title" htmlFor={`${ids}-sheet`}>
          Sheet size
        </label>
        <select
          id={`${ids}-sheet`}
          className="text-input"
          value={sheet}
          onChange={(event) => setSheet(event.target.value as SheetSize)}
        >
          {SHEET_LABELS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="setting-title" htmlFor={`${ids}-orientation`}>
          Orientation
        </label>
        <select
          id={`${ids}-orientation`}
          className="text-input"
          value={orientation}
          onChange={(event) => setOrientation(event.target.value as SheetOrientation)}
        >
          <option value="auto">Automatic</option>
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={border}
            onChange={(event) => setBorder(event.target.checked)}
          />
          <span>Draw a thin border around each page</span>
        </label>
        <label className="setting-title" htmlFor={`${ids}-range`}>
          Pages (all when empty)
        </label>
        <input
          id={`${ids}-range`}
          className="text-input"
          value={range}
          placeholder={`e.g. 1-${pageCount}`}
          onChange={(event) => setRange(event.target.value)}
        />
      </div>
      <p className="field-hint">
        {layout === "booklet"
          ? "Print the booklet on both sides, flipping on the short edge, then fold the stack in half. Blank pages are added to reach a multiple of four."
          : "Pages are scaled to fit and keep their orientation."}{" "}
        The new PDF contains page content only; comments, form fields and links stay in this
        document, which is not changed.
      </p>
    </ToolDialog>
  );
}
