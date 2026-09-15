import { describe, expect, it } from "vitest";
import {
  buildDocx,
  buildPptx,
  buildRtf,
  buildXlsx,
  cellValue,
  crc32,
  createZip,
  escapeXml,
  layoutPage,
  tableRows,
  type TextItem,
} from "../../src/features/convert/ooxml";

/** Reads a stored ZIP through its central directory, verifying each CRC. */
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const dataStart = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, decoder.decode(data));
    offset += 46 + nameLength;
  }
  return files;
}

const item = (
  str: string,
  x: number,
  y: number,
  size = 10,
  width = str.length * size * 0.5,
): TextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});

describe("layout reconstruction", () => {
  it("builds reading-order paragraphs with headings and table cells", () => {
    const layout = layoutPage(
      1,
      [
        item("Quarterly Report", 72, 720, 24),
        item("Revenue grew in", 72, 680),
        item("every region.", 72, 668),
        item("Region", 72, 600),
        item("Total", 300, 600),
        item("North", 72, 586),
        item("1,250.50", 300, 586),
        item(" ", 400, 400),
      ],
      612,
      792,
    );
    expect(layout.paragraphs[0]).toEqual({ text: "Quarterly Report", heading: 1 });
    expect(layout.paragraphs[1].text).toBe("Revenue grew in every region.");
    expect(tableRows(layout).slice(-2)).toEqual([
      ["Region", "Total"],
      ["North", "1,250.50"],
    ]);
  });

  it("reads two text columns before moving across the gutter", () => {
    const items: TextItem[] = [];
    for (let row = 0; row < 12; row++) {
      items.push(
        item(`Left ${row}`, 72, 700 - row * 14),
        item(`Right ${row}`, 340, 700 - row * 14),
      );
    }
    const layout = layoutPage(1, items, 612, 792);
    const order = layout.lines.map((line) => line.text);
    expect(order.indexOf("Left 11")).toBeLessThan(order.indexOf("Right 0"));
  });
});

describe("office packages", () => {
  const layouts = [
    layoutPage(
      1,
      [item("Title & <Summary>", 72, 720, 24), item("Café résumé 日本", 72, 680)],
      612,
      792,
    ),
    layoutPage(2, [item("Second page", 72, 700)], 612, 792),
  ];

  it("writes valid stored ZIP archives", () => {
    const files = unzip(
      createZip([
        { name: "a.txt", data: "hello" },
        { name: "dir/ü.bin", data: new Uint8Array([0, 1, 2]) },
      ]),
    );
    expect(files.get("a.txt")).toBe("hello");
    expect([...files.keys()]).toEqual(["a.txt", "dir/ü.bin"]);
    expect(escapeXml('a<b>&"')).toBe("a&lt;b&gt;&amp;&quot;");
  });

  it("creates a DOCX with styles, escaped text and page breaks", () => {
    const files = unzip(buildDocx(layouts, "Synthetic"));
    const document = files.get("word/document.xml")!;
    expect(files.get("[Content_Types].xml")).toContain("wordprocessingml.document.main+xml");
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toContain("Title &amp; &lt;Summary&gt;");
    expect(document).toContain("Café résumé 日本");
    expect(document).toContain('<w:br w:type="page"/>');
    expect(files.get("word/styles.xml")).toContain('w:styleId="Heading1"');
  });

  it("types numbers and dates but keeps formula-like text inert", () => {
    expect(cellValue("1,234.5")).toEqual({ kind: "number", value: 1234.5 });
    expect(cellValue("(42)")).toEqual({ kind: "number", value: -42 });
    expect(cellValue("2026-09-14")).toEqual({ kind: "date", value: 46279 });
    expect(cellValue("2026-02-30").kind).toBe("text");
    expect(cellValue('=HYPERLINK("x")').kind).toBe("text");
    expect(cellValue("(42").kind).toBe("text");
    const files = unzip(
      buildXlsx([
        {
          name: "Page 1",
          rows: [
            ["Name", "Amount", "When"],
            ["=cmd|' /C calc'!A0", "12", "2026-09-14"],
          ],
        },
        { name: "Page 1", rows: [] },
      ]),
    );
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="B2"><v>12</v></c>');
    expect(sheet).toContain('<c r="C2" s="1"><v>46279</v></c>');
    expect(sheet).toContain("<is><t xml:space=\"preserve\">=cmd|' /C calc'!A0</t></is>");
    expect(sheet).not.toContain("<f>");
    expect(files.get("xl/workbook.xml")).toContain('name="Page 1 2"');
  });

  it("creates PPTX picture slides and editable text slides", () => {
    const pictures = unzip(
      buildPptx(
        [{ width: 612, height: 792, image: new Uint8Array([137, 80, 78, 71]) }],
        "Pictures",
      ),
    );
    expect(pictures.get("ppt/presentation.xml")).toContain('<p:sldSz cx="7772400" cy="10058400"/>');
    expect(pictures.get("ppt/slides/slide1.xml")).toContain('<a:blip r:embed="rId2"/>');
    expect(pictures.has("ppt/media/page1.png")).toBe(true);
    expect(pictures.get("ppt/theme/theme1.xml")).toContain("<a:fmtScheme");
    const text = unzip(
      buildPptx(
        [
          {
            width: 612,
            height: 792,
            boxes: [{ x: 72, y: 700, size: 12, text: "Editable <line>" }],
          },
          { width: 612, height: 792, boxes: [] },
        ],
        "Text",
      ),
    );
    expect(text.get("ppt/slides/slide1.xml")).toContain("<a:t>Editable &lt;line&gt;</a:t>");
    expect(text.get("ppt/_rels/presentation.xml.rels")).toContain("slides/slide2.xml");
    expect(text.has("ppt/media/page1.png")).toBe(false);
  });

  it("escapes RTF control characters and Unicode", () => {
    const rtf = buildRtf([layoutPage(1, [item("{a}\\b 日😀", 72, 700)], 612, 792), layouts[1]]);
    expect(rtf.startsWith("{\\rtf1")).toBe(true);
    expect(rtf).toContain("\\{a\\}\\\\b \\u26085?\\u-10179?\\u-8704?");
    expect(rtf).toContain("\\page");
  });
});
