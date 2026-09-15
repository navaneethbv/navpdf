#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";

const input = resolve(process.argv[2] ?? "output/perf/heavy-40.pdf");
const json = process.argv.includes("--json");
const bytes = new Uint8Array(await readFile(input));
const before = process.memoryUsage();
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
const serialized = await doc.save({ useObjectStreams: true });
const after = process.memoryUsage();
const result = {
  file: input,
  fileBytes: bytes.byteLength,
  pages: doc.getPageCount(),
  rssBefore: before.rss,
  rssAfter: after.rss,
  heapUsedBefore: before.heapUsed,
  heapUsedAfter: after.heapUsed,
  serializedBytes: serialized.byteLength,
  deltaRss: after.rss - before.rss,
  deltaHeapUsed: after.heapUsed - before.heapUsed,
};
if (json) console.log(JSON.stringify(result));
else {
  console.table(result);
  console.log(
    "This probe measures the Node process only; it does not establish native app budgets.",
  );
}
