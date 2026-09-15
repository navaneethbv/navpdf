import { useState, useEffect } from "react";
import { Circle, Highlighter, Info, LockKeyhole, Square, Trash2 } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
export function Properties({ controller }: { controller: ViewerController }) {
  const s = useWorkspace();
  const selected = s.comments.find((comment) => comment.id === s.selectedAnnotationId);
  const selectedShape = selected && ["Square", "Circle", "Line"].includes(selected.type)
    ? selected
    : null;
  const selectedColor = selectedShape?.color
    ? `#${selectedShape.color
        .map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0"))
        .join("")}`
    : s.inkColor;

  const [localWidth, setLocalWidth] = useState<number>(selected?.width ?? s.inkWidth);
  const [localOpacity, setLocalOpacity] = useState<number>(selected?.opacity ?? s.inkOpacity);
  const [localText, setLocalText] = useState<string>(selected?.text ?? "");

  useEffect(() => {
    setLocalWidth(selected?.width ?? s.inkWidth);
    setLocalOpacity(selected?.opacity ?? s.inkOpacity);
    setLocalText(selected?.text ?? "");
  }, [selected?.id, selected?.width, selected?.opacity, selected?.text, s.inkWidth, s.inkOpacity]);
  return (
    <aside className="properties">
      <h2>
        {selected
          ? "Annotation properties"
          : s.tool === "highlight"
          ? "Highlight properties"
          : s.tool === "shape"
            ? "Shape properties"
            : "Document"}
      </h2>
      {selected ? (
        <>
          <div className="properties-icon">
            {selectedShape ? <Square size={25} /> : <Info size={23} />}
          </div>
          <h3>
            {selected.type} on page {selected.page}
          </h3>
          {selectedShape ? (
            <>
              <p className="muted">
                Selected from the page or Comments. Changes are written as
                standard PDF annotation properties.
              </p>
              <label className="color-label">
                Stroke color
                <input
                  type="color"
                  aria-label="Selected annotation color"
                  value={selectedColor}
                  onChange={(event) => {
                    const value = event.target.value;
                    s.set({ inkColor: value });
                    void controller.updateSelectedAnnotation({
                      color: [
                        parseInt(value.slice(1, 3), 16) / 255,
                        parseInt(value.slice(3, 5), 16) / 255,
                        parseInt(value.slice(5, 7), 16) / 255,
                      ],
                    });
                  }}
                />
              </label>
              <label className="range-label">
                Stroke width
                <input
                  type="range"
                  min="0.5"
                  max="12"
                  step="0.5"
                  aria-label="Selected annotation width"
                  value={localWidth}
                  onChange={(event) => setLocalWidth(Number(event.target.value))}
                  onPointerUp={() => {
                    void controller.updateSelectedAnnotation({
                      width: localWidth,
                    });
                  }}
                />
                <span>{localWidth.toFixed(1)} pt</span>
              </label>
              <label className="range-label">
                Opacity
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  aria-label="Selected annotation opacity"
                  value={localOpacity}
                  onChange={(event) => setLocalOpacity(Number(event.target.value))}
                  onPointerUp={() => {
                    void controller.updateSelectedAnnotation({
                      opacity: localOpacity,
                    });
                  }}
                />
                <span>
                  {Math.round(localOpacity * 100)}%
                </span>
              </label>
              <div className="property-button-grid" role="group" aria-label="Move selected annotation">
                <button className="button" onClick={() => void controller.moveSelectedAnnotation(-8, 0)}>
                  Move left
                </button>
                <button className="button" onClick={() => void controller.moveSelectedAnnotation(8, 0)}>
                  Move right
                </button>
                <button className="button" onClick={() => void controller.moveSelectedAnnotation(0, 8)}>
                  Move up
                </button>
                <button className="button" onClick={() => void controller.moveSelectedAnnotation(0, -8)}>
                  Move down
                </button>
              </div>
              <div className="property-button-grid" role="group" aria-label="Resize selected annotation">
                <button className="button" onClick={() => void controller.resizeSelectedAnnotation(8, 0)}>
                  Widen
                </button>
                <button className="button" onClick={() => void controller.resizeSelectedAnnotation(-8, 0)}>
                  Narrow
                </button>
                <button className="button" onClick={() => void controller.resizeSelectedAnnotation(0, 8)}>
                  Taller
                </button>
                <button className="button" onClick={() => void controller.resizeSelectedAnnotation(0, -8)}>
                  Shorter
                </button>
              </div>
            </>
          ) : selected.type === "Text" ? (
            <label>
              Note text
              <textarea
                aria-label="Selected note text"
                value={localText}
                rows={5}
                onChange={(event) => setLocalText(event.target.value)}
                onBlur={() => {
                  if (localText !== selected.text) {
                    void controller.updateSelectedAnnotation({
                      contents: localText,
                    });
                  }
                }}
              />
            </label>
          ) : (
            <p className="muted">This annotation can be navigated and deleted here.</p>
          )}
          <button
            className="button"
            disabled={s.busy}
            onClick={() => void controller.deleteSelectedAnnotation()}
          >
            <Trash2 size={16} /> Delete selected
          </button>
        </>
      ) : s.tool === "highlight" ? (
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
      ) : s.tool === "shape" ? (
        <>
          <div className="properties-icon">
            {s.shapeKind === "Circle" ? <Circle size={25} /> : <Square size={25} />}
          </div>
          <h3>Draw with intention.</h3>
          <p className="muted">
            Drag on the page to add a {s.shapeKind.toLowerCase()} annotation.
            Press Escape to leave drawing mode.
          </p>
          <label className="color-label">
            Stroke color
            <input
              type="color"
              aria-label="Shape stroke color"
              value={s.inkColor}
              onChange={(e) => useWorkspace.getState().set({ inkColor: e.target.value })}
            />
          </label>
          <label className="range-label">
            Stroke width
            <input
              type="range"
              min="0.5"
              max="12"
              step="0.5"
              aria-label="Shape stroke width"
              value={s.inkWidth}
              onChange={(e) =>
                useWorkspace.getState().set({ inkWidth: Number(e.target.value) })
              }
            />
            <span>{s.inkWidth.toFixed(1)} pt</span>
          </label>
          <label className="range-label">
            Opacity
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              aria-label="Shape opacity"
              value={s.inkOpacity}
              onChange={(e) =>
                useWorkspace.getState().set({ inkOpacity: Number(e.target.value) })
              }
            />
            <span>{Math.round(s.inkOpacity * 100)}%</span>
          </label>
          <p className="tip">
            Shapes are stored as standard PDF annotations and remain separate
            from freehand ink and highlights.
          </p>
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
              <LockKeyhole size={16} /> This file is open for reading. Unlock
              it from Password Protect to edit it or save a copy.
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
