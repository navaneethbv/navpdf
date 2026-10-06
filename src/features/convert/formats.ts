// Text, CSV, HTML and XML writers for text reconstructed from PDF pages. Like the Office
// writers, they use the PDF text layer only: images, vector drawings, fonts and exact
// positions are not carried over.

import { cellValue, escapeXml, uniqueSheetNames, type PageLayout } from "./ooxml.ts";

/** UTF-8 plain text with one line per reconstructed text line, in column-aware reading order. */
export function buildPlainText(layouts: PageLayout[]) {
  return layouts
    .map((layout) => {
      const lines = layout.lines.map((line) => line.text).join("\n");
      return `--- Page ${layout.page} ---\n\n${lines}\n`;
    })
    .join("\n");
}

/** Text that a spreadsheet would evaluate as a formula or command when opened. */
function formulaLike(text: string) {
  return /^[=+\-@\t\r]/.test(text) && cellValue(text).kind !== "number";
}

/**
 * RFC 4180 CSV with a UTF-8 byte order mark so spreadsheet applications detect the encoding.
 * Pages follow each other separated by an empty row. Formula-like cells are prefixed with an
 * apostrophe so opening the file never evaluates text taken from the PDF.
 */
export function buildCsv(pages: string[][][]) {
  const quote = (cell: string) => {
    const text = formulaLike(cell) ? `'${cell}` : cell;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows = pages.flatMap((rowsOfPage, index) => [
    ...(index > 0 ? [""] : []),
    ...rowsOfPage.map((row) => row.map(quote).join(",")),
  ]);
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Microsoft XML Spreadsheet 2003 with one worksheet per page and typed number and date cells. */
export function buildSpreadsheetXml(sheets: { name: string; rows: string[][] }[]) {
  const safeSheets = sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
  const names = uniqueSheetNames(safeSheets.map((sheet) => sheet.name));
  const cell = (text: string, column: number, previous: number) => {
    const index = column === previous + 1 ? "" : ` ss:Index="${column + 1}"`;
    const value = cellValue(text);
    if (value.kind === "number")
      return `<Cell${index}><Data ss:Type="Number">${value.value}</Data></Cell>`;
    if (value.kind === "date") {
      const iso = new Date(EXCEL_EPOCH + value.value * 86_400_000).toISOString().slice(0, 19);
      return `<Cell${index} ss:StyleID="date"><Data ss:Type="DateTime">${iso}.000</Data></Cell>`;
    }
    return `<Cell${index}><Data ss:Type="String">${escapeXml(value.value)}</Data></Cell>`;
  };
  const row = (cells: string[]) => {
    let previous = -1;
    const content = cells
      .map((text, column) => {
        if (!text) return "";
        const xml = cell(text, column, previous);
        previous = column;
        return xml;
      })
      .join("");
    return `<Row>${content}</Row>`;
  };
  const worksheets = safeSheets
    .map(
      (sheet, index) =>
        `<Worksheet ss:Name="${escapeXml(names[index])}"><Table>${sheet.rows.map(row).join("")}</Table></Worksheet>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"/><Style ss:ID="date"><NumberFormat ss:Format="yyyy\\-mm\\-dd"/></Style></Styles>${worksheets}</Workbook>
`;
}

function escapeHtml(text: string) {
  return escapeXml(text).replaceAll("'", "&#39;");
}

/**
 * A self-contained HTML page with one section per PDF page. The content security policy
 * blocks scripts, remote resources and forms, so the file stays inert in any browser.
 */
export function buildHtml(layouts: PageLayout[], title: string) {
  const sections = layouts
    .map((layout) => {
      const content = layout.paragraphs
        .map((item) => {
          const tag = item.heading ? `h${item.heading + 1}` : "p";
          return `<${tag}>${escapeHtml(item.text)}</${tag}>`;
        })
        .join("\n");
      return `<section class="page" id="page-${layout.page}" aria-label="Page ${layout.page}">\n${content}\n</section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="NavPDF">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: system-ui, sans-serif; line-height: 1.5; max-width: 50rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; background: #fff; }
.page + .page { border-top: 1px solid #ccc; margin-top: 2rem; padding-top: 1rem; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${sections}
</body>
</html>
`;
}

/** A structured XML 1.0 document of pages, headings and paragraphs. */
export function buildXmlDocument(layouts: PageLayout[], title: string) {
  const round = (value: number) => Math.round(value * 100) / 100;
  const pages = layouts
    .map((layout) => {
      const content = layout.paragraphs
        .map((item) =>
          item.heading
            ? `    <heading level="${item.heading}">${escapeXml(item.text)}</heading>`
            : `    <paragraph>${escapeXml(item.text)}</paragraph>`,
        )
        .join("\n");
      const body = content ? `\n${content}\n  ` : "";
      return `  <page number="${layout.page}" width="${round(layout.width)}" height="${round(layout.height)}">${body}</page>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<document title="${escapeXml(title)}" generator="NavPDF">
${pages}
</document>
`;
}
