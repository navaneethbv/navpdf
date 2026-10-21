import { useEffect, useRef, useState } from "react";
import { Scan } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { native, ocrGetEngineInfo, ocrRecognizePage } from "../../services/native";
import { loadPdfFromBytes } from "../../services/pdf";
import { applyOcrSearchableLayer, detectExistingText } from "../../services/document-commands";
import { createZip } from "../convert/ooxml";
import { downloadBlob } from "../../utils/download";
import { useWorkspace } from "../../stores/workspace";
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
  const task = loadPdfFromBytes(bytes.slice());
  try {
    const pdf = await task.promise.catch(() => {
      throw new Error("The PDF could not be opened; password-protected files are not supported.");
    });
    const results: OcrPageResult[] = [];
    let skipped = 0;
    const ensureCurrent = () => {
      if (cancelled()) throw new Error("OCR cancelled.");
    };
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      ensureCurrent();
      if (options.skipTextPages && (await detectExistingText(bytes, pageIndex))) {
        skipped++;
        continue;
      }
      onPage(pageIndex + 1, pdf.numPages);
      const image = await pageImage(pdf, pageIndex + 1, ensureCurrent, options.preprocessing);
      results.push(await ocrRecognizePage(image, { pageIndex, language: options.language }));
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

function outputName(name: string, used: Set<string>) {
  const base = `${name.replace(/\.pdf$/i, "") || "Document"} (OCR)`;
  let candidate = `${base}.pdf`;
  for (let copy = 2; used.has(candidate.toLowerCase()); copy++) candidate = `${base} ${copy}.pdf`;
  used.add(candidate.toLowerCase());
  return candidate;
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
    if (!native) return;
    ocrGetEngineInfo()
      .then((info) => {
        setLanguages(info.supportedLanguages);
        setLanguage((current) =>
          info.supportedLanguages.includes(current)
            ? current
            : (info.supportedLanguages[0] ?? current),
        );
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = async () => {
    cancelled.current = false;
    setRunning(true);
    setError("");
    setOutcomes([]);
    const done: BatchOcrOutcome[] = [];
    try {
      for (const [index, file] of files.entries()) {
        if (cancelled.current) break;
        try {
          done.push(
            await ocrFile(
              file,
              { language, skipTextPages, preprocessing },
              () => cancelled.current,
              (page, total) =>
                setProgress(
                  `File ${index + 1} of ${files.length}, page ${page} of ${total}: ${file.name}`,
                ),
            ),
          );
        } catch (cause) {
          if (cancelled.current) break;
          done.push({
            name: file.name,
            bytes: null,
            pages: 0,
            skipped: 0,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
        setOutcomes([...done]);
      }
      if (cancelled.current) {
        s.set({ status: "Multi-file OCR cancelled. Nothing was saved." });
        return;
      }
      const used = new Set<string>();
      const entries = done
        .filter((outcome) => outcome.bytes)
        .map((outcome) => ({ name: outputName(outcome.name, used), data: outcome.bytes! }));
      if (!entries.length) {
        setError("No file needed or produced a searchable layer.");
        return;
      }
      const saved = await downloadBlob(
        new Blob([createZip(entries)], { type: "application/zip" }),
        `OCR-${Date.now()}.zip`,
      );
      s.set({
        status: saved
          ? `Saved ${entries.length} searchable PDF(s) in a ZIP archive`
          : "Save cancelled",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
          {outcomes.map((outcome, index) => (
            <li key={`${outcome.name}-${index}`} className={outcome.error ? "failed" : "passed"}>
              {outcome.name}:{" "}
              {outcome.error ??
                `${outcome.pages} page(s) recognized${outcome.skipped ? `, ${outcome.skipped} skipped with existing text` : ""}`}
            </li>
          ))}
        </ul>
      )}
    </ToolDialog>
  );
}
