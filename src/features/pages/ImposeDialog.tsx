import { useEffect, useId, useMemo, useRef, useState } from "react";
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

import { posterPages } from "../../services/pdf/poster";

type Layout = ImposeLayout | "poster";
const LAYOUTS: [Layout, string][] = [
  ["2", "2 pages per sheet"],
  ["4", "4 pages per sheet"],
  ["6", "6 pages per sheet"],
  ["9", "9 pages per sheet"],
  ["16", "16 pages per sheet"],
  ["booklet", "Booklet (fold in half)"],
  ["poster", "Poster (tile across sheets)"],
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
  const [layout, setLayout] = useState<Layout>("4");
  const [sheet, setSheet] = useState<SheetSize>("letter");
  const [orientation, setOrientation] = useState<SheetOrientation>("auto");
  const [border, setBorder] = useState(true);
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(100);
  const [overlap, setOverlap] = useState(18);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
      const source = controller.pdf;
      controller.editor?.commitOrRemove();
      const bytes = await source.saveDocument();
      if (!mounted.current || controller.pdf !== source) return;
      const result =
        layout === "poster"
          ? await posterPages(bytes, {
              sheet,
              landscape: orientation === "landscape",
              scale: scale / 100,
              margin: 18,
              overlap,
              pages: pages.pages,
            })
          : await imposePages(bytes, {
              layout,
              sheet,
              orientation,
              margin: 18,
              gap: 9,
              border,
              pages: pages.pages,
            });
      if (!mounted.current || controller.pdf !== source) return;
      const base = safeFileName(documentName.replace(/\.pdf$/i, ""), "document");
      const suffix =
        layout === "poster" ? "poster" : layout === "booklet" ? "booklet" : `${layout}-up`;
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
      title="Pages per Sheet, Booklets and Posters"
      icon={<LayoutGrid size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || pages.error}
      primaryLabel="Save PDF"
      busyLabel="Arranging…"
      primaryDisabled={
        Boolean(pages.error) ||
        !controller?.pdf ||
        (layout === "poster" &&
          (!Number.isFinite(scale) ||
            scale < 10 ||
            scale > 1000 ||
            !Number.isFinite(overlap) ||
            overlap < 0))
      }
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
          onChange={(event) => setLayout(event.target.value as Layout)}
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
        {layout === "poster" && (
          <>
            <label className="setting-title" htmlFor={`${ids}-scale`}>
              Poster scale (%)
            </label>
            <input
              id={`${ids}-scale`}
              className="text-input"
              type="number"
              min="10"
              max="1000"
              step="any"
              value={scale}
              onChange={(event) => setScale(event.target.valueAsNumber)}
            />
            <label className="setting-title" htmlFor={`${ids}-overlap`}>
              Tile overlap (points)
            </label>
            <input
              id={`${ids}-overlap`}
              className="text-input"
              type="number"
              min="0"
              step="any"
              value={overlap}
              onChange={(event) => setOverlap(event.target.valueAsNumber)}
            />
          </>
        )}
        <label className="checkbox-row">
          <input
            type="checkbox"
            disabled={layout === "poster"}
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
        {layout === "poster"
          ? "Sheets run left to right, top to bottom. Print at actual size (100%) and join overlapping edges. Automatic orientation uses portrait sheets. Blank margins are 18 points."
          : layout === "booklet"
            ? "Print the booklet on both sides, flipping on the short edge, then fold the stack in half. Blank pages are added to reach a multiple of four."
            : "Pages are scaled to fit and keep their orientation."}{" "}
        The new PDF contains page content only; comments, form fields and links stay in this
        document, which is not changed.
      </p>
    </ToolDialog>
  );
}
