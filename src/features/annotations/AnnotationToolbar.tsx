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

const colors = [
  { label: "Yellow", hex: "#f5cf58" },
  { label: "Green", hex: "#80d49b" },
  { label: "Blue", hex: "#8cc9f7" },
  { label: "Pink", hex: "#f3a1c0" },
  { label: "Accent", hex: "#25604b" },
  { label: "Red", hex: "#ef4444" },
];

const PENDING_M2 =
  "Not yet available: needs the M2 native annotation adapter. Only highlight, freehand ink, and text boxes are supported right now.";

export function AnnotationToolbar({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();

  const handleSetTool = (tool: "highlight" | "draw" | "text" | "select") => {
    s.set({ tool });
    controller?.setTool(tool);
  };

  return (
    <div className="annotation-floating-toolbar" role="toolbar" aria-label="Annotation tools">
      <div className="tool-group">
        <button
          className={s.tool === "highlight" ? "active" : ""}
          title="Highlight Text"
          onClick={() => handleSetTool("highlight")}
        >
          <Highlighter size={16} />
        </button>
        <button title={`Underline Text. ${PENDING_M2}`} disabled aria-disabled="true">
          <Underline size={16} />
        </button>
        <button title={`Strike-through Text. ${PENDING_M2}`} disabled aria-disabled="true">
          <Strikethrough size={16} />
        </button>
        <button
          className={s.tool === "draw" ? "active" : ""}
          title="Pencil / Freehand Ink"
          onClick={() => handleSetTool("draw")}
        >
          <PenTool size={16} />
        </button>
        <button
          className={s.tool === "text" ? "active" : ""}
          title="Text Box"
          onClick={() => handleSetTool("text")}
        >
          <Type size={16} />
        </button>
        <button title={`Sticky Note / Comment. ${PENDING_M2}`} disabled aria-disabled="true">
          <MessageSquarePlus size={16} />
        </button>
      </div>

      <div className="divider-vert" />

      <div className="tool-group">
        <button title={`Rectangle Shape. ${PENDING_M2}`} disabled aria-disabled="true">
          <Square size={16} />
        </button>
        <button title={`Circle / Ellipse. ${PENDING_M2}`} disabled aria-disabled="true">
          <Circle size={16} />
        </button>
        <button title={`Line. ${PENDING_M2}`} disabled aria-disabled="true">
          <Minus size={16} />
        </button>
        <button title={`Arrow. ${PENDING_M2}`} disabled aria-disabled="true">
          <ArrowRight size={16} />
        </button>
      </div>

      <div className="divider-vert" />

      <div className="color-picker-group">
        {colors.map((c) => (
          <button
            key={c.hex}
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
