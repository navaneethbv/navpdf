import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";

export const INITIAL_LAYOUTS = [
  "SinglePage",
  "OneColumn",
  "TwoColumnLeft",
  "TwoColumnRight",
  "TwoPageLeft",
  "TwoPageRight",
] as const;
export const INITIAL_PANELS = [
  "UseNone",
  "UseOutlines",
  "UseThumbs",
  "UseOC",
  "UseAttachments",
] as const;
export interface InitialView {
  layout: (typeof INITIAL_LAYOUTS)[number];
  panel: (typeof INITIAL_PANELS)[number];
  page: number;
  fit: "Fit" | "FitH" | "XYZ";
  zoom: number;
  displayTitle: boolean;
  rightToLeft: boolean;
}

export async function readInitialView(bytes: Uint8Array): Promise<InitialView> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const name = (dict: PDFDict, key: string) => {
    const value = dict.lookup(PDFName.of(key));
    return value instanceof PDFName ? value.decodeText() : "";
  };
  const layout = name(doc.catalog, "PageLayout");
  const panel = name(doc.catalog, "PageMode");
  let action = doc.catalog.lookup(PDFName.of("OpenAction"));
  if (action instanceof PDFDict && name(action, "S") === "GoTo")
    action = action.lookup(PDFName.of("D"));
  const target = action instanceof PDFArray ? action.get(0) : null;
  const pageIndex =
    target instanceof PDFNumber
      ? target.asNumber()
      : doc.getPages().findIndex((page) => page.ref.toString() === target?.toString());
  const type = action instanceof PDFArray ? action.get(1) : null;
  const fit = type instanceof PDFName ? type.decodeText() : "Fit";
  const zoom = action instanceof PDFArray && action.size() > 4 ? action.lookup(4) : null;
  const prefs = doc.catalog.lookup(PDFName.of("ViewerPreferences"));
  return {
    layout: INITIAL_LAYOUTS.find((value) => value === layout) ?? "SinglePage",
    panel: INITIAL_PANELS.find((value) => value === panel) ?? "UseNone",
    page: pageIndex >= 0 && pageIndex < doc.getPageCount() ? pageIndex + 1 : 1,
    fit: fit === "FitH" || fit === "XYZ" ? fit : "Fit",
    zoom: zoom instanceof PDFNumber && zoom.asNumber() > 0 ? zoom.asNumber() * 100 : 100,
    displayTitle:
      prefs instanceof PDFDict && prefs.lookup(PDFName.of("DisplayDocTitle")) === PDFBool.True,
    rightToLeft: prefs instanceof PDFDict && name(prefs, "Direction") === "R2L",
  };
}

/** Replaces only the explicitly chosen startup view; never installs an executable action. */
export async function writeInitialView(bytes: Uint8Array, view: InitialView) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (
    !INITIAL_LAYOUTS.includes(view.layout) ||
    !INITIAL_PANELS.includes(view.panel) ||
    !["Fit", "FitH", "XYZ"].includes(view.fit)
  )
    throw new Error("Choose a supported initial view.");
  if (!Number.isInteger(view.page) || view.page < 1 || view.page > doc.getPageCount())
    throw new Error("The opening page is outside the document.");
  if (!Number.isFinite(view.zoom) || view.zoom < 10 || view.zoom > 1000)
    throw new Error("Choose a zoom from 10% to 1000%.");
  doc.catalog.set(PDFName.of("PageLayout"), PDFName.of(view.layout));
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of(view.panel));
  const page = doc.getPage(view.page - 1).ref;
  const destination =
    view.fit === "XYZ"
      ? [page, "XYZ", null, null, view.zoom / 100]
      : view.fit === "FitH"
        ? [page, "FitH", null]
        : [page, "Fit"];
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.obj(destination));
  const old = doc.catalog.lookup(PDFName.of("ViewerPreferences"));
  const prefs = old instanceof PDFDict ? old : doc.context.obj({});
  prefs.set(PDFName.of("DisplayDocTitle"), view.displayTitle ? PDFBool.True : PDFBool.False);
  prefs.set(PDFName.of("Direction"), PDFName.of(view.rightToLeft ? "R2L" : "L2R"));
  doc.catalog.set(PDFName.of("ViewerPreferences"), prefs);
  return doc.save();
}
