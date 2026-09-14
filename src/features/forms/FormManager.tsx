import { useState } from "react";
import {
  CheckSquare,
  Type,
  MousePointerClick,
  Plus,
  X,
  List,
  CircleDot,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { addFormField, type FormFieldDefinition } from "../../services/document-commands";

export function FormManager({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [fieldType, setFieldType] = useState<
    "text" | "checkbox" | "radio" | "dropdown" | "button"
  >("text");
  const [fieldName, setFieldName] = useState("");
  const [defaultValue, setDefaultValue] = useState("");
  const [optionsText, setOptionsText] = useState("Option 1, Option 2, Option 3");
  const [groupName, setGroupName] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [required, setRequired] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [targetPage, setTargetPage] = useState(s.page);
  const [saving, setSaving] = useState(false);

  const handleAddField = async () => {
    if (!controller?.pdf || !fieldName.trim()) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const page = Math.max(1, Math.min(targetPage, s.info?.pages || 1));

      let width = 200;
      let height = 24;
      if (fieldType === "checkbox" || fieldType === "radio") {
        width = 20;
        height = 20;
      } else if (fieldType === "button") {
        width = 90;
        height = 28;
      } else if (fieldType === "text" && multiline) {
        height = 60;
      }

      const definition: FormFieldDefinition = {
        type: fieldType,
        name: fieldName.trim(),
        page,
        x: 50,
        y: 650,
        width,
        height,
        defaultValue: defaultValue.trim() || undefined,
        required,
        readOnly,
        multiline: fieldType === "text" ? multiline : undefined,
        group: fieldType === "radio" ? (groupName.trim() || fieldName.trim()) : undefined,
        options:
          fieldType === "dropdown"
            ? optionsText
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
      };

      const newBytes = await addFormField(currentBytes, definition);
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
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Prepare Form Fields"
    >
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
                type="button"
                className={fieldType === "text" ? "active" : ""}
                onClick={() => setFieldType("text")}
              >
                <Type size={15} /> Text Input
              </button>
              <button
                type="button"
                className={fieldType === "checkbox" ? "active" : ""}
                onClick={() => setFieldType("checkbox")}
              >
                <CheckSquare size={15} /> Checkbox
              </button>
              <button
                type="button"
                className={fieldType === "radio" ? "active" : ""}
                onClick={() => setFieldType("radio")}
              >
                <CircleDot size={15} /> Radio
              </button>
              <button
                type="button"
                className={fieldType === "dropdown" ? "active" : ""}
                onClick={() => setFieldType("dropdown")}
              >
                <List size={15} /> Dropdown
              </button>
              <button
                type="button"
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

          {fieldType === "radio" && (
            <div className="setting-group">
              <label className="setting-title">Radio Group Name</label>
              <input
                type="text"
                placeholder="e.g. PaymentMethod, DeliveryChoice"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="text-input"
              />
              <span className="setting-desc">
                Options in the same group are mutually exclusive.
              </span>
            </div>
          )}

          {fieldType === "dropdown" && (
            <div className="setting-group">
              <label className="setting-title">Dropdown Options</label>
              <input
                type="text"
                placeholder="Comma separated: Red, Green, Blue"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                className="text-input"
              />
            </div>
          )}

          <div className="setting-group">
            <label className="setting-title">
              {fieldType === "button"
                ? "Button Label"
                : fieldType === "radio"
                  ? "Option Value"
                  : "Default Value"}
            </label>
            <input
              type="text"
              placeholder={
                fieldType === "button"
                  ? "e.g. Submit"
                  : fieldType === "radio"
                    ? "e.g. Yes"
                    : "Optional default value"
              }
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

          <div className="setting-group">
            <label className="setting-title">Field Properties</label>
            <div style={{ display: "flex", gap: "16px", marginTop: "6px" }}>
              {fieldType === "text" && (
                <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="checkbox"
                    checked={multiline}
                    onChange={(e) => setMultiline(e.target.checked)}
                  />
                  Multiline
                </label>
              )}
              {fieldType !== "button" && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      type="checkbox"
                      checked={required}
                      onChange={(e) => setRequired(e.target.checked)}
                    />
                    Required
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      type="checkbox"
                      checked={readOnly}
                      onChange={(e) => setReadOnly(e.target.checked)}
                    />
                    Read-Only
                  </label>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            type="button"
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
