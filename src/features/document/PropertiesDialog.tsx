import { useEffect, useId, useState } from "react";
import { FileText, X } from "lucide-react";
import { FeatureDialog } from "../../components/FeatureDialog";
import { readMetadata, writeMetadata, type DocumentMetadata } from "../../services/pdf/metadata";
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
        const values = await readMetadata(await controller.pdf.saveDocument());
        if (!cancelled) {
          setMetadata(values);
          setKeywords(values.keywords.join(", "));
        }
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
