import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFContext, PDFRawStream } from "pdf-lib";
import { decodeBoundedStream } from "../../src/services/pdf/bounded-stream";

function stream(bytes: Uint8Array, filter?: string | string[]) {
  const context = PDFContext.create();
  return PDFRawStream.of(context.obj(filter ? { Filter: filter } : {}), bytes);
}

describe("bounded PDF decompression", () => {
  it("rejects a small compressed stream before its full expanded output is allocated", () => {
    const compressed = deflateSync(new Uint8Array(1024 * 1024));
    expect(() => decodeBoundedStream(stream(compressed, "FlateDecode"), 2048)).toThrow(/size/);
  });
  it("preserves exact-boundary Flate output and stored attachments", () => {
    const bytes = new Uint8Array(2048).fill(97);
    expect(decodeBoundedStream(stream(deflateSync(bytes), "FlateDecode"), 2048)).toEqual(bytes);
    expect(decodeBoundedStream(stream(bytes), 2048)).toEqual(bytes);
    expect(() => decodeBoundedStream(stream(bytes), 2047)).toThrow(/size/);
  });
  it("bounds intermediate filter output even when the final filter would discard it", () => {
    const expanded = new TextEncoder().encode(" ".repeat(10000) + "61>");
    expect(() =>
      decodeBoundedStream(stream(deflateSync(expanded), ["FlateDecode", "ASCIIHexDecode"]), 2048),
    ).toThrow(/size/);
  });
  it.each([
    ["ASCIIHexDecode", new TextEncoder().encode("616263>"), "abc"],
    ["ASCII85Decode", new TextEncoder().encode("@:E^~>"), "abc"],
    ["RunLengthDecode", new Uint8Array([2, 97, 98, 99, 128]), "abc"],
    // Nine-bit LZW codes: clear, a, b, c, EOD.
    ["LZWDecode", new Uint8Array([128, 24, 76, 70, 56, 8]), "abc"],
  ] as const)("decodes supported %s data with a bounded allocation", (filter, bytes, expected) => {
    expect(new TextDecoder().decode(decodeBoundedStream(stream(bytes, filter), 32))).toBe(expected);
  });
  it("rejects excessive chains and unknown encodings", () => {
    expect(() =>
      decodeBoundedStream(stream(new Uint8Array(), Array(9).fill("FlateDecode")), 32),
    ).toThrow(/too many/);
    expect(() => decodeBoundedStream(stream(new Uint8Array(), "Unknown"), 32)).toThrow();
  });
});
