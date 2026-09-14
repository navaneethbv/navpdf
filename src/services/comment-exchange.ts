import type { Comment } from "../types/document";

const supportedTypes = new Set([
  "Text",
  "Highlight",
  "Underline",
  "StrikeOut",
  "Square",
  "Circle",
  "Line",
]);

export interface CommentExchange {
  schema: "navpdf-comments";
  version: 1;
  documentId: string;
  pageCount: number;
  comments: Comment[];
}

export function createCommentExchange(
  documentId: string,
  pageCount: number,
  comments: Comment[],
): CommentExchange {
  return {
    schema: "navpdf-comments",
    version: 1,
    documentId,
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
  if (input.schema !== "navpdf-comments" || input.version !== 1)
    throw new Error("This is not a NavPDF comment exchange file.");
  if (typeof input.documentId !== "string" || !input.documentId)
    throw new Error("The comment file has no document identity.");
  if (input.pageCount !== expectedPageCount)
    throw new Error("These comments were exported from a different page layout.");
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
    version: 1,
    documentId: input.documentId,
    pageCount: expectedPageCount,
    comments,
  };
}
