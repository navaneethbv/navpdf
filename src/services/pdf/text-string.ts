import { PDFHexString, PDFString } from "pdf-lib";

/** Encode text as PDF data, including delimiters and characters outside PDFDocEncoding. */
export function pdfText(value: string): PDFString | PDFHexString {
  return /^[\x20-\x7e]*$/.test(value)
    ? PDFString.of(value.replaceAll(/[\\()]/g, String.raw`\$&`))
    : PDFHexString.fromText(value);
}
