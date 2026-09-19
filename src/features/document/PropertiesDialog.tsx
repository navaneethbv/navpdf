import { useEffect, useState } from "react";
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

  return (
    <FeatureDialog title="Document properties" onClose={onClose} busy={loading || saving}>
      {loading ? (
        <output>Reading document properties...</output>
      ) : (
        <form
          className="settings-form"
          onSubmit={async (event) => {
            event.preventDefault();
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
          }}
        >
          <label>
            Title{" "}
            <input
              value={metadata.title}
              onChange={(event) => update("title", event.target.value)}
            />
          </label>
          <label>
            Author{" "}
            <input
              value={metadata.author}
              onChange={(event) => update("author", event.target.value)}
            />
          </label>
          <label>
            Subject{" "}
            <input
              value={metadata.subject}
              onChange={(event) => update("subject", event.target.value)}
            />
          </label>
          <label>
            Keywords{" "}
            <input
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="Separate keywords with commas"
            />
          </label>
          <label>
            Creator{" "}
            <input
              value={metadata.creator}
              onChange={(event) => update("creator", event.target.value)}
            />
          </label>
          <label>
            Producer{" "}
            <input
              value={metadata.producer}
              onChange={(event) => update("producer", event.target.value)}
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="button primary" disabled={saving}>
              Save properties
            </button>
          </div>
        </form>
      )}
    </FeatureDialog>
  );
}
