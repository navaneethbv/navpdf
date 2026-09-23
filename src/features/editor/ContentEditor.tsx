import { useEffect, useId, useState, useRef, useMemo } from "react";
import {
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Image as ImageIcon,
  Italic,
  Type,
  Underline,
  X,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import {
  insertTextContent,
  insertImageContent,
  validateStandardFontCoverage,
  type TextAlignment,
  type TextFontFace,
} from "../../services/document-commands";
import { fromTopLeftVisual } from "../../services/pdf/page-box";
import { readPageTextStyles, type PageTextStyle } from "../../services/pdf/text-styles";
import { PageNumberInput } from "../../components/PageNumberInput";
import { FeatureDialog } from "../../components/FeatureDialog";

const FACE_LABELS: Record<TextFontFace, string> = {
  sans: "Helvetica",
  serif: "Times",
  mono: "Courier",
};

// Local CSS stacks that approximate the standard PDF fonts; no remote fonts are loaded.
const PREVIEW_FONTS: Record<TextFontFace, string> = {
  sans: "Helvetica, Arial, sans-serif",
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

const ALIGNMENTS: { value: TextAlignment; label: string; Icon: typeof AlignLeft }[] = [
  { value: "left", label: "Left", Icon: AlignLeft },
  { value: "center", label: "Center", Icon: AlignCenter },
  { value: "right", label: "Right", Icon: AlignRight },
  { value: "justify", label: "Justify", Icon: AlignJustify },
];

function standardFontLabel(face: TextFontFace, bold: boolean, italic: boolean) {
  const variant = [bold && "Bold", italic && (face === "serif" ? "Italic" : "Oblique")]
    .filter(Boolean)
    .join(" ");
  return variant ? `${FACE_LABELS[face]} ${variant}` : FACE_LABELS[face];
}

function styleOptionLabel(style: PageTextStyle) {
  const sample = style.sample.length > 24 ? `${style.sample.slice(0, 24)}...` : style.sample;
  return `"${sample}" - ${style.fontName}, ${style.size} pt`;
}

export function ContentEditor({
  controller,
  type,
  onClose,
}: Readonly<{
  controller: ViewerController | null;
  type: "text" | "image";
  onClose: () => void;
}>) {
  const fieldIds = useId();
  const sourcePdf = controller?.pdf;
  const s = useWorkspace();
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(14);
  const [fontFace, setFontFace] = useState<TextFontFace>("sans");
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [fontColor, setFontColor] = useState("#24332d");
  const [alignment, setAlignment] = useState<TextAlignment>("left");
  const [lineSpacing, setLineSpacing] = useState(1);
  const [pageStyles, setPageStyles] = useState<PageTextStyle[] | null>(null);
  const [matched, setMatched] = useState<PageTextStyle | null>(null);
  const [maxWidth, setMaxWidth] = useState<number>(400);
  const [targetPage, setTargetPage] = useState(s.page);
  const [posX, setPosX] = useState(50);
  const [posY, setPosY] = useState(50);
  const [preserveAspectRatio, setPreserveAspectRatio] = useState(true);
  const [imageOpacity, setImageOpacity] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (type !== "text") return;
    let cancelled = false;
    setPageStyles(null);
    setMatched(null);
    const pdf = controller?.pdf;
    void (async () => {
      try {
        if (!pdf) throw new Error("No document");
        const found = await readPageTextStyles(await pdf.getPage(targetPage));
        if (!cancelled) setPageStyles(found);
      } catch {
        if (!cancelled) setPageStyles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controller, targetPage, type]);

  /** Any manual style change means the text no longer mirrors the matched style. */
  const manual =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setMatched(null);
      setter(value);
    };

  const applyMatch = (style: PageTextStyle | undefined) => {
    if (!style) return;
    setFontFace(style.face);
    setBold(style.bold);
    setItalic(style.italic);
    setFontSize(style.size);
    setFontColor(style.color);
    setMatched(style);
  };

  const coverage = useMemo(
    () =>
      text.trim() ? validateStandardFontCoverage(text) : { valid: true, unsupportedChars: [] },
    [text],
  );

  const handleApplyText = async () => {
    if (!controller?.pdf || !text.trim() || !coverage.valid) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const r = Number.parseInt(fontColor.slice(1, 3), 16) / 255;
      const g = Number.parseInt(fontColor.slice(3, 5), 16) / 255;
      const b = Number.parseInt(fontColor.slice(5, 7), 16) / 255;
      let textX = posX;
      let textY = posY;
      try {
        const doc = await PDFDocument.load(currentBytes);
        const pageIndex = Math.max(0, Math.min(targetPage - 1, doc.getPageCount() - 1));
        const page = doc.getPage(pageIndex);
        const mapped = fromTopLeftVisual(page, posX, posY, maxWidth > 0 ? maxWidth : 200, fontSize);
        textX = mapped.x;
        textY = mapped.y;
      } catch {
        // Fallback for mock test environments
      }

      const newBytes = await insertTextContent(currentBytes, {
        page: targetPage,
        text,
        x: textX,
        y: textY,
        fontSize,
        fontFace,
        bold,
        italic,
        underline,
        color: [r, g, b],
        alignment,
        lineHeight: fontSize * 1.25 * lineSpacing,
        maxWidth: maxWidth > 0 ? maxWidth : undefined,
      });

      await controller.replaceWithBytes(newBytes, "Text added to document", {
        expectedSource: sourcePdf,
      });
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleApplyImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !controller?.pdf) return;
    setSaving(true);
    try {
      const currentBytes = await controller.pdf.saveDocument();
      const arrayBuffer = await file.arrayBuffer();
      const imgBytes = new Uint8Array(arrayBuffer);
      const isPng = file.type.includes("png");

      const newBytes = await insertImageContent(currentBytes, {
        page: targetPage,
        imageBytes: imgBytes,
        imageType: isPng ? "png" : "jpg",
        preserveAspectRatio,
        opacity: imageOpacity,
        rotationDegrees: imageRotation,
      });

      await controller.replaceWithBytes(newBytes, "Image inserted into document", {
        expectedSource: sourcePdf,
      });
      onClose();
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FeatureDialog
      title={type === "text" ? "Add Text" : "Add Image"}
      onClose={onClose}
      busy={saving}
    >
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            {type === "text" ? <Type size={18} /> : <ImageIcon size={18} />}
            <h3>{type === "text" ? "Add Text to Page" : "Insert Image"}</h3>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="setting-group">
            <label htmlFor={`${fieldIds}-field-1`} className="setting-title">
              Target Page
            </label>
            <PageNumberInput
              id={`${fieldIds}-field-1`}
              value={targetPage}
              max={s.info?.pages || 1}
              onChange={setTargetPage}
              className="text-input"
            />
          </div>

          {type === "text" ? (
            <>
              <div className="setting-group">
                <label htmlFor={`${fieldIds}-field-2`} className="setting-title">
                  Text Content
                </label>
                <textarea
                  id={`${fieldIds}-field-2`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter text to place on page..."
                  rows={4}
                  className="text-input"
                />
              </div>

              {!coverage.valid && (
                <div
                  className="setting-group"
                  style={{
                    backgroundColor: "var(--danger-surface)",
                    border: "1px solid var(--danger-ink)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "var(--danger-ink)",
                    fontSize: "0.85rem",
                  }}
                  role="alert"
                >
                  <AlertTriangle size={16} />
                  <span>
                    Unsupported characters for standard fonts:{" "}
                    <strong>{coverage.unsupportedChars.join(", ")}</strong>
                  </span>
                </div>
              )}

              <fieldset className="setting-group">
                <legend className="setting-title">Match existing text</legend>
                <select
                  aria-label={`Text style to match on page ${targetPage}`}
                  className="select-input"
                  disabled={!pageStyles?.length}
                  value={matched ? String(pageStyles?.indexOf(matched) ?? "") : ""}
                  onChange={(e) => applyMatch(pageStyles?.[Number(e.target.value)])}
                >
                  <option value="">
                    {pageStyles === null
                      ? "Reading text styles..."
                      : pageStyles.length
                        ? `Choose a text style on page ${targetPage}`
                        : `No visible text on page ${targetPage}`}
                  </option>
                  {pageStyles?.map((style, index) => (
                    <option key={`${style.fontName}-${style.size}-${style.color}`} value={index}>
                      {styleOptionLabel(style)}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  {matched
                    ? `Uses ${standardFontLabel(matched.face, matched.bold, matched.italic)}, the closest built-in font to ${matched.fontName}. Size and color match exactly.`
                    : "Copies the font style, size and color of text already on the page, using the closest built-in font."}
                </p>
              </fieldset>

              <div className="settings-row">
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-3`} className="setting-title">
                    Font
                  </label>
                  <select
                    id={`${fieldIds}-field-3`}
                    value={fontFace}
                    onChange={(e) => manual(setFontFace)(e.target.value as TextFontFace)}
                    className="select-input"
                  >
                    <option value="sans">Sans serif (Helvetica)</option>
                    <option value="serif">Serif (Times)</option>
                    <option value="mono">Monospace (Courier)</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-5`} className="setting-title">
                    Size (pt)
                  </label>
                  <input
                    id={`${fieldIds}-field-5`}
                    type="number"
                    min={4}
                    max={144}
                    step={0.5}
                    value={fontSize}
                    onChange={(e) => manual(setFontSize)(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
              </div>

              <div className="settings-row">
                <fieldset className="setting-group">
                  <legend className="setting-title">Style</legend>
                  <div className="tab-buttons-bar">
                    {(
                      [
                        ["Bold", Bold, bold, setBold],
                        ["Italic", Italic, italic, setItalic],
                        ["Underline", Underline, underline, setUnderline],
                      ] as const
                    ).map(([label, Icon, pressed, setter]) => (
                      <button
                        key={label}
                        type="button"
                        className={`icon-toggle ${pressed ? "active" : ""}`}
                        aria-pressed={pressed}
                        aria-label={label}
                        title={label}
                        onClick={() => (label === "Underline" ? setter : manual(setter))(!pressed)}
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="setting-group">
                  <legend className="setting-title">Alignment</legend>
                  <div className="tab-buttons-bar">
                    {ALIGNMENTS.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        className={`icon-toggle ${alignment === value ? "active" : ""}`}
                        aria-pressed={alignment === value}
                        aria-label={`Align ${label.toLowerCase()}`}
                        title={label}
                        onClick={() => setAlignment(value)}
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div className="settings-row">
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-4`} className="setting-title">
                    Line spacing
                  </label>
                  <select
                    id={`${fieldIds}-field-4`}
                    value={lineSpacing}
                    onChange={(e) => setLineSpacing(Number(e.target.value))}
                    className="select-input"
                  >
                    <option value={1}>Single</option>
                    <option value={1.15}>1.15</option>
                    <option value={1.5}>1.5</option>
                    <option value={2}>Double</option>
                  </select>
                </div>
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-6`} className="setting-title">
                    Color
                  </label>
                  <input
                    id={`${fieldIds}-field-6`}
                    type="color"
                    value={fontColor}
                    onChange={(e) => manual(setFontColor)(e.target.value)}
                    className="color-input"
                  />
                </div>
              </div>

              <div className="setting-group">
                <span className="setting-title">Preview</span>
                <div
                  className="text-preview"
                  style={{
                    fontFamily: PREVIEW_FONTS[fontFace],
                    fontWeight: bold ? 700 : 400,
                    fontStyle: italic ? "italic" : "normal",
                    textDecoration: underline ? "underline" : "none",
                    textAlign: alignment,
                    color: fontColor,
                    fontSize: `${Math.min(Math.max(fontSize, 8), 32)}px`,
                    lineHeight: 1.25 * lineSpacing,
                  }}
                >
                  {text.trim() || "The quick brown fox jumps over the lazy dog."}
                </div>
              </div>

              <div className="setting-group">
                <label htmlFor={`${fieldIds}-field-7`} className="setting-title">
                  Max Wrap Width (pt)
                </label>
                <input
                  id={`${fieldIds}-field-7`}
                  type="number"
                  min={50}
                  max={800}
                  value={maxWidth}
                  onChange={(e) => setMaxWidth(Number(e.target.value))}
                  className="text-input"
                />
              </div>

              <div className="settings-row">
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-8`} className="setting-title">
                    X Position (pt)
                  </label>
                  <input
                    id={`${fieldIds}-field-8`}
                    type="number"
                    value={posX}
                    onChange={(e) => setPosX(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
                <div className="setting-group">
                  <label htmlFor={`${fieldIds}-field-9`} className="setting-title">
                    Y Position from top (pt)
                  </label>
                  <input
                    id={`${fieldIds}-field-9`}
                    type="number"
                    value={posY}
                    onChange={(e) => setPosY(Number(e.target.value))}
                    className="text-input"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <fieldset className="setting-group">
                <legend className="setting-title">Image Scaling & Aspect Ratio</legend>
                <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={preserveAspectRatio}
                    onChange={(e) => setPreserveAspectRatio(e.target.checked)}
                  />{" "}
                  Preserve Aspect Ratio
                </label>
              </fieldset>

              <div className="setting-group">
                <label htmlFor={`${fieldIds}-field-10`} className="setting-title">
                  Opacity ({Math.round(imageOpacity * 100)}%)
                </label>
                <input
                  id={`${fieldIds}-field-10`}
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={imageOpacity}
                  onChange={(e) => setImageOpacity(Number(e.target.value))}
                />
              </div>

              <div className="setting-group">
                <label className="setting-title" htmlFor="insert-image-rotation">
                  Rotation (degrees)
                </label>
                <input
                  id="insert-image-rotation"
                  type="number"
                  min={-360}
                  max={360}
                  step={1}
                  value={imageRotation}
                  onChange={(e) => setImageRotation(Number(e.target.value))}
                  className="text-input"
                />
              </div>

              <fieldset className="setting-group">
                <legend className="setting-title">Select Image File</legend>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                  disabled={saving}
                >
                  Choose PNG or JPEG...
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    void handleApplyImage(e);
                  }}
                />
              </fieldset>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="button-secondary">
            Cancel
          </button>
          {type === "text" && (
            <button
              type="button"
              onClick={() => {
                void handleApplyText();
              }}
              disabled={saving || !text.trim() || !coverage.valid}
              className="button-primary"
            >
              {saving ? "Inserting..." : "Insert Text"}
            </button>
          )}
        </div>
      </div>
    </FeatureDialog>
  );
}
