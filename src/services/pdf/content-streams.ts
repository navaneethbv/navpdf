import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from "pdf-lib";

/**
 * Append a newly created, isolated content stream tagged with a specific PDFName entry.
 * Disables autoNormalizeCTM so pdf-lib does not repeatedly wrap existing content in redundant
 * q/Q streams on every load/save cycle, while ensuring the new stream is registered cleanly.
 */
export function appendTaggedStream(
  doc: PDFDocument,
  page: PDFPage,
  tag: string,
  operators: PDFOperator[],
): PDFRef {
  const body = operators.map((op) => op.toString()).join("\n");
  const stream = doc.context.flateStream(body);
  stream.dict.set(PDFName.of(tag), doc.context.obj(true));
  const ref = doc.context.register(stream);
  (page.node as unknown as { autoNormalizeCTM: boolean }).autoNormalizeCTM = false;
  page.node.normalize();
  page.node.addContentStream(ref);
  return ref;
}

/**
 * Remove any content streams on the page tagged with the specified PDFName entry.
 * Preserves all other content streams intact.
 * If all streams were decorations and none remain, removes the Contents entry cleanly.
 */
export function removeTaggedStreams(
  doc: PDFDocument,
  page: PDFPage,
  tag: string,
): number {
  const contents = page.node.Contents();
  if (!(contents instanceof PDFArray)) return 0;

  const keep: PDFRef[] = [];
  let removed = 0;
  const tagName = PDFName.of(tag);

  for (let i = 0; i < contents.size(); i++) {
    const ref = contents.get(i) as PDFRef;
    const stream = doc.context.lookup(ref) as PDFStream | PDFRawStream | undefined;
    if (stream?.dict?.get(tagName)) {
      removed++;
    } else {
      keep.push(ref);
    }
  }

  if (removed > 0) {
    if (keep.length === 0) {
      page.node.delete(PDFName.of("Contents"));
    } else {
      page.node.set(PDFName.of("Contents"), doc.context.obj(keep));
    }
  }
  return removed;
}
