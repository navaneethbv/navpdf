import { describe, expect, it } from "vitest";
import {
  createCommentExchange,
  parseCommentExchange,
} from "../../src/services/comment-exchange";

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
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, schema: "other" }), 4),
    ).toThrow("This is not a NavPDF comment exchange file.");
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, version: 2 }), 4),
    ).toThrow("This is not a NavPDF comment exchange file.");
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, documentId: "" }), 4),
    ).toThrow("The comment file has no document identity.");
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, documentId: 123 }), 4),
    ).toThrow("The comment file has no document identity.");
  });

  it("rejects layout mismatches and missing comment arrays", () => {
    const base = createCommentExchange("document-1", 4, [comment]);
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, pageCount: 5 }), 4),
    ).toThrow("These comments were exported from a different page layout.");
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: null }), 4),
    ).toThrow("The comment file has no comments.");
  });

  it("rejects invalid or duplicate comments", () => {
    const base = createCommentExchange("document-1", 4, [comment]);
    expect(() =>
      parseCommentExchange(JSON.stringify({ ...base, comments: ["not-obj"] }), 4),
    ).toThrow("The comment file contains an invalid comment.");
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment }, comment] }),
        4,
      ),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, id: "" }] }),
        4,
      ),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, type: "Unknown" }] }),
        4,
      ),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, page: 0 }] }),
        4,
      ),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, page: 9 }] }),
        4,
      ),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, page: 1.5 }] }),
        4,
      ),
    ).toThrow(/invalid or duplicate/);
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, text: 123 }] }),
        4,
      ),
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
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, width: 0.1 }] }),
        4,
      ),
    ).toThrow("The comment file contains an invalid stroke width.");
    expect(() =>
      parseCommentExchange(
        JSON.stringify({ ...base, comments: [{ ...comment, width: 25 }] }),
        4,
      ),
    ).toThrow("The comment file contains an invalid stroke width.");
  });
});
