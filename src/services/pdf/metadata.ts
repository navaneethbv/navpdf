import { PDFDocument, PDFName } from "pdf-lib";

export interface DocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string[];
  creator: string;
  producer: string;
  created?: Date;
  modified?: Date;
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
  const stream = doc.context.flateStream(xmpPacket(metadata), {
    Type: PDFName.of("Metadata"),
    Subtype: PDFName.of("XML"),
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
  return doc.save({ useObjectStreams: false, addDefaultPage: false });
}
