import {
  Highlighter,
  Underline,
  Strikethrough,
  PenTool,
  Square,
  Circle,
  Minus,
  ArrowRight,
  MessageSquarePlus,
  Type,
  X,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import type { TextMarkupKind } from "../../services/document-commands";
import type { ShapeKind } from "../../types/document";

const colors = [
  { label: "Yellow", hex: "#f5cf58" },
  { label: "Green", hex: "#80d49b" },
  { label: "Blue", hex: "#8cc9f7" },
  { label: "Pink", hex: "#f3a1c0" },
  { label: "Accent", hex: "#25604b" },
  { label: "Red", hex: "#ef4444" },
];

export function AnnotationToolbar({
  controller,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const s = useWorkspace();
  const isBlocked = !controller || s.busy || !!s.info?.encrypted || !s.editingAllowed;

  const handleSetTool = (tool: "highlight" | "draw" | "text" | "select") => {
    s.set({ tool, selectedAnnotationId: null, hasSelection: false });
    controller?.setTool(tool);
  };

  const applyTextMarkup = (kind: TextMarkupKind) => {
    void controller?.addTextMarkup(kind).catch((error: unknown) => {
      s.set({ error: error instanceof Error ? error.message : String(error) });
    });
  };

  const selectShape = (shapeKind: ShapeKind) => {
    controller?.setTool("select");
    s.set({
      shapeKind,
      tool: "shape",
      activeModal: "annotations",
      selectedAnnotationId: null,
      hasSelection: false,
    });
  };

  return (
    <div className="annotation-floating-toolbar" role="toolbar" aria-label="Annotation tools">
      {!s.editingAllowed && (
        <span
          className="toolbar-restricted-notice"
          style={{ fontSize: "12px", color: "var(--text-secondary)", padding: "0 8px" }}
        >
          Editing is restricted for this document.
        </span>
      )}
      <div className="tool-group">
        <button
          className={s.tool === "highlight" ? "active" : ""}
          title="Highlight Text"
          disabled={isBlocked}
          onClick={() => handleSetTool("highlight")}
        >
          <Highlighter size={16} />
        </button>
        <button
          title="Underline Text"
          disabled={isBlocked}
          onClick={() => applyTextMarkup("Underline")}
        >
          <Underline size={16} />
        </button>
        <button
          title="Strike-through Text"
          disabled={isBlocked}
          onClick={() => applyTextMarkup("StrikeOut")}
        >
          <Strikethrough size={16} />
        </button>
        <button
          className={s.tool === "draw" ? "active" : ""}
          title="Pencil / Freehand Ink"
          disabled={isBlocked}
          onClick={() => handleSetTool("draw")}
        >
          <PenTool size={16} />
        </button>
        <button
          className={s.tool === "text" ? "active" : ""}
          title="Text Box"
          disabled={isBlocked}
          onClick={() => handleSetTool("text")}
        >
          <Type size={16} />
        </button>
        <button
          title="Sticky Note / Comment"
          disabled={isBlocked}
          onClick={() => s.set({ activeModal: "sticky-note" })}
        >
          <MessageSquarePlus size={16} />
        </button>
      </div>

      <div className="divider-vert" />

      <div className="tool-group">
        <button
          title="Rectangle Shape"
          disabled={isBlocked}
          onClick={() => selectShape("Square")}
          aria-pressed={s.tool === "shape" && s.shapeKind === "Square"}
        >
          <Square size={16} />
        </button>
        <button
          title="Circle / Ellipse"
          disabled={isBlocked}
          onClick={() => selectShape("Circle")}
          aria-pressed={s.tool === "shape" && s.shapeKind === "Circle"}
        >
          <Circle size={16} />
        </button>
        <button
          title="Line"
          disabled={isBlocked}
          onClick={() => selectShape("Line")}
          aria-pressed={s.tool === "shape" && s.shapeKind === "Line"}
        >
          <Minus size={16} />
        </button>
        <button
          title="Arrow"
          disabled={isBlocked}
          onClick={() => selectShape("Arrow")}
          aria-pressed={s.tool === "shape" && s.shapeKind === "Arrow"}
        >
          <ArrowRight size={16} />
        </button>
      </div>

      <div className="divider-vert" />

      <div className="color-picker-group">
        {colors.map((c) => (
          <button
            key={c.hex}
            disabled={isBlocked}
            className={`color-dot ${
              s.highlightColor === c.hex || s.inkColor === c.hex ? "active" : ""
            }`}
            style={{ backgroundColor: c.hex }}
            title={c.label}
            onClick={() => {
              s.set({ highlightColor: c.hex, inkColor: c.hex });
              controller?.setColor(c.hex);
            }}
          />
        ))}
      </div>

      <button className="icon-button" onClick={onClose} aria-label="Close annotation tools">
        <X size={16} />
      </button>
    </div>
  );
}
