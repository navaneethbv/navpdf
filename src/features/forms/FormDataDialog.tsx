import { useEffect, useId, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import { useWorkspace } from "../../stores/workspace";
import { downloadBlob, safeFileName } from "../../utils/download";
import {
  exportFormDataCsv,
  exportFormDataJson,
  findMissingRequiredFields,
  importFormData,
  MAX_FORM_DATA_BYTES,
  MAX_MERGED_FORMS,
  mergeFormDataCsv,
  previewFormDataImport,
  readFormData,
  resetFormData,
  type FormDataField,
  type FormDataPreview,
  type FormDataReport,
  type FormValue,
} from "../../services/pdf/form-data";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import type { ViewerController } from "../viewer/controller";

import { exportFormXfdf, formXfdfToJson } from "../../services/pdf/form-xfdf";

const ACTIONS = {
  "export-json": "Export JSON",
  "export-csv": "Export CSV",
  "export-xfdf": "Export XFDF",
  merge: "Merge to CSV",
  import: "Import Values",
  required: "Check Required Fields",
  reset: "Clear Editable Values",
} as const;
type Action = keyof typeof ACTIONS;
const displayValue = (value: FormValue) =>
  Array.isArray(value) ? value.join(", ") || "(empty)" : String(value) || "(empty)";

export function FormDataDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const ids = useId();
  const document = useWorkspace((state) => state.document);
  const encrypted = useWorkspace((state) => state.info?.encrypted);
  const editingAllowed = useWorkspace((state) => state.editingAllowed);
  const source = controller?.pdf;
  const documentId = document?.id;
  const [action, setAction] = useState<Action>("export-json");
  const [report, setReport] = useState<FormDataReport | null>(null);
  const [preview, setPreview] = useState<FormDataPreview[] | null>(null);
  const [missing, setMissing] = useState<FormDataField[] | null>(null);
  const [payload, setPayload] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const mounted = useRef(true);
  const job = useRef(0);
  const { apply, busy, error, setError } = useDocumentEdit(controller);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isCurrent = (token: number) =>
    mounted.current &&
    token === job.current &&
    controller?.pdf === source &&
    useWorkspace.getState().document?.id === documentId;

  useEffect(() => {
    const token = ++job.current;
    setReport(null);
    setPreview(null);
    setMissing(null);
    setPayload("");
    setConfirmed(false);
    setError("");
    if (!source || encrypted) {
      setWorking(false);
      return;
    }
    setWorking(true);
    const load = async () => {
      const found = await readFormData(await source.saveDocument());
      if (isCurrent(token)) setReport(found);
    };
    void load()
      .catch((cause: unknown) => {
        if (isCurrent(token)) setError(errorMessage(cause));
      })
      .finally(() => {
        if (isCurrent(token)) setWorking(false);
      });
    return () => {
      job.current++;
    };
  }, [controller, source, documentId, encrypted, revision]);

  const editable = report?.fields.filter((field) => !field.readOnly).length ?? 0;
  const mutation = action === "import" || action === "reset";
  let blockReason = "";
  if (encrypted) blockReason = "Encrypted PDFs are read-only. Form data tools are unavailable.";
  else if (!editingAllowed)
    blockReason =
      "Document editing is not allowed. Export and required-field checks are still available.";
  else if (report?.signed)
    blockReason =
      "This PDF is digitally signed. Importing or clearing values would invalidate its signatures.";

  const chooseAction = (value: Action) => {
    setAction(value);
    setConfirmed(false);
    setPreview(null);
    setPayload("");
    setMissing(null);
    setNotice("");
    setError("");
  };

  const loadImport = async (file: File | undefined) => {
    setPreview(null);
    setPayload("");
    setNotice("");
    setError("");
    if (!file || !source || !report || blockReason) return;
    const token = ++job.current;
    setWorking(true);
    try {
      if (file.size > MAX_FORM_DATA_BYTES) throw new Error("Form data exceeds the 2 MB limit.");
      const raw = await file.text();
      const text = file.name.toLowerCase().endsWith(".xfdf")
        ? await formXfdfToJson(await source.saveDocument(), raw)
        : raw;
      if (!isCurrent(token)) return;
      const values = await previewFormDataImport(await source.saveDocument(), text);
      if (!isCurrent(token)) return;
      setPayload(text);
      setPreview(values);
      if (!values.length) setNotice("This file contains no values to import.");
    } catch (cause) {
      if (isCurrent(token)) setError(errorMessage(cause));
    } finally {
      if (isCurrent(token)) setWorking(false);
    }
  };

  const assertEditable = (token: number) => {
    const current = useWorkspace.getState();
    if (!isCurrent(token)) throw new Error("The document changed. Reopen Form Data and try again.");
    if (!current.editingAllowed || current.info?.encrypted)
      throw new Error("This document is read-only.");
  };

  const submitMutation = async (token: number) => {
    if (blockReason || !editable || (action === "reset" ? !confirmed : !preview?.length)) return;
    const message = action === "reset" ? "Editable form values cleared." : "Form values imported.";
    const applied = await apply(message, async (bytes) => {
      assertEditable(token);
      const changed =
        action === "reset" ? await resetFormData(bytes) : await importFormData(bytes, payload);
      assertEditable(token);
      return changed;
    });
    // A successful replacement changes the PDF proxy, so only check document identity here.
    if (applied && mounted.current && useWorkspace.getState().document?.id === documentId) {
      setNotice(message);
      setConfirmed(false);
      setPreview(null);
      setRevision((current) => current + 1);
    }
  };

  const exportReport = async (found: FormDataReport, token: number) => {
    let text: string;
    let extension = "json";
    let mime = "application/json";
    let notice = "Form JSON exported.";
    if (action === "export-csv") {
      text = exportFormDataCsv(found);
      extension = "csv";
      mime = "text/csv;charset=utf-8";
      notice = "Form CSV exported.";
    } else if (action === "export-xfdf" && source) {
      text = await exportFormXfdf(await source.saveDocument());
      extension = "xfdf";
      mime = "application/vnd.adobe.xfdf";
      notice = "Form XFDF exported.";
    } else text = exportFormDataJson(found);
    if (!isCurrent(token)) return;
    const base = safeFileName(document?.name ?? "document.pdf").replace(/\.pdf$/i, "");
    const saved = await downloadBlob(
      new Blob([text], { type: mime }),
      `${base}-form-data.${extension}`,
    );
    if (saved && isCurrent(token)) setNotice(notice);
  };

  /** One spreadsheet row per chosen filled form; the open document is not changed. */
  const mergeForms = async (token: number) => {
    const forms: { file: string; report: FormDataReport }[] = [];
    for (const file of mergeFiles) {
      if (file.size > 100 * 1024 * 1024) throw new Error(`${file.name} exceeds the 100 MB limit.`);
      try {
        forms.push({
          file: file.name,
          report: await readFormData(new Uint8Array(await file.arrayBuffer())),
        });
      } catch (cause) {
        throw new Error(`${file.name}: ${errorMessage(cause)}`, { cause });
      }
      if (!isCurrent(token)) return;
    }
    const csv = mergeFormDataCsv(forms);
    const saved = await downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      "merged-form-data.csv",
    );
    if (saved && isCurrent(token)) setNotice(`Merged ${forms.length} form(s) into one CSV.`);
  };

  const submit = async () => {
    if (!source || !report || working || busy || encrypted) return;
    setNotice("");
    setError("");
    const token = job.current;
    if (mutation) {
      await submitMutation(token);
      return;
    }
    setWorking(true);
    try {
      if (action === "merge") {
        await mergeForms(token);
        return;
      }
      const found = await readFormData(await source.saveDocument());
      if (!isCurrent(token)) return;
      setReport(found);
      if (action === "required") {
        const result = findMissingRequiredFields(found);
        setMissing(result);
        setNotice(
          result.length
            ? `${result.length} required field(s) are empty.`
            : "No missing required values in supported fields.",
        );
        return;
      }
      await exportReport(found, token);
    } catch (cause) {
      if (isCurrent(token)) setError(errorMessage(cause));
    } finally {
      if (isCurrent(token)) setWorking(false);
    }
  };

  const disabled =
    !report ||
    Boolean(encrypted) ||
    (mutation && (Boolean(blockReason) || !editable)) ||
    (action === "import" && !preview?.length) ||
    (action === "reset" && !confirmed) ||
    (action === "merge" && !mergeFiles.length) ||
    (action.startsWith("export-") && !editable);

  return (
    <ToolDialog
      title="Form Data"
      icon={<ClipboardList size={18} />}
      onClose={() => {
        mounted.current = false;
        onClose();
      }}
      busy={working || busy}
      error={error}
      primaryLabel={ACTIONS[action]}
      primaryDisabled={disabled}
      onPrimary={() => void submit()}
    >
      <div className="setting-group">
        <label className="setting-title" htmlFor={`${ids}-action`}>
          Form data action
        </label>
        <select
          id={`${ids}-action`}
          className="text-input"
          value={action}
          disabled={working || busy}
          onChange={(event) => chooseAction(event.target.value as Action)}
        >
          <option value="export-json">Export editable values as JSON</option>
          <option value="export-csv">Export editable values as CSV</option>
          <option value="export-xfdf">Export editable values as XFDF</option>
          <option value="merge">Merge filled PDF forms into a CSV</option>
          <option value="import">Import JSON or XFDF values</option>
          <option value="required">Check required fields</option>
          <option value="reset">Clear editable values</option>
        </select>
      </div>
      {working && (
        <output className="field-hint" aria-live="polite">
          Reading form data…
        </output>
      )}
      {report && (
        <p className="field-hint">
          {editable} editable fields; {report.fields.length - editable} read-only fields;{" "}
          {report.excluded.length} unsupported fields.
        </p>
      )}
      {report && !report.fields.length && (
        <p className="field-hint">This PDF has no supported form fields.</p>
      )}
      {blockReason && <p className="field-hint">{blockReason}</p>}
      <p className="field-hint">
        JSON, CSV and XFDF include editable text, checkbox, radio and choice values. Read-only,
        signature, button and unsupported fields are excluded from export, import and clearing.
        Required-field checks include supported read-only fields.
      </p>
      {Boolean(report?.excluded.length) && (
        <p className="field-hint">
          Required-field checks cannot assess {report?.excluded.length} unsupported field(s).
        </p>
      )}
      {action === "merge" && (
        <div className="setting-group">
          <label className="setting-title" htmlFor={`${ids}-merge`}>
            Filled PDF forms
          </label>
          <input
            id={`${ids}-merge`}
            type="file"
            multiple
            accept=".pdf,application/pdf"
            disabled={working || busy}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              if (files.length > MAX_MERGED_FORMS)
                setError(`Choose at most ${MAX_MERGED_FORMS} forms.`);
              else setError("");
              setMergeFiles(files.slice(0, MAX_MERGED_FORMS));
            }}
          />
          <p className="field-hint">
            Each PDF becomes one row, with a column for every editable field found in any of them.
            The open document is not changed.
          </p>
        </div>
      )}
      {action === "import" && (
        <div className="setting-group">
          <label className="setting-title" htmlFor={`${ids}-file`}>
            JSON or XFDF form data file
          </label>
          <input
            id={`${ids}-file`}
            type="file"
            accept=".json,.xfdf,application/json,application/vnd.adobe.xfdf"
            disabled={working || busy || Boolean(blockReason) || !report}
            onChange={(event) => void loadImport(event.target.files?.[0])}
          />
          <p className="field-hint">
            Choose NavPDF form data JSON version 1 or XFDF, up to 2 MB. Review every change before
            importing. Fields not listed in the file keep their values.
          </p>
        </div>
      )}
      {action === "import" && preview && preview.length > 0 && (
        <>
          <p className="field-hint">
            {preview.length} field(s) will be updated.
            {preview.length > 100 ? " Showing the first 100." : ""}
          </p>
          <table className="form-data-table" aria-label="Import preview">
            <thead>
              <tr>
                <th>Field</th>
                <th>Current value</th>
                <th>Imported value</th>
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 100).map((entry) => (
                <tr key={entry.name}>
                  <th scope="row">{entry.name}</th>
                  <td>{displayValue(entry.before)}</td>
                  <td>{displayValue(entry.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {action === "reset" && (
        <div className="setting-group">
          <p className="field-hint">
            Clear current editable values, including checked boxes and selected options. This does
            not restore field defaults. Undo can restore the previous values.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={working || busy || Boolean(blockReason) || !editable}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            I confirm clearing all editable form values.
          </label>
        </div>
      )}
      {action === "required" && missing && missing.length > 0 && (
        <>
          <ul aria-label="Missing required fields">
            {missing.slice(0, 100).map((field) => (
              <li key={field.name}>
                {field.name}
                {field.readOnly ? " (read-only)" : ""}
              </li>
            ))}
          </ul>
          {missing.length > 100 && (
            <p className="field-hint">Showing the first 100 of {missing.length} missing fields.</p>
          )}
        </>
      )}
      {notice && (
        <output className="field-hint" aria-live="polite">
          {notice}
        </output>
      )}
    </ToolDialog>
  );
}
