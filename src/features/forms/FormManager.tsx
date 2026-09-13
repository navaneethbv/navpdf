import { useState } from "react";
import { CheckSquare, Type, MousePointerClick, Plus, X } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

export function FormManager({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [fieldType, setFieldType] = useState<"text" | "checkbox" | "button">("text");
  const [fieldName, setFieldName] = useState("");
  const [defaultValue, setDefaultValue] = useState("");
  const [targetPage, setTargetPage] = useState(s.page);
  const [saving, setSaving] = useState(false);

  const handleAddField = async () => {
    if (!controller?.pdf || !fieldName.trim()) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const doc = await PDFDocument.load(currentBytes);
      const form = doc.getForm();
      const pageIndex = Math.max(0, Math.min(targetPage - 1, doc.getPageCount() - 1));
      const page = doc.getPage(pageIndex);
      const { height } = page.getSize();

      const uniqueName = `${fieldName}_${Date.now()}`;
      if (fieldType === "text") {
        const tf = form.createTextField(uniqueName);
        if (defaultValue) tf.setText(defaultValue);
        tf.addToPage(page, { x: 50, y: height - 120, width: 200, height: 24 });
      } else if (fieldType === "checkbox") {
        const cb = form.createCheckBox(uniqueName);
        if (defaultValue === "true") cb.check();
        cb.addToPage(page, { x: 50, y: height - 120, width: 18, height: 18 });
      } else if (fieldType === "button") {
        const btn = form.createButton(uniqueName);
        btn.addToPage(defaultValue || "Submit", page, {
          x: 50,
          y: height - 120,
          width: 80,
          height: 28,
        });
      }

      const newBytes = await doc.save();
      await controller.replaceWithBytes(
        newBytes,
        `Form field "${fieldName}" created`,
      );
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Prepare Form Fields">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <CheckSquare size={18} />
            <h3>Prepare Form Fields</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label className="setting-title">Field Type</label>
            <div className="tab-buttons-bar">
              <button
                className={fieldType === "text" ? "active" : ""}
                onClick={() => setFieldType("text")}
              >
                <Type size={15} /> Text Input
              </button>
              <button
                className={fieldType === "checkbox" ? "active" : ""}
                onClick={() => setFieldType("checkbox")}
              >
                <CheckSquare size={15} /> Checkbox
              </button>
              <button
                className={fieldType === "button" ? "active" : ""}
                onClick={() => setFieldType("button")}
              >
                <MousePointerClick size={15} /> Button
              </button>
            </div>
          </div>

          <div className="setting-group">
            <label className="setting-title">Field Name</label>
            <input
              type="text"
              placeholder="e.g. FirstName, SignatureDate, Agreed"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              className="text-input"
            />
          </div>

          <div className="setting-group">
            <label className="setting-title">
              {fieldType === "button" ? "Button Label" : "Default Value"}
            </label>
            <input
              type="text"
              placeholder={fieldType === "button" ? "e.g. Click Here" : "Optional default value"}
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              className="text-input"
            />
          </div>

          <div className="setting-group">
            <label className="setting-title">Page</label>
            <input
              type="number"
              min={1}
              max={s.info?.pages || 1}
              value={targetPage}
              onChange={(e) => setTargetPage(Number(e.target.value))}
              className="text-input"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            onClick={handleAddField}
            disabled={saving || !fieldName.trim()}
            className="button-primary"
          >
            <Plus size={16} /> Add Field
          </button>
        </div>
      </div>
    </div>
  );
}
