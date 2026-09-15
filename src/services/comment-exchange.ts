import type { Comment } from "../types/document";

const supportedTypes = new Set([
  "Text",
  "Highlight",
  "Underline",
  "StrikeOut",
  "Square",
  "Circle",
  "Line",
  "Arrow",
]);

export interface CommentExchange {
  schema: "navpdf-comments";
  version: 1 | 2;
  documentId?: string;
  identity?: string;
  pageCount: number;
  comments: Comment[];
  warning?: string;
}

export function createCommentExchange(
  documentId: string,
  pageCount: number,
  comments: Comment[],
  identity?: string,
): CommentExchange {
  return {
    schema: "navpdf-comments",
    version: 2,
    documentId,
    identity: identity ?? (documentId.includes(":") ? documentId : undefined),
    pageCount,
    comments: comments.map((comment) => ({ ...comment })),
  };
}

function finiteTuple(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export function parseCommentExchange(
  source: string,
  expectedPageCount: number,
  expectedIdentity?: string,
): CommentExchange {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("The comment file is not valid JSON.");
  }
  if (!value || typeof value !== "object")
    throw new Error("The comment file has an invalid format.");
  const input = value as Partial<CommentExchange>;
  if (
    input.schema !== "navpdf-comments" ||
    (input.version !== 1 && input.version !== 2)
  )
    throw new Error("This is not a NavPDF comment exchange file.");
  const hasId =
    (typeof input.documentId === "string" && input.documentId.length > 0) ||
    (typeof input.identity === "string" && input.identity.length > 0);
  if (!hasId) throw new Error("The comment file has no document identity.");
  if (input.pageCount !== expectedPageCount)
    throw new Error("These comments were exported from a different page layout.");
  if (
    input.version === 2 &&
    expectedIdentity &&
    input.identity &&
    input.identity !== expectedIdentity
  ) {
    throw new Error("These comments belong to a different document.");
  }
  if (!Array.isArray(input.comments))
    throw new Error("The comment file has no comments.");
  const ids = new Set<string>();
  const comments: Comment[] = [];
  for (const raw of input.comments) {
    if (!raw || typeof raw !== "object")
      throw new Error("The comment file contains an invalid comment.");
    const comment = raw as Partial<Comment>;
    if (
      typeof comment.id !== "string" ||
      !comment.id ||
      ids.has(comment.id) ||
      typeof comment.type !== "string" ||
      !supportedTypes.has(comment.type) ||
      typeof comment.page !== "number" ||
      !Number.isInteger(comment.page) ||
      comment.page < 1 ||
      comment.page > expectedPageCount ||
      typeof comment.text !== "string"
    )
      throw new Error("The comment file contains an invalid or duplicate comment.");
    if (comment.rect !== undefined && !finiteTuple(comment.rect, 4))
      throw new Error("The comment file contains invalid annotation geometry.");
    if (comment.line !== undefined && !finiteTuple(comment.line, 4))
      throw new Error("The comment file contains invalid line geometry.");
    if (
      comment.lineEndings !== undefined &&
      (!Array.isArray(comment.lineEndings) ||
        comment.lineEndings.length !== 2 ||
        !comment.lineEndings.every((s) => typeof s === "string"))
    )
      throw new Error("The comment file contains invalid line endings.");
    if (
      comment.quads !== undefined &&
      (!Array.isArray(comment.quads) ||
        !comment.quads.every((q) => finiteTuple(q, 4) || finiteTuple(q, 8)))
    )
      throw new Error("The comment file contains invalid text markup quads.");
    if (comment.color !== undefined && !finiteTuple(comment.color, 3))
      throw new Error("The comment file contains an invalid annotation color.");
    if (
      comment.opacity !== undefined &&
      (typeof comment.opacity !== "number" ||
        !Number.isFinite(comment.opacity) ||
        comment.opacity < 0 ||
        comment.opacity > 1)
    )
      throw new Error("The comment file contains an invalid opacity.");
    if (
      comment.width !== undefined &&
      (typeof comment.width !== "number" ||
        !Number.isFinite(comment.width) ||
        comment.width < 0.5 ||
        comment.width > 20)
    )
      throw new Error("The comment file contains an invalid stroke width.");
    ids.add(comment.id);
    comments.push({
      id: comment.id,
      page: comment.page,
      type: comment.type,
      text: comment.text,
      ...(comment.rect ? { rect: comment.rect as Comment["rect"] } : {}),
      ...(comment.line ? { line: comment.line as Comment["line"] } : {}),
      ...(comment.lineEndings
        ? { lineEndings: comment.lineEndings as [string, string] }
        : {}),
      ...(comment.quads ? { quads: comment.quads as number[][] } : {}),
      ...(comment.color ? { color: comment.color as Comment["color"] } : {}),
      ...(typeof comment.opacity === "number" && Number.isFinite(comment.opacity)
        ? { opacity: comment.opacity }
        : {}),
      ...(typeof comment.width === "number" && Number.isFinite(comment.width)
        ? { width: comment.width }
        : {}),
    });
  }
  return {
    schema: "navpdf-comments",
    version: input.version ?? 2,
    documentId: input.documentId,
    identity: input.identity,
    pageCount: expectedPageCount,
    comments,
    ...(input.version === 1
      ? { warning: "Imported legacy version 1 comments matching by page count." }
      : {}),
  };
}
