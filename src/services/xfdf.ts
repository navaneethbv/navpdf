import { pdfText } from "./pdf/text-string.ts";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  PDFHexString,
} from "pdf-lib";

const MAX_XFDF_BYTES = 10 * 1024 * 1024;
const xmlEscape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const xmlUnescape = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
const attrs = (source: string) => {
  const values = new Map<string, string>();
  for (const match of source.matchAll(/(?:^|\s)([A-Za-z][\w:-]*)\s*=\s*"([^"]*)"/g))
    values.set(match[1], xmlUnescape(match[2]));
  return values;
};
const numbers = (value: string | undefined) =>
  value
    ?.trim()
    .split(/[\s,]+/)
    .map(Number) ?? [];

function annotationTag(subtype: string) {
  return subtype === "StrikeOut" ? "strikeout" : subtype.toLowerCase();
}

const EXPORTABLE_SUBTYPES = ["Text", "Highlight", "Underline", "StrikeOut", "Stamp"];

function annotationIdentity(annotation: PDFDict, index: number) {
  const subtype = annotation.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
  if (!subtype || !EXPORTABLE_SUBTYPES.includes(subtype)) return null;
  const rect = annotation.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asRectangle();
  if (!rect) return null;
  const name =
    annotation.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.decodeText() ??
    `annot-${index}`;
  return { subtype, rect, name };
}

function collectAnnotationNames(doc: PDFDocument): Map<string, string> {
  const names = new Map<string, string>();
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex++) {
    const annots = doc.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index++) {
      const identity = annotationIdentity(annots.lookup(index, PDFDict), index);
      const ref = annots.get(index);
      if (identity && ref instanceof PDFRef) names.set(ref.toString(), identity.name);
    }
  }
  return names;
}

function annotationXml(
  annotation: PDFDict,
  identity: NonNullable<ReturnType<typeof annotationIdentity>>,
  annotationNames: Map<string, string>,
  pageIndex: number,
): string {
  const contents =
    annotation.lookupMaybe(PDFName.of("Contents"), PDFString, PDFHexString)?.decodeText() ?? "";
  const stamp = annotation.lookupMaybe(PDFName.of("Name"), PDFName)?.decodeText();
  const irt = annotation.get(PDFName.of("IRT"));
  const irtName = irt instanceof PDFRef ? annotationNames.get(irt.toString()) : undefined;
  const quadPoints = annotation.lookupMaybe(PDFName.of("QuadPoints"), PDFArray);
  const quad = quadPoints
    ? Array.from({ length: quadPoints.size() }, (_, offset) =>
        (quadPoints.get(offset) as PDFNumber).asNumber(),
      ).join(",")
    : "";
  const irtAttr = irtName ? ` inreplyto="${xmlEscape(irtName)}"` : "";
  const stampAttr = stamp ? ` stamp="${xmlEscape(stamp)}"` : "";
  const quadElem = quad ? `<quadpoints>${quad}</quadpoints>` : "";
  const contentsElem = contents ? `<contents>${xmlEscape(contents)}</contents>` : "";
  const tag = annotationTag(identity.subtype);
  return `<${tag} page="${pageIndex}" rect="${identity.rect.x},${identity.rect.y},${identity.rect.x + identity.rect.width},${identity.rect.y + identity.rect.height}" name="${xmlEscape(identity.name)}"${irtAttr}${stampAttr}>${quadElem}${contentsElem}</${tag}>`;
}

function exportPageAnnotations(
  doc: PDFDocument,
  pageIndex: number,
  annotationNames: Map<string, string>,
): string[] {
  const annots = doc.getPage(pageIndex).node.Annots();
  if (!annots) return [];
  const output: string[] = [];
  for (let index = 0; index < annots.size(); index++) {
    const annotation = annots.lookup(index, PDFDict);
    const identity = annotationIdentity(annotation, index);
    if (identity) output.push(annotationXml(annotation, identity, annotationNames, pageIndex));
  }
  return output;
}

function exportFormFields(doc: PDFDocument): string[] {
  return doc
    .getForm()
    .getFields()
    .map((field) => {
      const candidate = field as unknown as {
        getText?: () => string | undefined;
        isChecked?: () => boolean;
      };
      const value = candidate.getText?.() ?? (candidate.isChecked?.() ? "Yes" : "");
      return `<field name="${xmlEscape(field.getName())}"><value>${xmlEscape(value)}</value></field>`;
    });
}

export async function exportXfdf(pdfBytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdfBytes);
  const annotationNames = collectAnnotationNames(doc);
  const annotationXml = Array.from({ length: doc.getPageCount() }, (_, pageIndex) =>
    exportPageAnnotations(doc, pageIndex, annotationNames),
  ).flat();
  const fields = exportFormFields(doc);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><annots>${annotationXml.join("")}</annots><fields>${fields.join("")}</fields></xfdf>`;
}

function quadPointsForAnnotation(tag: string, attributes: Map<string, string>, body: string) {
  if (!["highlight", "underline", "strikeout"].includes(tag)) return undefined;
  const geometry =
    attributes.get("coords") ?? /<quadpoints>([\s\S]*?)<\/quadpoints>/i.exec(body)?.[1];
  const quadPoints = numbers(geometry);
  if (!geometry?.trim() || quadPoints.length % 8 !== 0 || !quadPoints.every(Number.isFinite)) {
    throw new Error("The XFDF text markup has invalid or missing quadrilateral geometry.");
  }
  return quadPoints;
}

function importAnnotationMatch(
  doc: PDFDocument,
  match: RegExpMatchArray,
  refs: Map<string, PDFRef>,
) {
  const tag = match[1].toLowerCase();
  const attributes = attrs(match[2]);
  const pageIndex = Number(attributes.get("page"));
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.getPageCount()) return;
  const rect = numbers(attributes.get("rect"));
  if (rect.length !== 4 || rect.some((value) => !Number.isFinite(value))) return;
  const page = doc.getPage(pageIndex);
  const quadPoints = quadPointsForAnnotation(tag, attributes, match[3]);
  const contents = /<contents>([\s\S]*?)<\/contents>/i.exec(match[3])?.[1] ?? "";
  const subtype = tag === "strikeout" ? "StrikeOut" : tag[0].toUpperCase() + tag.slice(1);
  const annotation = doc.context.obj({
    Type: "Annot",
    Subtype: subtype,
    Rect: rect,
    ...(quadPoints ? { QuadPoints: quadPoints } : {}),
    F: 4,
    P: page.ref,
    NM: pdfText(attributes.get("name") ?? `xfdf-${Date.now()}-${pageIndex}`),
    Contents: pdfText(xmlUnescape(contents)),
    ...(tag === "stamp" ? { Name: PDFName.of(attributes.get("stamp") ?? "Approved") } : {}),
  });
  const replyTo = attributes.get("inreplyto");
  if (replyTo && refs.has(replyTo)) {
    annotation.set(PDFName.of("IRT"), refs.get(replyTo)!);
    annotation.set(PDFName.of("RT"), PDFName.of("R"));
  }
  const ref = doc.context.register(annotation);
  page.node.addAnnot(ref);
  const name = attributes.get("name");
  if (name) refs.set(name, ref);
}

function importFieldMatch(form: ReturnType<PDFDocument["getForm"]>, match: RegExpMatchArray) {
  const name = attrs(match[1]).get("name");
  if (!name) return;
  const value = xmlUnescape(/<value>([\s\S]*?)<\/value>/i.exec(match[2])?.[1] ?? "");
  const field = form.getFieldMaybe(name) as unknown as
    | {
        setText?: (value: string) => void;
        check?: () => void;
        uncheck?: () => void;
      }
    | undefined;
  if (field?.setText) field.setText(value);
  else if (field?.check && value) field.check();
  else if (field?.uncheck && !value) field.uncheck();
}

export async function importXfdf(pdfBytes: Uint8Array, xml: string): Promise<Uint8Array> {
  if (new TextEncoder().encode(xml).byteLength > MAX_XFDF_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("The XFDF file is too large or contains a forbidden declaration.");
  const doc = await PDFDocument.load(pdfBytes);
  const refs = new Map<string, PDFRef>();
  const annotationPattern =
    /<(highlight|underline|strikeout|text|stamp)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of xml.matchAll(annotationPattern)) importAnnotationMatch(doc, match, refs);
  const form = doc.getForm();
  for (const match of xml.matchAll(/<field\b([^>]*)>([\s\S]*?)<\/field>/gi)) {
    importFieldMatch(form, match);
  }
  return doc.save();
}
