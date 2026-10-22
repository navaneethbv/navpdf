import { useEffect, useId, useState } from "react";
import { FileText, Plus, Trash2, X } from "lucide-react";
import { FeatureDialog } from "../../components/FeatureDialog";
import {
  listFonts,
  readMetadata,
  writeMetadata,
  type CustomProperty,
  type DocumentMetadata,
  type FontInfo,
} from "../../services/pdf/metadata";
import type { ViewerController } from "../viewer/controller";
import { useWorkspace } from "../../stores/workspace";

const emptyMetadata: DocumentMetadata = {
  title: "",
  author: "",
  subject: "",
  keywords: [],
  creator: "",
  producer: "",
};

type CustomRow = CustomProperty & { id: string };

const withId = (property: CustomProperty): CustomRow => ({ ...property, id: crypto.randomUUID() });

const fontKey = (font: FontInfo) =>
  [font.name, font.type, font.encoding, font.embedded, font.pages.join(" ")].join("|");

function embeddingLabel(font: FontInfo) {
  if (!font.embedded) return "No";
  return font.subset ? "Embedded subset" : "Embedded";
}

export function PropertiesDialog({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const sourcePdf = controller?.pdf;
  const [metadata, setMetadata] = useState<DocumentMetadata>(emptyMetadata);
  const [keywords, setKeywords] = useState("");
  const [custom, setCustom] = useState<CustomRow[]>([]);
  const [fonts, setFonts] = useState<FontInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = useWorkspace((state) => state.set);
  const ids = useId();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!controller?.pdf) {
        setLoading(false);
        return;
      }
      try {
        const bytes = await controller.pdf.saveDocument();
        const values = await readMetadata(bytes);
        if (!cancelled) {
          setMetadata(values);
          setKeywords(values.keywords.join(", "));
          setCustom((values.custom ?? []).map(withId));
        }
        const found = await listFonts(bytes);
        if (!cancelled) setFonts(found);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controller]);

  const update = (field: keyof DocumentMetadata, value: string) =>
    setMetadata((current) => ({ ...current, [field]: value }));
  const updateRow = (id: string, change: Partial<CustomProperty>) =>
    setCustom((rows) => rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const removeRow = (id: string) => setCustom((rows) => rows.filter((row) => row.id !== id));

  const save = async () => {
    if (!controller?.pdf) return;
    setSaving(true);
    setError("");
    try {
      const next = {
        ...metadata,
        keywords: keywords
          .split(",")
          .map((keyword) => keyword.trim())
          .filter(Boolean),
        custom: custom
          .map(({ name, value }) => ({ name: name.trim(), value }))
          .filter(({ name, value }) => name || value),
      };
      const bytes = await controller.pdf.saveDocument();
      const changed = await writeMetadata(bytes, next);
      await controller.replaceWithBytes(changed, "Document properties updated", {
        expectedSource: sourcePdf,
        preMutationBytes: bytes,
      });
      set({ status: "Document properties updated" });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FeatureDialog title="Document properties" onClose={onClose} busy={loading || saving}>
      <form
        className="modal-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="modal-header">
          <div className="modal-title">
            <FileText size={18} />
            <h3>Document Properties</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {loading ? (
            <output className="field-hint">Reading document properties...</output>
          ) : (
            <>
              <div className="setting-group">
                <label className="setting-title" htmlFor={`${ids}-title`}>
                  Title
                </label>
                <input
                  id={`${ids}-title`}
                  className="text-input"
                  value={metadata.title}
                  onChange={(event) => {
                    update("title", event.target.value);
                  }}
                />
              </div>
              <div className="setting-group">
                <label className="setting-title" htmlFor={`${ids}-author`}>
                  Author
                </label>
                <input
                  id={`${ids}-author`}
                  className="text-input"
                  value={metadata.author}
                  onChange={(event) => {
                    update("author", event.target.value);
                  }}
                />
              </div>
              <div className="setting-group">
                <label className="setting-title" htmlFor={`${ids}-subject`}>
                  Subject
                </label>
                <input
                  id={`${ids}-subject`}
                  className="text-input"
                  value={metadata.subject}
                  onChange={(event) => {
                    update("subject", event.target.value);
                  }}
                />
              </div>
              <div className="setting-group">
                <label className="setting-title" htmlFor={`${ids}-keywords`}>
                  Keywords
                </label>
                <input
                  id={`${ids}-keywords`}
                  className="text-input"
                  value={keywords}
                  onChange={(event) => {
                    setKeywords(event.target.value);
                  }}
                  placeholder="Separate keywords with commas"
                />
              </div>
              <div className="setting-group">
                <label className="setting-title" htmlFor={`${ids}-creator`}>
                  Creator
                </label>
                <input
                  id={`${ids}-creator`}
                  className="text-input"
                  value={metadata.creator}
                  onChange={(event) => {
                    update("creator", event.target.value);
                  }}
                />
              </div>
              <div className="setting-group">
                <label className="setting-title" htmlFor={`${ids}-producer`}>
                  Producer
                </label>
                <input
                  id={`${ids}-producer`}
                  className="text-input"
                  value={metadata.producer}
                  onChange={(event) => {
                    update("producer", event.target.value);
                  }}
                />
              </div>
              <fieldset className="preset-list">
                <legend className="setting-title">Custom properties</legend>
                {custom.map((entry, index) => (
                  <div key={entry.id} className="inline-field">
                    <input
                      className="text-input"
                      aria-label={`Custom property ${index + 1} name`}
                      placeholder="Name"
                      value={entry.name}
                      onChange={(event) => updateRow(entry.id, { name: event.target.value })}
                    />
                    <input
                      className="text-input"
                      aria-label={`Custom property ${index + 1} value`}
                      placeholder="Value"
                      value={entry.value}
                      onChange={(event) => updateRow(entry.id, { value: event.target.value })}
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove custom property ${index + 1}`}
                      onClick={() => removeRow(entry.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setCustom((rows) => [...rows, withId({ name: "", value: "" })])}
                >
                  <Plus size={15} /> Add Property
                </button>
              </fieldset>
              <details>
                <summary>Fonts{fonts ? ` (${fonts.length})` : ""}</summary>
                {!fonts && <output className="field-hint">Reading fonts…</output>}
                {fonts?.length === 0 && <p className="field-hint">No fonts are used.</p>}
                {!!fonts?.length && (
                  <table className="workflow-table" aria-label="Fonts used in this PDF">
                    <thead>
                      <tr>
                        <th scope="col">Font</th>
                        <th scope="col">Type</th>
                        <th scope="col">Encoding</th>
                        <th scope="col">Embedded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fonts.map((font) => (
                        <tr key={fontKey(font)}>
                          <th scope="row">{font.name}</th>
                          <td>{font.type}</td>
                          <td>{font.encoding}</td>
                          <td>{embeddingLabel(font)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={loading || saving}>
            {saving ? "Saving..." : "Save properties"}
          </button>
        </div>
      </form>
    </FeatureDialog>
  );
}
