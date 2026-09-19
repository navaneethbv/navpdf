// Office Open XML and RTF writers for text reconstructed from PDF pages. Output is genuine
// DOCX, XLSX and PPTX packages; layout reconstruction is limited to lines, cells, columns
// and heading sizes from the PDF text layer.

export interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export interface Cell {
  x: number;
  text: string;
}

export interface Line {
  x: number;
  y: number;
  size: number;
  cells: Cell[];
  text: string;
}

export interface Paragraph {
  text: string;
  heading: 0 | 1 | 2;
}

export interface PageLayout {
  page: number;
  width: number;
  height: number;
  lines: Line[];
  paragraphs: Paragraph[];
}

export interface Slide {
  width: number;
  height: number;
  image?: Uint8Array;
  boxes?: { x: number; y: number; size: number; text: string }[];
}

const encoder = new TextEncoder();
/** ZIP32 limit for a single stored archive. */
const MAX_ARCHIVE_BYTES = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP archive with stored (uncompressed) entries and UTF-8 names. */
export function createZip(
  entries: { name: string; data: Uint8Array | string }[],
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(12, 0x21, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length);
    const directory = new DataView(record.buffer);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint16(8, 0x0800, true);
    directory.setUint16(14, 0x21, true);
    directory.setUint32(16, crc, true);
    directory.setUint32(20, data.length, true);
    directory.setUint32(24, data.length, true);
    directory.setUint16(28, name.length, true);
    directory.setUint32(42, offset, true);
    record.set(name, 46);
    parts.push(local, data);
    central.push(record);
    offset += local.length + data.length;
    if (offset > MAX_ARCHIVE_BYTES) throw new Error("The export is too large for one file.");
  }
  const size = central.reduce((total, record) => total + record.length, 0);
  const end = new Uint8Array(22);
  const trailer = new DataView(end.buffer);
  trailer.setUint32(0, 0x06054b50, true);
  trailer.setUint16(8, entries.length, true);
  trailer.setUint16(10, entries.length, true);
  trailer.setUint32(12, size, true);
  trailer.setUint32(16, offset, true);
  const output = new Uint8Array(offset + size + end.length);
  let position = 0;
  for (const part of [...parts, ...central, end]) {
    output.set(part, position);
    position += part.length;
  }
  return output;
}

/** XML 1.0 allows tab, line feed and carriage return but no other control characters. */
function isXmlCharacter(char: string) {
  const code = char.codePointAt(0) ?? 0;
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    (code >= 0x20 && code !== 0xfffe && code !== 0xffff)
  );
}

export function escapeXml(text: string) {
  return Array.from(text)
    .filter(isXmlCharacter)
    .join("")
    .replaceAll(/&/g, "&amp;")
    .replaceAll(/</g, "&lt;")
    .replaceAll(/>/g, "&gt;")
    .replaceAll(/"/g, "&quot;");
}

interface Word {
  x: number;
  y: number;
  size: number;
  width: number;
  text: string;
}

function splitColumns(words: Word[], pageWidth: number): Word[][] {
  const binWidth = 2;
  const bins = new Uint16Array(Math.max(1, Math.ceil(pageWidth / binWidth)));
  for (const word of words) {
    const first = Math.max(0, Math.floor(word.x / binWidth));
    const last = Math.min(bins.length - 1, Math.floor((word.x + word.width) / binWidth));
    for (let bin = first; bin <= last; bin++) bins[bin]++;
  }
  let best: { end: number; length: number } | null = null;
  let run = 0;
  for (let bin = Math.floor(bins.length * 0.3); bin < Math.floor(bins.length * 0.7); bin++) {
    run = bins[bin] === 0 ? run + 1 : 0;
    if (run >= 6 && (!best || run > best.length)) best = { end: bin, length: run };
  }
  if (!best || words.length < 20) return [words];
  const gutter = (best.end - best.length / 2) * binWidth;
  const left = words.filter((word) => word.x + word.width / 2 < gutter);
  const right = words.filter((word) => word.x + word.width / 2 >= gutter);
  return left.length >= 5 && right.length >= 5 ? [left, right] : [words];
}

/** Groups text items into reading-order lines, table cells and paragraphs. */
function headingLevel(ratio: number): 0 | 1 | 2 {
  if (ratio >= 1.6) return 1;
  if (ratio >= 1.25) return 2;
  return 0;
}

export function layoutPage(
  page: number,
  items: TextItem[],
  width: number,
  height: number,
): PageLayout {
  const words: Word[] = items
    .filter((item) => item.str.trim())
    .map((item) => ({
      x: item.transform[4],
      y: item.transform[5],
      size: Math.hypot(item.transform[2], item.transform[3]) || item.height || 10,
      width: item.width,
      text: item.str,
    }));
  const lines: Line[] = [];
  const paragraphs: Paragraph[] = [];
  const sizes = words.map((word) => word.size).sort((a, b) => a - b);
  // The lower median keeps a short page's single title from being treated as body text.
  const body = sizes[Math.floor((sizes.length - 1) / 2)] ?? 10;
  for (const column of splitColumns(words, width)) {
    const sorted = [...column].sort((a, b) => b.y - a.y || a.x - b.x);
    const columnLines: Line[] = [];
    for (const word of sorted) {
      const line = columnLines.find(
        (candidate) => Math.abs(candidate.y - word.y) <= Math.max(candidate.size, word.size) * 0.5,
      );
      if (line) {
        line.cells.push({ x: word.x, text: word.text });
        line.size = Math.max(line.size, word.size);
        line.x = Math.min(line.x, word.x);
      } else {
        columnLines.push({
          x: word.x,
          y: word.y,
          size: word.size,
          cells: [{ x: word.x, text: word.text }],
          text: "",
        });
      }
    }
    for (const line of columnLines) {
      const byX = [...column]
        .filter((word) => Math.abs(line.y - word.y) <= Math.max(line.size, word.size) * 0.5)
        .sort((a, b) => a.x - b.x);
      const cells: Cell[] = [];
      let previousEnd = -Infinity;
      for (const word of byX) {
        const gap = word.x - previousEnd;
        const last = cells[cells.length - 1];
        if (last && gap <= line.size * 1.5) {
          last.text += gap > line.size * 0.15 ? ` ${word.text}` : word.text;
        } else {
          cells.push({ x: word.x, text: word.text });
        }
        previousEnd = Math.max(previousEnd, word.x + word.width);
      }
      line.cells = cells.map((cell) => ({ ...cell, text: cell.text.trim() }));
      line.text = line.cells.map((cell) => cell.text).join(" ");
    }
    columnLines.sort((a, b) => b.y - a.y);
    lines.push(...columnLines);
    let current: { text: string; size: number; y: number } | null = null;
    const flush = () => {
      if (!current) return;
      const ratio = current.size / body;
      paragraphs.push({ text: current.text, heading: headingLevel(ratio) });
      current = null;
    };
    for (const line of columnLines) {
      const joinable =
        current &&
        Math.abs(current.size - line.size) < 0.5 &&
        current.y - line.y <= line.size * 1.8 &&
        line.size / body < 1.25;
      if (current && joinable) {
        current.text += current.text.endsWith("-") ? line.text : ` ${line.text}`;
        current.y = line.y;
      } else {
        flush();
        current = { text: line.text, size: line.size, y: line.y };
      }
    }
    flush();
  }
  return { page, width, height, lines, paragraphs };
}

const CORE = (title: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(title)}</dc:title><dc:creator>NavPDF</dc:creator></cp:coreProperties>`;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PACKAGE_RELS = (main: string, type: string) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const OVERRIDE = (part: string, type: string) =>
  `<Override PartName="/${part}" ContentType="${type}"/>`;
const CORE_TYPE = OVERRIDE(
  "docProps/core.xml",
  "application/vnd.openxmlformats-package.core-properties+xml",
);

export function buildDocx(layouts: PageLayout[], title: string) {
  const [first] = layouts;
  const paragraph = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  const body = layouts
    .map((layout, index) => {
      const content = layout.paragraphs
        .map((item) => paragraph(item.text, item.heading ? `Heading${item.heading}` : undefined))
        .join("");
      const breakBefore = index > 0 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : "";
      return breakBefore + (content || paragraph(""));
    })
    .join("");
  const twips = (points: number) => Math.round(points * 20);
  const document = `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="${twips(first?.width ?? 612)}" w:h="${twips(first?.height ?? 792)}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const heading = (level: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>${heading(1, 36)}${heading(2, 28)}</w:styles>`;
  return createZip([
    {
      name: "[Content_Types].xml",
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${OVERRIDE("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")}${OVERRIDE("word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml")}${CORE_TYPE}</Types>`,
    },
    { name: "_rels/.rels", data: PACKAGE_RELS("word/document.xml", "officeDocument") },
    { name: "docProps/core.xml", data: CORE(title) },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles },
    {
      name: "word/_rels/document.xml.rels",
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
  ]);
}

/** Aligns each line's cells to shared column anchors so tables keep their columns. */
export function tableRows(layout: PageLayout, tolerance = 12): string[][] {
  const anchors: number[] = [];
  for (const x of layout.lines
    .flatMap((line) => line.cells.map((cell) => cell.x))
    .sort((a, b) => a - b)) {
    if (!anchors.length || x - anchors[anchors.length - 1] > tolerance) anchors.push(x);
  }
  return layout.lines.map((line) => {
    const row: string[] = new Array(anchors.length).fill("");
    for (const cell of line.cells) {
      let column = 0;
      for (let index = 0; index < anchors.length; index++)
        if (anchors[index] <= cell.x + tolerance / 2) column = index;
      row[column] = row[column] ? `${row[column]} ${cell.text}` : cell.text;
    }
    while (row.length && !row[row.length - 1]) row.pop();
    return row;
  });
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export type CellValue =
  | { kind: "number"; value: number }
  | { kind: "date"; value: number }
  | { kind: "text"; value: string };

/** Numbers and ISO dates become typed cells; everything else, including `=` text, stays text. */
export function cellValue(text: string): CellValue {
  const trimmed = text.trim();
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (date) {
    const time = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
    const valid = new Date(time).getUTCDate() === Number(date[3]);
    if (valid) return { kind: "date", value: Math.round((time - EXCEL_EPOCH) / 86_400_000) };
  }
  const numeric = /^(\()?-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?(\))?$/.exec(trimmed);
  if (numeric && Boolean(numeric[1]) === Boolean(numeric[5])) {
    const value = Number(trimmed.replaceAll(/[(),]/g, ""));
    if (Number.isFinite(value))
      return { kind: "number", value: numeric[1] ? -Math.abs(value) : value };
  }
  return { kind: "text", value: text };
}

function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCodePoint(65 + ((n - 1) % 26)) + name;
  return name;
}

export function buildXlsx(sheets: { name: string; rows: string[][] }[]) {
  const safeSheets = sheets.length ? sheets : [{ name: "Sheet1", rows: [] }];
  const names = new Set<string>();
  const sheetNames = safeSheets.map((sheet, index) => {
    let name =
      sheet.name
        .replaceAll(/[\\/?*[\]:]/g, " ")
        .slice(0, 31)
        .trim() || `Sheet${index + 1}`;
    while (names.has(name)) name = `${name.slice(0, 28)} ${index + 1}`;
    names.add(name);
    return name;
  });
  const worksheet = (rows: string[][]) =>
    `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((text, c) => {
              if (!text) return "";
              const ref = `${columnName(c)}${r + 1}`;
              const value = cellValue(text);
              if (value.kind === "number") return `<c r="${ref}"><v>${value.value}</v></c>`;
              if (value.kind === "date") return `<c r="${ref}" s="1"><v>${value.value}</v></c>`;
              return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value.value)}</t></is></c>`;
            })
            .join("")}</row>`,
      )
      .join("")}</sheetData></worksheet>`;
  const styles = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return createZip([
    {
      name: "[Content_Types].xml",
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${OVERRIDE("xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")}${OVERRIDE("xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml")}${sheetNames.map((_, i) => OVERRIDE(`xl/worksheets/sheet${i + 1}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")).join("")}${CORE_TYPE}</Types>`,
    },
    { name: "_rels/.rels", data: PACKAGE_RELS("xl/workbook.xml", "officeDocument") },
    { name: "docProps/core.xml", data: CORE(sheetNames[0]) },
    {
      name: "xl/workbook.xml",
      data: `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetNames.map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: styles },
    ...safeSheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: worksheet(sheet.rows),
    })),
  ]);
}

const DRAWING =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const EMPTY_TREE =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="NavPDF"><a:themeElements><a:clrScheme name="NavPDF"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3D33"/></a:dk2><a:lt2><a:srgbClr val="EEF3F0"/></a:lt2><a:accent1><a:srgbClr val="25604B"/></a:accent1><a:accent2><a:srgbClr val="8F3F32"/></a:accent2><a:accent3><a:srgbClr val="F5CF58"/></a:accent3><a:accent4><a:srgbClr val="4F81BD"/></a:accent4><a:accent5><a:srgbClr val="9BBB59"/></a:accent5><a:accent6><a:srgbClr val="8064A2"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="NavPDF"><a:majorFont><a:latin typeface="Helvetica"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Helvetica"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="NavPDF"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

/** Genuine PPTX slides: either a full-page picture or editable text boxes per line. */
export function buildPptx(slides: Slide[], title: string) {
  const emu = (points: number) => Math.round(points * 12700);
  const clamp = (value: number) => Math.min(51206400, Math.max(914400, value));
  const [first] = slides;
  const cx = clamp(emu(first?.width ?? 720));
  const cy = clamp(emu(first?.height ?? 540));
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (items: string) =>
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
  const entries: { name: string; data: Uint8Array | string }[] = [];
  slides.forEach((slide, index) => {
    const number = index + 1;
    const scaleX = cx / emu(slide.width);
    const scaleY = cy / emu(slide.height);
    let shapeId = 2;
    const shapes = slide.image
      ? `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId++}" name="Page ${number}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
      : (slide.boxes ?? [])
          .map((box) => {
            const x = Math.round(emu(box.x) * scaleX);
            const y = Math.round(emu(slide.height - box.y - box.size) * scaleY);
            const width = Math.max(emu(20), cx - x);
            const height = Math.max(emu(box.size * 1.4), 1);
            const size = Math.max(100, Math.min(400000, Math.round(box.size * scaleY * 100)));
            return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId++}" name="Text ${shapeId}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${Math.max(0, y)}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="${size}" dirty="0"/><a:t>${escapeXml(box.text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
          })
          .join("");
    entries.push({
      name: `ppt/slides/slide${number}.xml`,
      data: `${XML}<p:sld ${DRAWING}><p:cSld><p:spTree>${EMPTY_TREE}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    });
    entries.push({
      name: `ppt/slides/_rels/slide${number}.xml.rels`,
      data: rels(
        rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml") +
          (slide.image ? rel("rId2", "image", `../media/page${number}.png`) : ""),
      ),
    });
    if (slide.image) entries.push({ name: `ppt/media/page${number}.png`, data: slide.image });
  });
  const slideRels = slides
    .map((_, i) => rel(`rId${i + 2}`, "slide", `slides/slide${i + 1}.xml`))
    .join("");
  return createZip([
    {
      name: "[Content_Types].xml",
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${OVERRIDE("ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")}${OVERRIDE("ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml")}${OVERRIDE("ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml")}${OVERRIDE("ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml")}${slides.map((_, i) => OVERRIDE(`ppt/slides/slide${i + 1}.xml`, "application/vnd.openxmlformats-officedocument.presentationml.slide+xml")).join("")}${CORE_TYPE}</Types>`,
    },
    { name: "_rels/.rels", data: PACKAGE_RELS("ppt/presentation.xml", "officeDocument") },
    { name: "docProps/core.xml", data: CORE(title) },
    {
      name: "ppt/presentation.xml",
      data: `${XML}<p:presentation ${DRAWING}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: rels(
        rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml") +
          slideRels +
          rel(`rId${slides.length + 2}`, "theme", "theme/theme1.xml"),
      ),
    },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      data: `${XML}<p:sldMaster ${DRAWING}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: rels(
        rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml") +
          rel("rId2", "theme", "../theme/theme1.xml"),
      ),
    },
    {
      name: "ppt/slideLayouts/slideLayout1.xml",
      data: `${XML}<p:sldLayout ${DRAWING} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: rels(rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")),
    },
    { name: "ppt/theme/theme1.xml", data: THEME },
    ...entries,
  ]);
}

/** Plain paragraphs in RTF with Unicode escapes and page breaks. */
export function buildRtf(layouts: PageLayout[]) {
  const escape = (text: string) =>
    Array.from(text)
      .map((char) => {
        const code = char.codePointAt(0) ?? 0;
        if (char === "\\" || char === "{" || char === "}") return `\\${char}`;
        if (code < 0x80) return code < 0x20 ? "" : char;
        const units =
          code > 0xffff
            ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)]
            : [code];
        return units
          .map((unit) => String.raw`\u${unit > 0x7fff ? unit - 0x10000 : unit}?`)
          .join("");
      })
      .join("");
  const pages = layouts.map((layout) =>
    layout.paragraphs
      .map(
        (item) =>
          `${item.heading ? `\\b\\fs${item.heading === 1 ? 36 : 28} ` : ""}${escape(item.text)}${item.heading ? "\\b0\\fs24" : ""}\\par`,
      )
      .join("\n"),
  );
  return `{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\f0\\fs24\n${pages.join("\n\\page\n")}\n}`;
}
