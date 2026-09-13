import { Highlighter, Info, LockKeyhole, Trash2 } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
export function Properties({ controller }: { controller: ViewerController }) {
  const s = useWorkspace();
  return (
    <aside className="properties">
      <h2>{s.tool === "highlight" ? "Highlight properties" : "Document"}</h2>
      {s.tool === "highlight" ? (
        <>
          <div className="properties-icon">
            <Highlighter size={25} />
          </div>
          <h3>Mark what matters.</h3>
          <p className="muted">
            Select text on the page to highlight it. You can also draw a
            freehand highlight.
          </p>
          <label className="color-label">
            Color
            <input
              type="color"
              aria-label="Highlight color"
              value={s.highlightColor}
              onChange={(e) => controller.setColor(e.target.value)}
            />
          </label>
          <div className="color-swatches">
            {["#f5cf58", "#80d49b", "#8cc9f7", "#f3a1c0"].map((c) => (
              <button
                key={c}
                style={{ background: c }}
                aria-label={`Highlight ${c}`}
                aria-pressed={s.highlightColor === c}
                onClick={() => controller.setColor(c)}
              />
            ))}
          </div>
          <p className="tip">
            Highlights are embedded in your PDF when you save. Select a
            highlight to change its color or delete it.
          </p>
          <button
            className="button"
            disabled={!s.hasSelection || s.busy}
            onClick={() => controller.deleteSelected()}
          >
            <Trash2 size={16} /> Delete selected
          </button>
        </>
      ) : (
        <>
          <div className="properties-icon">
            <Info size={23} />
          </div>
          <h3>{s.info?.title || s.document?.name}</h3>
          <dl>
            <dt>Pages</dt>
            <dd>{s.info?.pages}</dd>
            <dt>File size</dt>
            <dd>{((s.document?.size || 0) / 1024 / 1024).toFixed(2)} MB</dd>
            <dt>PDF version</dt>
            <dd>{s.info?.version || "Unknown"}</dd>
            <dt>Author</dt>
            <dd>{s.info?.author || "Not specified"}</dd>
            <dt>Protection</dt>
            <dd>{s.info?.encrypted ? "Password protected" : "Unencrypted"}</dd>
          </dl>
          {s.info?.encrypted && (
            <p className="tip">
              <LockKeyhole size={16} /> This file is open for reading. Saving
              encrypted PDFs is not available in this milestone.
            </p>
          )}
          {!s.info?.encrypted && (
            <div className="reader-hint">
              <Highlighter size={22} />
              <strong>A little clarity goes a long way.</strong>
              <p>
                Select Highlight to mark a passage, then save the PDF to keep
                it.
              </p>
              <button
                className="button"
                disabled={s.busy || s.info?.encrypted}
                onClick={() => controller.setTool("highlight")}
              >
                Highlight text
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
