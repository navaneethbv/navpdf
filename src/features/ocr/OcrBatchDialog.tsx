import { useEffect, useRef, useState } from "react";
import { Scan } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { native, ocrGetEngineInfo, ocrRecognizePage } from "../../services/native";
import { loadPdfFromBytes } from "../../services/pdf";
import { applyOcrSearchableLayer, detectExistingText } from "../../services/document-commands";
import { createZip } from "../convert/ooxml";
import { downloadBlob } from "../../utils/download";
import { useWorkspace } from "../../stores/workspace";
import { mapInOrder } from "../../utils/async-sequence";
import { uniqueName } from "../../utils/unique-name";
import type { OcrPageResult } from "../../types/operations";
import {
  NO_PREPROCESSING,
  PREPROCESSING_LABELS,
  pageImage,
  type OcrPreprocessing,
} from "./ocr-pages";

const MAX_FILES = 50;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

export interface BatchOcrOptions {
  language: string;
  skipTextPages: boolean;
  preprocessing: OcrPreprocessing;
}

export interface BatchOcrOutcome {
  /** Distinguishes results for files that share a name. */
  id?: string;
  name: string;
  /** Searchable copy, or null when the file failed or needed no recognition. */
  bytes: Uint8Array | null;
  pages: number;
  skipped: number;
  error?: string;
}

/** Adds a searchable text layer to every page of one PDF that needs it. */
export async function ocrFile(
  file: File,
  options: BatchOcrOptions,
  cancelled: () => boolean,
  onPage: (page: number, total: number) => void,
): Promise<BatchOcrOutcome> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Files are limited to 200 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = loadPdfFromBytes(new Uint8Array(bytes));
  try {
    const pdf = await task.promise.catch(() => {
      throw new Error("The PDF could not be opened; password-protected files are not supported.");
    });
    const ensureCurrent = () => {
      if (cancelled()) throw new Error("OCR cancelled.");
    };
    // Null marks a page skipped because it already has text.
    const recognize = async (pageIndex: number): Promise<OcrPageResult | null> => {
      ensureCurrent();
      if (options.skipTextPages && (await detectExistingText(bytes, pageIndex))) return null;
      onPage(pageIndex + 1, pdf.numPages);
      const image = await pageImage(pdf, pageIndex + 1, ensureCurrent, options.preprocessing);
      return ocrRecognizePage(image, { pageIndex, language: options.language });
    };
    const results: OcrPageResult[] = [];
    let skipped = 0;
    const indexes = Array.from({ length: pdf.numPages }, (_, index) => index);
    for await (const result of mapInOrder(indexes, recognize)) {
      if (result) results.push(result);
      else skipped++;
    }
    ensureCurrent();
    return {
      name: file.name,
      bytes: results.length ? await applyOcrSearchableLayer(bytes, results) : null,
      pages: results.length,
      skipped,
    };
  } finally {
    await task.destroy();
  }
}

const outputName = (name: string, used: Set<string>) => {
  const base = `${name.replace(/\.pdf$/i, "") || "Document"} (OCR)`;
  return uniqueName((copy) => (copy === 1 ? `${base}.pdf` : `${base} ${copy}.pdf`), used);
};

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function outcomeText(outcome: BatchOcrOutcome) {
  if (outcome.error) return outcome.error;
  const skipped = outcome.skipped ? `, ${outcome.skipped} skipped with existing text` : "";
  return `${outcome.pages} page(s) recognized${skipped}`;
}

/** Saves the searchable copies as one ZIP archive and returns the status to show. */
async function saveOutcomes(done: BatchOcrOutcome[]) {
  const used = new Set<string>();
  const entries = done.flatMap((outcome) =>
    outcome.bytes ? [{ name: outputName(outcome.name, used), data: outcome.bytes }] : [],
  );
  if (!entries.length) throw new Error("No file needed or produced a searchable layer.");
  const saved = await downloadBlob(
    new Blob([createZip(entries)], { type: "application/zip" }),
    `OCR-${Date.now()}.zip`,
  );
  return saved ? `Saved ${entries.length} searchable PDF(s) in a ZIP archive` : "Save cancelled";
}

export function OcrBatchDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const s = useWorkspace();
  const [files, setFiles] = useState<File[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [language, setLanguage] = useState(s.local.preferences.ocrLanguage);
  const [skipTextPages, setSkipTextPages] = useState(true);
  const [preprocessing, setPreprocessing] = useState<OcrPreprocessing>(NO_PREPROCESSING);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [outcomes, setOutcomes] = useState<BatchOcrOutcome[]>([]);
  const [error, setError] = useState("");
  const cancelled = useRef(false);

  useEffect(() => {
    if (native)
      ocrGetEngineInfo()
        .then((info) => {
          setLanguages(info.supportedLanguages);
          setLanguage((current) =>
            info.supportedLanguages.includes(current)
              ? current
              : (info.supportedLanguages[0] ?? current),
          );
        })
        .catch((cause: unknown) => setError(errorText(cause)));
    return () => {
      cancelled.current = true;
    };
  }, []);

  const recognizeFile = (file: File, index: number) =>
    ocrFile(
      file,
      { language, skipTextPages, preprocessing },
      () => cancelled.current,
      (page, total) =>
        setProgress(`File ${index + 1} of ${files.length}, page ${page} of ${total}: ${file.name}`),
    ).catch((cause: unknown): BatchOcrOutcome => ({
      name: file.name,
      bytes: null,
      pages: 0,
      skipped: 0,
      error: errorText(cause),
    }));

  const run = async () => {
    cancelled.current = false;
    setRunning(true);
    setError("");
    setOutcomes([]);
    const done: BatchOcrOutcome[] = [];
    try {
      for await (const outcome of mapInOrder(files.entries(), ([index, file]) =>
        recognizeFile(file, index),
      )) {
        if (cancelled.current) break;
        done.push({ ...outcome, id: crypto.randomUUID() });
        setOutcomes([...done]);
      }
      if (cancelled.current) s.set({ status: "Multi-file OCR cancelled. Nothing was saved." });
      else s.set({ status: await saveOutcomes(done) });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  return (
    <ToolDialog
      title="OCR Multiple Files"
      icon={<Scan size={18} />}
      onClose={onClose}
      busy={running}
      error={error}
      primaryLabel="Recognize & Save ZIP"
      busyLabel="Recognizing..."
      primaryDisabled={!native || files.length === 0}
      onPrimary={() => void run()}
      secondary={
        running && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              cancelled.current = true;
              setProgress("Cancelling after the current page...");
            }}
          >
            Cancel OCR
          </button>
        )
      }
    >
      <p className="field-hint">
        Each PDF gets an invisible, searchable text layer over its pages, recognized on this device.
        The originals are not changed; the searchable copies are saved together as a ZIP archive.
      </p>
      {!native && <p className="error-text">OCR requires the native macOS application.</p>}
      <label className="setting-group">
        <span className="setting-title">PDF files (up to {MAX_FILES})</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={running}
          aria-label="PDF files"
          onChange={(event) => {
            const chosen = [...(event.target.files ?? [])];
            event.target.value = "";
            if (chosen.length > MAX_FILES) setError(`Choose at most ${MAX_FILES} files.`);
            else setError("");
            setFiles(chosen.slice(0, MAX_FILES));
            setOutcomes([]);
          }}
        />
      </label>
      {files.length > 0 && <p className="field-hint">{files.length} file(s) selected.</p>}
      {languages.length > 0 && (
        <label className="setting-group">
          <span className="setting-title">Language</span>
          <select
            className="text-input"
            value={language}
            disabled={running}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {languages.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset className="setting-group" disabled={running}>
        <legend className="setting-title">Pages and image cleanup</legend>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={skipTextPages}
            onChange={(event) => setSkipTextPages(event.target.checked)}
          />
          <span>Skip pages that already have text</span>
        </label>
        {(Object.keys(PREPROCESSING_LABELS) as (keyof OcrPreprocessing)[]).map((key) => (
          <label key={key} className="checkbox-row">
            <input
              type="checkbox"
              checked={preprocessing[key]}
              disabled={key === "despeckle" && !preprocessing.threshold}
              onChange={(event) =>
                setPreprocessing({ ...preprocessing, [key]: event.target.checked })
              }
            />
            <span>{PREPROCESSING_LABELS[key]}</span>
          </label>
        ))}
      </fieldset>
      {progress && <output className="field-hint">{progress}</output>}
      {outcomes.length > 0 && (
        <ul className="check-list" aria-label="OCR results">
          {outcomes.map((outcome) => (
            <li key={outcome.id} className={outcome.error ? "failed" : "passed"}>
              {outcome.name}: {outcomeText(outcome)}
            </li>
          ))}
        </ul>
      )}
    </ToolDialog>
  );
}
