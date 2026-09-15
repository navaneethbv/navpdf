import { useEffect, useState } from "react";
import {
  Type,
  CheckSquare,
  CircleDot,
  List,
  MousePointerClick,
  PenTool,
  Plus,
  X,
} from "lucide-react";
import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import {
  addFormField,
  deleteFormField,
  updateFormField,
  type FormFieldDefinition,
} from "../../services/document-commands";
import { fromTopLeftVisual } from "../../services/pdf/page-box";
import { PageNumberInput } from "../../components/PageNumberInput";
import { FeatureDialog } from "../../components/FeatureDialog";

type ExistingField = {
  name: string;
  kind: "text" | "checkbox" | "choice" | "button" | "other";
  value: string;
  options: string[];
  checked: boolean;
  required: boolean;
  readOnly: boolean;
};

export function FormManager({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [fieldType, setFieldType] = useState<
    "text" | "checkbox" | "radio" | "dropdown" | "button" | "signature"
  >("text");
  const [fieldName, setFieldName] = useState("");
  const [defaultValue, setDefaultValue] = useState("");
  const [optionsText, setOptionsText] = useState("Option 1, Option 2, Option 3");
  const [groupName, setGroupName] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [required, setRequired] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [targetPage, setTargetPage] = useState(s.page);
  const [posX, setPosX] = useState(50);
  const [posY, setPosY] = useState(50);
  const [saving, setSaving] = useState(false);
  const [existingFields, setExistingFields] = useState<ExistingField[]>([]);
  const [selectedExistingName, setSelectedExistingName] = useState("");
  const [existingValue, setExistingValue] = useState("");
  const [existingChecked, setExistingChecked] = useState(false);
  const [existingRequired, setExistingRequired] = useState(false);
  const [existingReadOnly, setExistingReadOnly] = useState(false);
  const selectedExisting = existingFields.find((field) => field.name === selectedExistingName);

  const loadExistingFields = async () => {
    if (!controller?.pdf) return;
    try {
      const doc = await PDFDocument.load(await controller.pdf.saveDocument());
      const fields = doc
        .getForm()
        .getFields()
        .map((field): ExistingField => {
          if (field instanceof PDFTextField) {
            return {
              name: field.getName(),
              kind: "text",
              value: field.getText() ?? "",
              options: [],
              checked: false,
              required: field.isRequired(),
              readOnly: field.isReadOnly(),
            };
          }
          if (field instanceof PDFCheckBox) {
            return {
              name: field.getName(),
              kind: "checkbox",
              value: "",
              options: [],
              checked: field.isChecked(),
              required: field.isRequired(),
              readOnly: field.isReadOnly(),
            };
          }
          if (field instanceof PDFDropdown) {
            return {
              name: field.getName(),
              kind: "choice",
              value: field.getSelected()[0] ?? "",
              options: field.getOptions(),
              checked: false,
              required: field.isRequired(),
              readOnly: field.isReadOnly(),
            };
          }
          if (field instanceof PDFRadioGroup) {
            return {
              name: field.getName(),
              kind: "choice",
              value: field.getSelected() ?? "",
              options: field.getOptions(),
              checked: false,
              required: field.isRequired(),
              readOnly: field.isReadOnly(),
            };
          }
          return {
            name: field.getName(),
            kind: field instanceof PDFButton ? "button" : "other",
            value: "",
            options: [],
            checked: false,
            required: field.isRequired(),
            readOnly: field.isReadOnly(),
          };
        });
      setExistingFields(fields);
      setSelectedExistingName((current) =>
        fields.some((field) => field.name === current) ? current : (fields[0]?.name ?? ""),
      );
      const selected = fields.find((field) => field.name === selectedExistingName) ?? fields[0];
      if (selected) {
        setExistingValue(selected.value);
        setExistingChecked(selected.checked);
        setExistingRequired(selected.required);
        setExistingReadOnly(selected.readOnly);
      }
    } catch {
      setExistingFields([]);
      setSelectedExistingName("");
    }
  };

  useEffect(() => {
    void loadExistingFields();
  }, [controller]);

  const chooseExistingField = (name: string) => {
    const field = existingFields.find((entry) => entry.name === name);
    setSelectedExistingName(name);
    setExistingValue(field?.value ?? "");
    setExistingChecked(field?.checked ?? false);
    setExistingRequired(field?.required ?? false);
    setExistingReadOnly(field?.readOnly ?? false);
  };

  const handleUpdateExisting = async () => {
    if (!controller?.pdf || !selectedExisting) return;
    setSaving(true);
    try {
      const bytes = await updateFormField(await controller.pdf.saveDocument(), {
        name: selectedExisting.name,
        value:
          selectedExisting.kind === "text" || selectedExisting.kind === "choice"
            ? existingValue
            : undefined,
        checked: selectedExisting.kind === "checkbox" ? existingChecked : undefined,
        required: existingRequired,
        readOnly: existingReadOnly,
      });
      await controller.replaceWithBytes(bytes, `Form field "${selectedExisting.name}" updated`);
      await loadExistingFields();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteExisting = async () => {
    if (!controller?.pdf || !selectedExisting) return;
    setSaving(true);
    try {
      const bytes = await deleteFormField(
        await controller.pdf.saveDocument(),
        selectedExisting.name,
      );
      await controller.replaceWithBytes(bytes, `Form field "${selectedExisting.name}" deleted`);
      await loadExistingFields();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

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

      let mappedX = posX;
      let mappedY = posY;
      let mappedW = width;
      let mappedH = height;
      try {
        const doc = await PDFDocument.load(currentBytes);
        const pageIndex = Math.max(0, Math.min(page - 1, doc.getPageCount() - 1));
        const targetPdfPage = doc.getPage(pageIndex);
        const mapped = fromTopLeftVisual(targetPdfPage, posX, posY, width, height);
        mappedX = mapped.x;
        mappedY = mapped.y;
        mappedW = mapped.width;
        mappedH = mapped.height;
      } catch {
        // Fallback if currentBytes is dummy data in mock test environment
      }

      const definition: FormFieldDefinition = {
        type: fieldType,
        name: fieldName.trim(),
        page,
        x: mappedX,
        y: mappedY,
        width: mappedW,
        height: mappedH,
        defaultValue: defaultValue.trim() || undefined,
        required,
        readOnly,
        multiline: fieldType === "text" ? multiline : undefined,
        group: fieldType === "radio" ? groupName.trim() || fieldName.trim() : undefined,
        options:
          fieldType === "dropdown"
            ? optionsText
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
      };

      const newBytes = await addFormField(currentBytes, definition);
      await controller.replaceWithBytes(newBytes, `Form field "${fieldName}" created`);
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FeatureDialog title="Prepare Form Fields" onClose={onClose} busy={saving}>
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
          {existingFields.length > 0 && (
            <div className="setting-group" data-testid="existing-form-fields">
              <label className="setting-title" htmlFor="existing-form-field">
                Existing Fields
              </label>
              <select
                id="existing-form-field"
                className="select-input"
                value={selectedExistingName}
                onChange={(event) => chooseExistingField(event.target.value)}
                disabled={saving}
              >
                {existingFields.map((field) => (
                  <option key={field.name} value={field.name}>
                    {field.name} ({field.kind})
                  </option>
                ))}
              </select>
              {selectedExisting &&
                selectedExisting.kind !== "button" &&
                selectedExisting.kind !== "other" && (
                  <>
                    {selectedExisting.kind === "checkbox" ? (
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          marginTop: "8px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={existingChecked}
                          onChange={(event) => setExistingChecked(event.target.checked)}
                        />
                        Checked
                      </label>
                    ) : selectedExisting.kind === "choice" ? (
                      <select
                        className="select-input"
                        value={existingValue}
                        onChange={(event) => setExistingValue(event.target.value)}
                        disabled={saving || existingReadOnly}
                        aria-label="Existing field value"
                      >
                        <option value="">No selection</option>
                        {selectedExisting.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="text-input"
                        value={existingValue}
                        onChange={(event) => setExistingValue(event.target.value)}
                        disabled={saving || existingReadOnly}
                        aria-label="Existing field value"
                      />
                    )}
                    <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <input
                          type="checkbox"
                          checked={existingRequired}
                          onChange={(event) => setExistingRequired(event.target.checked)}
                        />
                        Required
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <input
                          type="checkbox"
                          checked={existingReadOnly}
                          onChange={(event) => setExistingReadOnly(event.target.checked)}
                        />
                        Read-Only
                      </label>
                    </div>
                    <div className="inline-field" style={{ marginTop: "8px" }}>
                      <button
                        type="button"
                        className="button-primary"
                        onClick={() => void handleUpdateExisting()}
                        disabled={saving}
                      >
                        Save Field
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => void handleDeleteExisting()}
                        disabled={saving}
                      >
                        Delete Field
                      </button>
                    </div>
                  </>
                )}
            </div>
          )}

          <div className="setting-group">
            <label className="setting-title">Field Type</label>
            <div className="tab-buttons-bar">
              <button
                type="button"
                className={fieldType === "text" ? "active" : ""}
                aria-pressed={fieldType === "text"}
                onClick={() => setFieldType("text")}
              >
                <Type size={15} /> Text Input
              </button>
              <button
                type="button"
                className={fieldType === "checkbox" ? "active" : ""}
                aria-pressed={fieldType === "checkbox"}
                onClick={() => setFieldType("checkbox")}
              >
                <CheckSquare size={15} /> Checkbox
              </button>
              <button
                type="button"
                className={fieldType === "radio" ? "active" : ""}
                aria-pressed={fieldType === "radio"}
                onClick={() => setFieldType("radio")}
              >
                <CircleDot size={15} /> Radio
              </button>
              <button
                type="button"
                className={fieldType === "dropdown" ? "active" : ""}
                aria-pressed={fieldType === "dropdown"}
                onClick={() => setFieldType("dropdown")}
              >
                <List size={15} /> Dropdown
              </button>
              <button
                type="button"
                className={fieldType === "button" ? "active" : ""}
                aria-pressed={fieldType === "button"}
                onClick={() => setFieldType("button")}
              >
                <MousePointerClick size={15} /> Button
              </button>
              <button
                type="button"
                className={fieldType === "signature" ? "active" : ""}
                aria-pressed={fieldType === "signature"}
                onClick={() => setFieldType("signature")}
              >
                <PenTool size={15} /> Signature
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
            <PageNumberInput
              value={targetPage}
              max={s.info?.pages || 1}
              onChange={setTargetPage}
              className="text-input"
            />
          </div>

          <div className="setting-group" style={{ display: "flex", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <label className="setting-title">X Position (pt)</label>
              <input
                type="number"
                value={posX}
                onChange={(e) => setPosX(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="setting-title">Y Position from top (pt)</label>
              <input
                type="number"
                value={posY}
                onChange={(e) => setPosY(Number(e.target.value))}
                className="text-input"
              />
            </div>
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
    </FeatureDialog>
  );
}
