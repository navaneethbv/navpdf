import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFStream,
  PDFString,
} from "pdf-lib";
import { pdfText } from "./text-string.ts";

export interface DocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  creator: string;
  producer: string;
  created?: Date;
  modified?: Date;
  /** Custom text entries in the document information dictionary. */
  custom?: CustomProperty[];
}

export interface CustomProperty {
  name: string;
  value: string;
}

const STANDARD_INFO_KEYS = new Set([
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
  "Trapped",
]);
const MAX_CUSTOM_PROPERTIES = 100;

function infoDict(doc: PDFDocument): PDFDict | undefined {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  return info instanceof PDFDict ? info : undefined;
}

function readCustomProperties(doc: PDFDocument): CustomProperty[] {
  const info = infoDict(doc);
  if (!info) return [];
  const result: CustomProperty[] = [];
  for (const [key, raw] of info.entries()) {
    const name = key.decodeText();
    const value = info.lookup(key);
    if (STANDARD_INFO_KEYS.has(name) || raw instanceof PDFRef) continue;
    if (value instanceof PDFString || value instanceof PDFHexString)
      result.push({ name, value: value.decodeText() });
  }
  return result.slice(0, MAX_CUSTOM_PROPERTIES);
}

/** Validates names: printable ASCII without PDF delimiters, unique and not a standard key. */
export function validateCustomProperties(properties: CustomProperty[]) {
  if (properties.length > MAX_CUSTOM_PROPERTIES)
    throw new Error(`Use at most ${MAX_CUSTOM_PROPERTIES} custom properties.`);
  const seen = new Set<string>();
  for (const { name, value } of properties) {
    if (!/^[A-Za-z0-9_.-]{1,127}$/.test(name))
      throw new Error(
        `"${name}" is not a valid property name. Use letters, digits and - _ . only.`,
      );
    if (STANDARD_INFO_KEYS.has(name)) throw new Error(`"${name}" is a standard property.`);
    if (seen.has(name)) throw new Error(`The property "${name}" is listed twice.`);
    if (value.length > 32_000) throw new Error(`The value of "${name}" is too long.`);
    seen.add(name);
  }
}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const xmpDate = (value?: Date) => (value ? value.toISOString() : "");

function xmpPacket(metadata: DocumentMetadata): string {
  const keywords = metadata.keywords.join(", ");
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${escapeXml(metadata.author)}</rdf:li></rdf:Seq></dc:creator>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(metadata.subject)}</rdf:li></rdf:Alt></dc:description>
      <pdf:Keywords>${escapeXml(keywords)}</pdf:Keywords>
      <xmp:CreatorTool>${escapeXml(metadata.creator)}</xmp:CreatorTool>
      ${metadata.created ? `<xmp:CreateDate>${xmpDate(metadata.created)}</xmp:CreateDate>` : ""}
      ${metadata.modified ? `<xmp:ModifyDate>${xmpDate(metadata.modified)}</xmp:ModifyDate>` : ""}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export async function readMetadata(bytes: Uint8Array): Promise<DocumentMetadata> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const keywords = doc
    .getKeywords()
    ?.split(/[,;]\s*|\s+/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return {
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: keywords ?? [],
    creator: doc.getCreator() ?? "",
    producer: doc.getProducer() ?? "",
    created: doc.getCreationDate(),
    modified: doc.getModificationDate(),
    custom: readCustomProperties(doc),
  };
}

export async function writeMetadata(
  bytes: Uint8Array,
  metadata: DocumentMetadata,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.setTitle(metadata.title);
  doc.setAuthor(metadata.author);
  doc.setSubject(metadata.subject);
  doc.setKeywords(metadata.keywords);
  doc.setCreator(metadata.creator);
  doc.setProducer(metadata.producer);
  if (metadata.created) doc.setCreationDate(metadata.created);
  if (metadata.modified) doc.setModificationDate(metadata.modified);
  if (metadata.custom) {
    validateCustomProperties(metadata.custom);
    const info = infoDict(doc);
    if (info) {
      for (const old of readCustomProperties(doc)) info.delete(PDFName.of(old.name));
      for (const { name, value } of metadata.custom) info.set(PDFName.of(name), pdfText(value));
    }
  }
  const stream = doc.context.flateStream(xmpPacket(metadata), {
    Type: PDFName.of("Metadata"),
    Subtype: PDFName.of("XML"),
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}

export interface FontInfo {
  name: string;
  type: string;
  encoding: string;
  embedded: boolean;
  subset: boolean;
  pages: number[];
}

const MAX_RESOURCE_DEPTH = 8;

/** Fonts used by page content and form XObjects, with type and embedding status. */
export async function listFonts(bytes: Uint8Array): Promise<FontInfo[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fonts = new Map<PDFDict, FontInfo>();
  const visit = (resources: unknown, page: number, depth: number, seen: Set<PDFDict>) => {
    if (!(resources instanceof PDFDict) || depth > MAX_RESOURCE_DEPTH || seen.has(resources))
      return;
    seen.add(resources);
    const fontDict = resources.lookupMaybe(PDFName.of("Font"), PDFDict);
    for (const [, ref] of fontDict?.entries() ?? []) {
      const font = doc.context.lookup(ref);
      if (!(font instanceof PDFDict)) continue;
      const known = fonts.get(font);
      if (known) {
        if (!known.pages.includes(page)) known.pages.push(page);
        continue;
      }
      fonts.set(font, describeFont(font, page));
    }
    const xobjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
    for (const [, ref] of xobjects?.entries() ?? []) {
      const xobject = doc.context.lookup(ref);
      if (xobject instanceof PDFStream)
        visit(xobject.dict.lookup(PDFName.of("Resources")), page, depth + 1, seen);
    }
  };
  doc.getPages().forEach((page, index) => {
    visit(page.node.Resources(), index + 1, 0, new Set());
  });
  return [...fonts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function describeFont(font: PDFDict, page: number): FontInfo {
  const nameOf = (dict: PDFDict | undefined, key: string) =>
    dict?.lookupMaybe(PDFName.of(key), PDFName)?.decodeText() ?? "";
  const base = nameOf(font, "BaseFont") || "(unnamed)";
  const subtype = nameOf(font, "Subtype");
  let descriptor = font.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  let type = subtype;
  if (subtype === "Type0") {
    const descendant = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray)?.lookup(0);
    if (descendant instanceof PDFDict) {
      descriptor = descendant.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
      type = `Type 0 (${nameOf(descendant, "Subtype") || "CID"})`;
    }
  }
  const embedded =
    subtype === "Type3" ||
    ["FontFile", "FontFile2", "FontFile3"].some((key) => descriptor?.has(PDFName.of(key)));
  const encoding = font.lookup(PDFName.of("Encoding"));
  return {
    name: base.replace(/^[A-Z]{6}\+/, ""),
    type: type || "Unknown",
    encoding:
      encoding instanceof PDFName ? encoding.decodeText() : encoding ? "Custom" : "Built-in",
    embedded,
    subset: /^[A-Z]{6}\+/.test(base),
    pages: [page],
  };
}
