// Guided actions: built-in step sequences, step descriptions and the runner that applies a
// sequence to one document's bytes. Every step runs locally; OCR, compression, tagging and
// PDF/A use the native engine.

import {
  applyDocumentDecorations,
  type DocumentDecorationsOptions,
} from "../../services/document-commands";
import {
  compressDocument,
  editStandards,
  editTags,
  newJobId,
  readTags,
} from "../../services/engine";
import { flattenDocument } from "../../services/pdf/flatten";
import { readMetadata, writeMetadata } from "../../services/pdf/metadata";
import { ocrFile } from "../ocr/OcrBatchDialog";
import { NO_PREPROCESSING } from "../ocr/ocr-pages";
import type { DiscardOptions } from "../../types/engine";
import type { ActionStep, SavedAction } from "../../types/document";

export const STEP_LABELS: Record<ActionStep["kind"], string> = {
  watermark: "Add a text watermark",
  headerFooter: "Add a header and footer",
  metadata: "Set document properties",
  flatten: "Flatten comments and form fields",
  removeHidden: "Remove hidden information",
  compress: "Reduce file size",
  ocr: "Recognize text (OCR)",
  autotag: "Tag for accessibility",
  pdfa: "Convert to PDF/A",
};

/** Hidden content removed by the Remove hidden information step. */
const HIDDEN_INFORMATION: DiscardOptions = {
  javascript: true,
  thumbnails: true,
  tags: false,
  bookmarks: false,
  printSettings: true,
  alternateImages: true,
  comments: false,
  multimedia: true,
  metadata: false,
  attachments: false,
  privateData: true,
};

/** A step with default options, for adding to an action. */
export function newStep(kind: ActionStep["kind"], language: string): ActionStep {
  switch (kind) {
    case "watermark":
      return { kind, text: "DRAFT", opacity: 0.25, fontSize: 60 };
    case "headerFooter":
      return { kind, header: "{title}", footer: "Page {page} of {total}" };
    case "metadata":
      return { kind, title: "", author: "", subject: "", keywords: "" };
    case "compress":
      return { kind, preset: "balanced" };
    case "ocr":
      return { kind, language, skipTextPages: true };
    case "pdfa":
      return { kind, level: "2b" };
    default:
      return { kind };
  }
}

/** What a step does, in a sentence, for the guide shown before running. */
export function describeStep(step: ActionStep): string {
  switch (step.kind) {
    case "watermark":
      return `Draws "${step.text}" across every page at ${Math.round(step.opacity * 100)}% opacity, replacing a watermark NavPDF added before.`;
    case "headerFooter":
      return `Adds "${step.header}" at the top and "${step.footer}" at the bottom of each page, replacing ones NavPDF added before.`;
    case "metadata": {
      const set = [
        step.title && "title",
        step.author && "author",
        step.subject && "subject",
        step.keywords && "keywords",
      ].filter(Boolean);
      return set.length
        ? `Sets the ${set.join(", ")}.`
        : "Leaves the document properties as they are.";
    }
    case "flatten":
      return "Draws comments and form fields into the pages so they can no longer be changed.";
    case "removeHidden":
      return "Removes scripts, thumbnails, print settings, alternate images, multimedia and private application data.";
    case "compress":
      return `Compresses with the ${step.preset} preset; the result is kept only when it is smaller.`;
    case "ocr":
      return `Adds searchable text in ${step.language}${step.skipTextPages ? ", skipping pages that already have text" : ""}. Requires the macOS app.`;
    case "autotag":
      return "Tags an untagged document automatically; documents that already have tags are left as they are.";
    default:
      return `Converts to PDF/A-${step.level} when every problem can be fixed; otherwise the action stops.`;
  }
}

/** Ready-made actions; they can be run or copied but not edited. */
export const BUILT_IN_ACTIONS: readonly SavedAction[] = [
  {
    id: "builtin-archive",
    name: "Prepare for archiving",
    steps: [{ kind: "removeHidden" }, { kind: "pdfa", level: "2b" }],
  },
  {
    id: "builtin-accessible",
    name: "Make searchable and accessible",
    steps: [{ kind: "ocr", language: "en-US", skipTextPages: true }, { kind: "autotag" }],
  },
  {
    id: "builtin-distribute",
    name: "Prepare for distribution",
    steps: [
      { kind: "flatten" },
      { kind: "removeHidden" },
      { kind: "compress", preset: "balanced" },
    ],
  },
  {
    id: "builtin-draft",
    name: "Mark as draft",
    steps: [
      { kind: "watermark", text: "DRAFT", opacity: 0.25, fontSize: 60 },
      { kind: "headerFooter", header: "", footer: "Draft, page {page} of {total}" },
    ],
  },
];

export interface StepContext {
  name: string;
  /** Watermarks, headers and footers added so far in this run, drawn again together. */
  decorations?: DocumentDecorationsOptions;
  cancelled: () => boolean;
  /** Reports progress inside a long step, such as OCR pages. */
  onProgress: (detail: string) => void;
}

const asBytes = (bytes: Uint8Array) => new Uint8Array(bytes);

type Step<K extends ActionStep["kind"]> = Extract<ActionStep, { kind: K }>;

/** Draws this run's watermark, header and footer together, replacing earlier NavPDF ones. */
async function decorate(
  bytes: Uint8Array,
  step: Step<"watermark" | "headerFooter">,
  context: StepContext,
) {
  const decorations = context.decorations ?? {};
  if (step.kind === "watermark") {
    decorations.watermark = { text: step.text, opacity: step.opacity, fontSize: step.fontSize };
  } else {
    const metadata = await readMetadata(bytes);
    decorations.header = step.header.trim() ? { center: step.header } : undefined;
    decorations.footer = step.footer.trim() ? { center: step.footer } : undefined;
    decorations.metadata = {
      title: metadata.title || context.name.replace(/\.pdf$/i, ""),
      author: metadata.author,
      date: new Date().toLocaleDateString(),
    };
  }
  return applyDocumentDecorations(bytes, decorations);
}

/** Sets the step's non-empty properties and keeps the document's others. */
async function setProperties(bytes: Uint8Array, step: Step<"metadata">) {
  const metadata = await readMetadata(bytes);
  const keywords = step.keywords
    .split(/[,;]\s*/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  return writeMetadata(bytes, {
    ...metadata,
    title: step.title || metadata.title,
    author: step.author || metadata.author,
    subject: step.subject || metadata.subject,
    keywords: keywords.length ? keywords : metadata.keywords,
    modified: new Date(),
  });
}

async function runStep(bytes: Uint8Array, step: ActionStep, context: StepContext) {
  switch (step.kind) {
    case "watermark":
    case "headerFooter":
      return { bytes: await decorate(bytes, step, context) };
    case "metadata":
      return { bytes: await setProperties(bytes, step) };
    case "flatten":
      return { bytes: (await flattenDocument(bytes, { annotations: true, forms: true })).bytes };
    case "removeHidden": {
      const result = await compressDocument(bytes, "lossless", newJobId(), HIDDEN_INFORMATION);
      return { bytes: result.bytes ?? bytes };
    }
    case "compress": {
      const result = await compressDocument(bytes, step.preset, newJobId());
      return result.bytes
        ? { bytes: result.bytes }
        : { bytes, note: "Already compact; left as it was." };
    }
    case "ocr": {
      const file = new File([asBytes(bytes)], context.name, { type: "application/pdf" });
      const result = await ocrFile(
        file,
        {
          language: step.language,
          skipTextPages: step.skipTextPages,
          preprocessing: NO_PREPROCESSING,
        },
        context.cancelled,
        (page, total) => context.onProgress(`page ${page} of ${total}`),
      );
      return result.bytes
        ? { bytes: result.bytes }
        : { bytes, note: "No page needed recognition." };
    }
    case "autotag": {
      if ((await readTags(bytes)).tagged) return { bytes, note: "Already tagged; left as it was." };
      const result = await editTags(bytes, { action: "autotag" });
      return { bytes: result.bytes ?? bytes };
    }
    default: {
      const result = await editStandards(bytes, { action: "convert", level: step.level });
      return { bytes: result.bytes ?? bytes };
    }
  }
}

export interface ActionOutcome {
  bytes: Uint8Array;
  notes: string[];
}

/**
 * Applies each step in order. A failing step stops the action and names the step, so a file is
 * never half processed without saying so.
 */
export async function runAction(
  bytes: Uint8Array,
  action: SavedAction,
  context: StepContext & { onStep: (index: number) => void },
): Promise<ActionOutcome> {
  const notes: string[] = [];
  const run = { ...context, decorations: {} };
  const apply = async (current: Uint8Array, step: ActionStep, index: number) => {
    if (context.cancelled()) throw new Error("The action was cancelled.");
    context.onStep(index);
    try {
      const result: { bytes: Uint8Array; note?: string } = await runStep(current, step, run);
      if (result.note) notes.push(`${STEP_LABELS[step.kind]}: ${result.note}`);
      return result.bytes;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Step ${index + 1}, ${STEP_LABELS[step.kind]}: ${message}`, { cause });
    }
  };
  // Each step works on the previous step's output, so the steps are chained.
  const result = await action.steps.reduce<Promise<Uint8Array>>(
    async (previous, step, index) => apply(await previous, step, index),
    Promise.resolve(bytes),
  );
  return { bytes: result, notes };
}
