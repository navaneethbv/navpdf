// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildXlsx, uniqueSheetNames, type PageLayout } from "../../src/features/convert/ooxml";
import {
  buildCsv,
  buildHtml,
  buildPlainText,
  buildSpreadsheetXml,
  buildXmlDocument,
} from "../../src/features/convert/formats";
import {
  ascii85,
  buildEps,
  buildPostScript,
  buildTiff,
  packBits,
} from "../../src/features/convert/raster";

function layout(page: number, lines: string[], heading?: string): PageLayout {
  return {
    page,
    width: 612,
    height: 792,
    lines: lines.map((text, index) => ({
      x: 72,
      y: 700 - index * 14,
      size: 11,
      cells: [{ x: 72, text }],
      text,
    })),
    paragraphs: [
      ...(heading ? [{ text: heading, heading: 1 as const }] : []),
      ...lines.map((text) => ({ text, heading: 0 as const })),
    ],
  };
}

/** Independent PackBits decoder following the TIFF 6.0 specification. */
function unpackBits(bytes: Uint8Array) {
  const out: number[] = [];
  for (let i = 0; i < bytes.length;) {
    const header = bytes[i] > 127 ? bytes[i] - 256 : bytes[i];
    i++;
    if (header >= 0) {
      out.push(...bytes.subarray(i, i + header + 1));
      i += header + 1;
    } else if (header !== -128) {
      out.push(...Array.from({ length: 1 - header }, () => bytes[i]));
      i++;
    }
  }
  return out;
}

/** Independent ASCII85 decoder. */
function decodeAscii85(text: string) {
  const body = text.replaceAll(/\s/g, "").replace(/~>$/, "");
  const out: number[] = [];
  let group: number[] = [];
  const flush = (count: number) => {
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const bytes = [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...bytes.slice(0, count));
    group = [];
  };
  for (const char of body) {
    if (char === "z") {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push((char.codePointAt(0) ?? 33) - 33);
    if (group.length === 5) flush(4);
  }
  if (group.length) {
    const count = group.length - 1;
    while (group.length < 5) group.push(84);
    flush(count);
  }
  return out;
}

describe("text-layer export formats", () => {
  it("writes plain text one reconstructed line per line with page headers", () => {
    const text = buildPlainText([layout(1, ["First line", "Second line"]), layout(2, ["Next"])]);
    expect(text).toBe("--- Page 1 ---\n\nFirst line\nSecond line\n\n--- Page 2 ---\n\nNext\n");
  });

  it("writes RFC 4180 CSV that never evaluates formula-like text", () => {
    const csv = buildCsv([
      [
        ["Name", "Amount"],
        ['a, "b"', "-12.5"],
        ["=SUM(A1:A2)", "+cmd", "@x", "-not number"],
      ],
      [["Second", "line\nbreak"]],
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Name,Amount",
      '"a, ""b""",-12.5',
      "'=SUM(A1:A2),'+cmd,'@x,'-not number",
      "",
      'Second,"line\nbreak"',
      "",
    ]);
  });

  it("writes XML Spreadsheet 2003 with typed cells, skipped columns and safe names", () => {
    const xml = buildSpreadsheetXml([
      { name: "Page 1", rows: [["Total", "", "1,250.50", "2026-09-14", "<b>&"]] },
      { name: "page 1", rows: [] },
    ]);
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('<Worksheet ss:Name="Page 1">');
    expect(xml).toContain('<Worksheet ss:Name="page 1 2">');
    expect(xml).toContain('<Cell><Data ss:Type="String">Total</Data></Cell>');
    expect(xml).toContain('<Cell ss:Index="3"><Data ss:Type="Number">1250.5</Data></Cell>');
    expect(xml).toContain(
      '<Cell ss:StyleID="date"><Data ss:Type="DateTime">2026-09-14T00:00:00.000</Data></Cell>',
    );
    expect(xml).toContain("&lt;b&gt;&amp;");
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
  });

  it("writes an inert HTML page with escaped content", () => {
    const html = buildHtml(
      [layout(1, ["<script>alert(1)</script>", "Tom's & Jerry"], "Title")],
      "a <b> 'name'",
    );
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(html).toContain("<p>Tom&#39;s &amp; Jerry</p>");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<title>a &lt;b&gt; &#39;name&#39;</title>");
    expect(html).toContain('<section class="page" id="page-1" aria-label="Page 1">');
  });

  it("writes a well-formed XML document of pages, headings and paragraphs", () => {
    const xml = buildXmlDocument(
      [layout(1, ["Body & <more>\u0001"], "Heading"), layout(2, [])],
      'Report "Q3"',
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.documentElement.getAttribute("title")).toBe('Report "Q3"');
    expect(doc.querySelectorAll("page")).toHaveLength(2);
    expect(doc.querySelector("heading")?.textContent).toBe("Heading");
    expect(doc.querySelector("paragraph")?.textContent).toBe("Body & <more>");
  });

  it("keeps sheet names unique without looping on long colliding names", () => {
    const long = `${"x".repeat(28)} 2`;
    // Names are unique case-insensitively, as spreadsheet applications require.
    expect(uniqueSheetNames([long, long, "A/B", "", "a/b"])).toEqual([
      long,
      `${long.slice(0, 29)} 2`,
      "A B",
      "Sheet4",
      "a b 2",
    ]);
    expect(() =>
      buildXlsx([
        { name: long, rows: [] },
        { name: long, rows: [] },
      ]),
    ).not.toThrow();
  });
});

/** A black page whose pixels all share one alpha value. */
function blackPage(width: number, height: number, alpha: number) {
  return {
    width,
    height,
    dpi: 300,
    rgba: new Uint8ClampedArray(width * height * 4).map((_, i) => (i % 4 === 3 ? alpha : 0)),
  };
}

describe("raster export formats", () => {
  it("encodes PackBits rows that decode back to the input", () => {
    const row = new Uint8Array([
      ...Array.from({ length: 200 }, () => 255),
      1,
      2,
      3,
      4,
      4,
      5,
      ...Array.from({ length: 150 }, (_, i) => i % 7),
      9,
      9,
      9,
    ]);
    const encoded = packBits(row).result();
    expect(unpackBits(encoded)).toEqual([...row]);
    expect(encoded.length).toBeLessThan(row.length);
  });

  it("writes a little-endian multipage TIFF with one directory per page", () => {
    const tiff = buildTiff([blackPage(3, 2, 255), blackPage(2, 70, 0)]);
    const view = new DataView(tiff.buffer);
    expect([...tiff.subarray(0, 4)]).toEqual([0x49, 0x49, 42, 0]);
    const directories: Map<number, number[]>[] = [];
    for (let offset = view.getUint32(4, true); offset;) {
      const tags = new Map<number, number[]>();
      const count = view.getUint16(offset, true);
      for (let i = 0; i < count; i++) {
        const entry = offset + 2 + i * 12;
        const type = view.getUint16(entry + 2, true);
        tags.set(view.getUint16(entry, true), [
          type,
          view.getUint32(entry + 4, true),
          type === 3 ? view.getUint16(entry + 8, true) : view.getUint32(entry + 8, true),
        ]);
      }
      const tagNumbers = [...tags.keys()];
      // TIFF readers require directory entries in ascending tag order.
      expect(tagNumbers.every((tag, i) => i === 0 || tagNumbers[i - 1] < tag)).toBe(true);
      directories.push(tags);
      offset = view.getUint32(offset + 2 + count * 12, true);
    }
    expect(directories).toHaveLength(2);
    expect(directories[0].get(256)?.[2]).toBe(3);
    expect(directories[1].get(257)?.[2]).toBe(70);
    expect(directories[0].get(259)?.[2]).toBe(32773);
    // 70 rows in strips of 64 rows need two strips.
    expect(directories[1].get(273)?.[1]).toBe(2);
    // Black opaque pixels stay black; transparent pixels become white.
    const first = directories[0].get(273)?.[2] ?? 0;
    const firstLength = directories[0].get(279)?.[2] ?? 0;
    expect(unpackBits(tiff.subarray(first, first + firstLength))).toEqual(
      Array.from({ length: 18 }, () => 0),
    );
    const resolution = directories[0].get(282)?.[2] ?? 0;
    expect(view.getUint32(resolution, true) / view.getUint32(resolution + 4, true)).toBe(300);
    expect(() => buildTiff([])).toThrow(/No pages/);
  });

  it("encodes ASCII85 with zero groups, partial groups and safe line starts", () => {
    expect(ascii85(new TextEncoder().encode("Man "))).toBe("9jqo^~>");
    expect(ascii85(new Uint8Array([0, 0, 0, 0, 1]))).toBe("z!<~>");
    const data = Uint8Array.from({ length: 2000 }, (_, i) => (i * 37 + 11) % 256);
    const encoded = ascii85(data);
    expect(decodeAscii85(encoded)).toEqual([...data]);
    expect(encoded.split("\n").every((line) => !line.startsWith("%"))).toBe(true);
    expect(encoded.split("\n").every((line) => line.length <= 80)).toBe(true);
  });

  it("writes DSC-conforming PostScript and single-page EPS", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pages = [
      { jpeg, pixelWidth: 10, pixelHeight: 20, width: 612, height: 792 },
      { jpeg, pixelWidth: 20, pixelHeight: 10, width: 792.25, height: 612 },
    ];
    const ps = buildPostScript(pages, "Résumé\nreport");
    expect(ps.startsWith("%!PS-Adobe-3.0\n")).toBe(true);
    expect(ps).toContain("%%Title: R?sum??report");
    expect(ps).toContain("%%Pages: 2");
    expect(ps).toContain("%%BoundingBox: 0 0 793 792");
    expect(ps).toContain("%%Page: 2 2\n%%PageBoundingBox: 0 0 793 612");
    expect(ps).toContain("<< /PageSize [792.25 612] >> setpagedevice");
    expect(ps).toContain("/ImageMatrix [20 0 0 -10 0 10]");
    expect(ps.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(() => buildPostScript([], "x")).toThrow(/No pages/);

    const eps = buildEps(pages[0], "page");
    expect(eps.startsWith("%!PS-Adobe-3.0 EPSF-3.0\n")).toBe(true);
    expect(eps).toContain("%%BoundingBox: 0 0 612 792");
    expect(eps).not.toContain("setpagedevice");
  });
});
