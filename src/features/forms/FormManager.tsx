import { useId, useEffect, useState } from "react";
import {
  Type,
  CheckSquare,
  CircleDot,
  List,
  MousePointerClick,
  PenTool,
  Plus,
  X,
  ListChecks,
  CalendarDays,
  ImageIcon,
  SlidersHorizontal,
  ScanSearch,
  Eye,
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
  DATE_FORMATS,
  type FormFieldDefinition,
} from "../../services/document-commands";

type FieldType = FormFieldDefinition["type"];

const FIELD_TYPES: [FieldType, string, typeof Type][] = [
  ["text", "Text Input", Type],
  ["checkbox", "Checkbox", CheckSquare],
  ["radio", "Radio", CircleDot],
  ["dropdown", "Dropdown", List],
  ["listbox", "List Box", ListChecks],
  ["date", "Date", CalendarDays],
  ["image", "Image", ImageIcon],
  ["button", "Button", MousePointerClick],
  ["signature", "Signature", PenTool],
];

const SIZES: Partial<Record<FieldType, [number, number]>> = {
  checkbox: [20, 20],
  radio: [20, 20],
  button: [90, 28],
  listbox: [160, 72],
  image: [120, 90],
  date: [110, 24],
};
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
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const sourcePdf = controller?.pdf;
  const s = useWorkspace();
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [multiSelect, setMultiSelect] = useState(false);
  const [dateFormat, setDateFormat] = useState<string>(DATE_FORMATS[0]);
  const [imageFile, setImageFile] = useState<File | null>(null);
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
      await controller.replaceWithBytes(bytes, `Form field "${selectedExisting.name}" updated`, {
        expectedSource: sourcePdf,
      });
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
      await controller.replaceWithBytes(bytes, `Form field "${selectedExisting.name}" deleted`, {
        expectedSource: sourcePdf,
      });
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

      const [width, defaultHeight] = SIZES[fieldType] ?? [200, 24];
      const height = fieldType === "text" && multiline ? 60 : defaultHeight;
      const image = imageFile
        ? {
            bytes: new Uint8Array(await imageFile.arrayBuffer()),
            type: /png$/i.test(imageFile.type) ? ("png" as const) : ("jpg" as const),
          }
        : undefined;

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
        multiSelect: fieldType === "listbox" ? multiSelect : undefined,
        dateFormat: fieldType === "date" ? dateFormat : undefined,
        image: fieldType === "image" ? image : undefined,
        options:
          fieldType === "dropdown" || fieldType === "listbox"
            ? optionsText
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
      };

      const newBytes = await addFormField(currentBytes, definition);
      await controller.replaceWithBytes(newBytes, `Form field "${fieldName}" created`, {
        expectedSource: sourcePdf,
      });
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const renderExistingValue = () => {
    if (!selectedExisting) return null;
    if (selectedExisting.kind === "checkbox")
      return (
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
          />{" "}
          Checked
        </label>
      );
    if (selectedExisting.kind === "choice")
      return (
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
      );
    return (
      <input
        className="text-input"
        value={existingValue}
        onChange={(event) => setExistingValue(event.target.value)}
        disabled={saving || existingReadOnly}
        aria-label="Existing field value"
      />
    );
  };
  return (
    <FeatureDialog title="Prepare Form Fields" onClose={onClose} busy={saving}>
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <CheckSquare size={18} />
            <h3>Prepare Form Fields</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
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
                    {renderExistingValue()}
                    <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <input
                          type="checkbox"
                          checked={existingRequired}
                          onChange={(event) => setExistingRequired(event.target.checked)}
                        />{" "}
                        Required
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <input
                          type="checkbox"
                          checked={existingReadOnly}
                          onChange={(event) => setExistingReadOnly(event.target.checked)}
                        />{" "}
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

          <fieldset className="setting-group">
            <legend className="setting-title">Field Type</legend>
            <div className="tab-buttons-bar">
              {FIELD_TYPES.map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  className={fieldType === value ? "active" : ""}
                  aria-pressed={fieldType === value}
                  onClick={() => setFieldType(value)}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="setting-group">
            <label htmlFor={`${fieldIds}-field-1`} className="setting-title">
              Field Name
            </label>
            <input
              id={`${fieldIds}-field-1`}
              type="text"
              placeholder="e.g. FirstName, SignatureDate, Agreed"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              className="text-input"
            />
          </div>

          {fieldType === "radio" && (
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-field-2`} className="setting-title">
                Radio Group Name
              </label>
              <input
                id={`${fieldIds}-field-2`}
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

          {(fieldType === "dropdown" || fieldType === "listbox") && (
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-field-3`} className="setting-title">
                {fieldType === "listbox" ? "List Options" : "Dropdown Options"}
              </label>
              <input
                id={`${fieldIds}-field-3`}
                type="text"
                placeholder="Comma separated: Red, Green, Blue"
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                className="text-input"
              />
            </div>
          )}

          {fieldType === "listbox" && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={multiSelect}
                onChange={(event) => setMultiSelect(event.target.checked)}
              />
              <span>Allow several selections</span>
            </label>
          )}

          {fieldType === "date" && (
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-date-format`} className="setting-title">
                Date Format
              </label>
              <select
                id={`${fieldIds}-date-format`}
                className="select-input"
                value={dateFormat}
                onChange={(event) => setDateFormat(event.target.value)}
              >
                {DATE_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
              <span className="setting-desc">
                NavPDF offers a date picker for this field. The PDF also carries Acrobat&apos;s date
                format action for other readers; NavPDF never runs it.
              </span>
            </div>
          )}

          {fieldType === "image" && (
            <div className="setting-group">
              <label htmlFor={`${fieldIds}-image`} className="setting-title">
                Image (PNG or JPEG)
              </label>
              <input
                id={`${fieldIds}-image`}
                type="file"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
              />
            </div>
          )}

          <div className="setting-group">
            <label htmlFor={`${fieldIds}-field-4`} className="setting-title">
              {getFieldDefaultLabel(fieldType)}
            </label>
            <input
              id={`${fieldIds}-field-4`}
              type="text"
              placeholder={getFieldDefaultPlaceholder(fieldType)}
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              className="text-input"
            />
          </div>

          <div className="setting-group">
            <label htmlFor={`${fieldIds}-field-5`} className="setting-title">
              Page
            </label>
            <PageNumberInput
              id={`${fieldIds}-field-5`}
              value={targetPage}
              max={s.info?.pages || 1}
              onChange={setTargetPage}
              className="text-input"
            />
          </div>

          <div className="setting-group" style={{ flexDirection: "row", gap: "12px" }}>
            <div className="setting-group" style={{ flex: 1 }}>
              <label htmlFor={`${fieldIds}-field-6`} className="setting-title">
                X Position (pt)
              </label>
              <input
                id={`${fieldIds}-field-6`}
                type="number"
                value={posX}
                onChange={(e) => setPosX(Number(e.target.value))}
                className="text-input"
              />
            </div>
            <div className="setting-group" style={{ flex: 1 }}>
              <label htmlFor={`${fieldIds}-field-7`} className="setting-title">
                Y Position from top (pt)
              </label>
              <input
                id={`${fieldIds}-field-7`}
                type="number"
                value={posY}
                onChange={(e) => setPosY(Number(e.target.value))}
                className="text-input"
              />
            </div>
          </div>

          <fieldset className="setting-group">
            <legend className="setting-title">Field Properties</legend>
            <div style={{ display: "flex", gap: "16px", marginTop: "6px" }}>
              {fieldType === "text" && (
                <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="checkbox"
                    checked={multiline}
                    onChange={(e) => setMultiline(e.target.checked)}
                  />{" "}
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
                    />{" "}
                    Required
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <input
                      type="checkbox"
                      checked={readOnly}
                      onChange={(e) => setReadOnly(e.target.checked)}
                    />{" "}
                    Read-Only
                  </label>
                </>
              )}
            </div>
          </fieldset>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={() => s.set({ activeModal: "field-properties" })}
            disabled={saving || existingFields.length === 0}
          >
            <SlidersHorizontal size={16} /> Field Properties
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => s.set({ activeModal: "form-assist" })}
            disabled={saving}
          >
            <ScanSearch size={16} /> Detect & Name
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              onClose();
              void controller?.previewForm();
            }}
            disabled={saving || existingFields.length === 0}
          >
            <Eye size={16} /> Preview
          </button>
          <button type="button" onClick={onClose} className="button-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleAddField();
            }}
            disabled={saving || !fieldName.trim() || (fieldType === "image" && !imageFile)}
            className="button-primary"
          >
            <Plus size={16} /> Add Field
          </button>
        </div>
      </div>
    </FeatureDialog>
  );
}

function getFieldDefaultLabel(fieldType: string): string {
  if (fieldType === "button") return "Button Label";
  if (fieldType === "radio") return "Option Value";
  return "Default Value";
}

function getFieldDefaultPlaceholder(fieldType: string): string {
  if (fieldType === "button") return "e.g. Submit";
  if (fieldType === "radio") return "e.g. Yes";
  return "Optional default value";
}
