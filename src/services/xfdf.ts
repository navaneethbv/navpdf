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
    .replaceAll('&', "&amp;")
    .replaceAll('<', "&lt;")
    .replaceAll('>', "&gt;")
    .replaceAll('"', "&quot;");
const xmlUnescape = (value: string) =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', ">")
    .replaceAll('&lt;', "<")
    .replaceAll('&amp;', "&");
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

export async function exportXfdf(pdfBytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdfBytes);
  const annotationXml: string[] = [];
  const annotationNames = new Map<string, string>();
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex++) {
    const annots = doc.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index++) {
      const annotation = annots.lookup(index, PDFDict);
      const subtype = annotation.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
      if (!subtype || !["Text", "Highlight", "Underline", "StrikeOut", "Stamp"].includes(subtype))
        continue;
      const rect = annotation.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asRectangle();
      if (!rect) continue;
      const name =
        annotation.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.decodeText() ??
        `annot-${index}`;
      const annotationRef = annots.get(index);
      if (annotationRef instanceof PDFRef) annotationNames.set(annotationRef.toString(), name);
    }
  }
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex++) {
    const annots = doc.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index++) {
      const annotation = annots.lookup(index, PDFDict);
      const subtype = annotation.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
      if (!subtype || !["Text", "Highlight", "Underline", "StrikeOut", "Stamp"].includes(subtype))
        continue;
      const rect = annotation.lookupMaybe(PDFName.of("Rect"), PDFArray)?.asRectangle();
      if (!rect) continue;
      const name =
        annotation.lookupMaybe(PDFName.of("NM"), PDFString, PDFHexString)?.decodeText() ??
        `annot-${index}`;
      const contents =
        annotation.lookupMaybe(PDFName.of("Contents"), PDFString, PDFHexString)?.decodeText() ?? "";
      const stamp = annotation.lookupMaybe(PDFName.of("Name"), PDFName)?.decodeText();
      const irt = annotation.get(PDFName.of("IRT"));
      const irtName = irt instanceof PDFRef ? annotationNames.get(irt.toString()) : undefined;
      const quadPoints = annotation.lookupMaybe(PDFName.of("QuadPoints"), PDFArray);
      const quad = quadPoints
        ? Array.from({ length: quadPoints.size() }, (_, i) =>
            (quadPoints.get(i) as PDFNumber).asNumber(),
          ).join(",")
        : "";
      const tag = annotationTag(subtype);
      annotationXml.push(
        `<${tag} page="${pageIndex}" rect="${rect.x},${rect.y},${rect.x + rect.width},${rect.y + rect.height}" name="${xmlEscape(name)}"${irtName ? ` inreplyto="${xmlEscape(irtName)}"` : ""}${stamp ? ` stamp="${xmlEscape(stamp)}"` : ""}>${quad ? `<quadpoints>${quad}</quadpoints>` : ""}${contents ? `<contents>${xmlEscape(contents)}</contents>` : ""}</${tag}>`,
      );
    }
  }
  const fields: string[] = [];
  for (const field of doc.getForm().getFields()) {
    const name = field.getName();
    let value = "";
    const candidate = field as unknown as {
      getText?: () => string | undefined;
      isChecked?: () => boolean;
    };
    if (candidate.getText) value = candidate.getText() ?? "";
    else if (candidate.isChecked?.()) value = "Yes";
    fields.push(`<field name="${xmlEscape(name)}"><value>${xmlEscape(value)}</value></field>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><annots>${annotationXml.join("")}</annots><fields>${fields.join("")}</fields></xfdf>`;
}

export async function importXfdf(pdfBytes: Uint8Array, xml: string): Promise<Uint8Array> {
  if (new TextEncoder().encode(xml).byteLength > MAX_XFDF_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("The XFDF file is too large or contains a forbidden declaration.");
  const doc = await PDFDocument.load(pdfBytes);
  const context = doc.context;
  const refs = new Map<string, PDFRef>();
  const annotationPattern =
    /<(highlight|underline|strikeout|text|stamp)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of xml.matchAll(annotationPattern)) {
    const tag = match[1].toLowerCase();
    const attributes = attrs(match[2]);
    const pageIndex = Number(attributes.get("page"));
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.getPageCount()) continue;
    const page = doc.getPage(pageIndex);
    const rect = numbers(attributes.get("rect"));
    if (rect.length !== 4 || rect.some((value) => !Number.isFinite(value))) continue;
    const body = match[3];
    let quadPoints: number[] | undefined;
    if (["highlight", "underline", "strikeout"].includes(tag)) {
      const geometry =
        attributes.get("coords") ?? body.match(/<quadpoints>([\s\S]*?)<\/quadpoints>/i)?.[1];
      quadPoints = numbers(geometry);
      if (!geometry?.trim() || quadPoints.length % 8 !== 0 || !quadPoints.every(Number.isFinite)) {
        throw new Error("The XFDF text markup has invalid or missing quadrilateral geometry.");
      }
    }
    const contents = body.match(/<contents>([\s\S]*?)<\/contents>/i)?.[1] ?? "";
    const subtype = tag === "strikeout" ? "StrikeOut" : tag[0].toUpperCase() + tag.slice(1);
    const annotation = context.obj({
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
    const ref = context.register(annotation);
    page.node.addAnnot(ref);
    const name = attributes.get("name");
    if (name) refs.set(name, ref);
  }
  const form = doc.getForm();
  for (const match of xml.matchAll(/<field\b([^>]*)>([\s\S]*?)<\/field>/gi)) {
    const name = attrs(match[1]).get("name");
    const value = xmlUnescape(match[2].match(/<value>([\s\S]*?)<\/value>/i)?.[1] ?? "");
    if (!name) continue;
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
  return doc.save();
}
