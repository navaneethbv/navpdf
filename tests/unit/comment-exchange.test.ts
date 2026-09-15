import { describe, expect, it } from "vitest";
import { createCommentExchange, parseCommentExchange } from "../../src/services/comment-exchange";

const comment = {
  id: "a1",
  page: 1,
  type: "Square",
  text: "Sample note",
  rect: [10, 20, 100, 120] as [number, number, number, number],
  line: [10, 20, 100, 120] as [number, number, number, number],
  color: [0.1, 0.2, 0.3] as [number, number, number],
  width: 2,
  opacity: 0.5,
};

describe("local comment exchange", () => {
  it("round-trips comments with document identity and geometry", () => {
    const exchange = createCommentExchange("document-1", 4, [comment]);
    expect(parseCommentExchange(JSON.stringify(exchange), 4)).toEqual(exchange);
  });

  it("handles comments with minimal optional fields", () => {
    const minimal = {
      id: "a2",
      page: 2,
      type: "Text",
      text: "Minimal note",
    };
    const exchange = createCommentExchange("doc-2", 3, [minimal]);
    const parsed = parseCommentExchange(JSON.stringify(exchange), 3);
    expect(parsed.comments[0]).toEqual(minimal);
  });

  it("rejects invalid JSON or non-object payloads", () => {
    expect(() => parseCommentExchange("not json", 4)).toThrow(
      "The comment file is not valid JSON.",
    );
    expect(() => parseCommentExchange("null", 4)).toThrow(
      "The comment file has an invalid format.",
    );
    expect(() => parseCommentExchange('"string"', 4)).toThrow(
      "The comment file has an invalid format.",
    );
  });

  it("rejects mismatched schemas, versions, or missing documentId", () => {
    const base = createCommentExchange("document-1", 4, [comment]);
    expect(() => parseCommentExchange(JSON.stringify({ ...base, schema: "other" }), 4)).toThrow(
      "This is not a NavPDF comment exchange file.",
    );
    expect(() => parseCommentExchange(JSON.stringify({ ...base, version: 3 }), 4)).toThrow(
      "This is not a NavPDF comment exchange file.",
    );
    expect(() => parseCommentExchange(JSON.stringify({ ...base, documentId: "" }), 4)).toThrow(
      "The comment file has no document identity.",
    );
    expect(() => parseCommentExchange(JSON.stringify({ ...base, documentId: 123 }), 4)).toThrow(
      "The comment file has no document identity.",
    );
  });

  it("rejects layout mismatches and missing comment arrays", () => {
    const base = createCommentExchange("document-1", 4, [comment]);
    expect(() => parseCommentExchange(JSON.stringify({ ...base, pageCount: 5 }), 4)).toThrow(
      "These comments were exported from a different page layout.",
    );
    expect(() => parseCommentExchange(JSON.stringify({ ...base, comments: null }), 4)).toThrow(
      "The comment file has no comments.",
    );
  });

  it("rejects invalid or duplicate comments", () => {
    const base = createCommentExchange("document-1", 4, [comment]);
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: ["not-obj"] }), 4),
    ).toThrow("The comment file contains an invalid comment.");
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: [{ ...comment }, comment] }), 4),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: [{ ...comment, id: "" }] }), 4),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, type: "Unknown" }] }),
        4,
      ),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: [{ ...comment, page: 0 }] }), 4),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: [{ ...comment, page: 9 }] }), 4),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: [{ ...comment, page: 1.5 }] }), 4),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: [{ ...comment, text: 123 }] }), 4),
    ).toThrow(/invalid or duplicate/);
  });

  it("rejects invalid geometry, color, opacity, and width", () => {
    const base = createCommentExchange("document-1", 4, [comment]);
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, rect: [1, 2, 3] }] }),
        4,
      ),
    ).toThrow("The comment file contains invalid annotation geometry.");
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, line: [1, 2, 3] }] }),
        4,
      ),
    ).toThrow("The comment file contains invalid line geometry.");
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, color: [1, 2] }] }),
        4,
      ),
    ).toThrow("The comment file contains an invalid annotation color.");
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, opacity: -0.1 }] }),
        4,
      ),
    ).toThrow("The comment file contains an invalid opacity.");
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, opacity: 1.5 }] }),
        4,
      ),
    ).toThrow("The comment file contains an invalid opacity.");
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: [{ ...comment, width: 0.1 }] }), 4),
    ).toThrow("The comment file contains an invalid stroke width.");
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: [{ ...comment, width: 25 }] }), 4),
    ).toThrow("The comment file contains an invalid stroke width.");
  });

  it("round-trips Arrow comments with lineEndings and highlights with quads", () => {
    const arrowComment = {
      id: "arrow-1",
      page: 1,
      type: "Arrow",
      text: "Arrow comment",
      rect: [100, 200, 300, 200] as [number, number, number, number],
      line: [100, 200, 300, 200] as [number, number, number, number],
      lineEndings: ["None", "OpenArrow"] as [string, string],
      width: 4,
    };
    const highlightWithQuads = {
      id: "hl-1",
      page: 1,
      type: "Highlight",
      text: "Multi-line text",
      rect: [50, 600, 450, 640] as [number, number, number, number],
      quads: [
        [50, 620, 450, 640],
        [50, 600, 250, 620],
      ],
      color: [1, 0.9, 0.2] as [number, number, number],
      opacity: 0.4,
    };

    const exchange = createCommentExchange("doc-fidelity", 2, [arrowComment, highlightWithQuads]);
    const parsed = parseCommentExchange(JSON.stringify(exchange), 2);
    expect(parsed.comments).toHaveLength(2);
    expect(parsed.comments[0]).toEqual(arrowComment);
    expect(parsed.comments[1]).toEqual(highlightWithQuads);
  });

  it("exports comments with content identity and imports across sessions for the same document", async () => {
    const { contentIdentity } = await import("../../src/services/document-identity");

    const pdfA = {
      numPages: 5,
      getMetadata: async () => ({ info: { ID: ["trailer-id-12345", "trailer-id-12345"] } }),
    };
    const identityA = await contentIdentity(pdfA);

    const exchange = createCommentExchange("session-uuid-1", 5, [comment], identityA);
    const serialized = JSON.stringify(exchange);

    // Simulate reloading the same document in a new session (different documentId, same contentIdentity)
    const parsedSameDoc = parseCommentExchange(serialized, 5, identityA);
    expect(parsedSameDoc.comments).toHaveLength(1);
    expect(parsedSameDoc.version).toBe(2);

    // Simulate importing into a different document
    const pdfB = {
      numPages: 5,
      getMetadata: async () => ({ info: { ID: ["different-trailer-id", "different-trailer-id"] } }),
    };
    const identityB = await contentIdentity(pdfB);
    expect(() => parseCommentExchange(serialized, 5, identityB)).toThrow(
      "These comments belong to a different document.",
    );
  });

  it("derives identity from the PDF.js fingerprint when the info dictionary has no ID", async () => {
    const { contentIdentity } = await import("../../src/services/document-identity");
    const noId = async () => ({ info: {} });
    const first = await contentIdentity({
      numPages: 3,
      fingerprints: ["abc", null],
      getMetadata: noId,
    });
    const reopened = await contentIdentity({
      numPages: 3,
      fingerprints: ["abc", null],
      getMetadata: noId,
    });
    const other = await contentIdentity({
      numPages: 3,
      fingerprints: ["def", null],
      getMetadata: noId,
    });
    expect(first).toBe(reopened);
    expect(first).not.toBe(other);
  });

  it("accepts legacy version 1 comments when page count matches and includes a warning", () => {
    const legacyV1 = {
      schema: "navpdf-comments",
      version: 1,
      documentId: "legacy-session-doc",
      pageCount: 4,
      comments: [comment],
    };
    const parsed = parseCommentExchange(JSON.stringify(legacyV1), 4, "any-identity:4");
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.warning).toContain("legacy version 1");
  });
});
