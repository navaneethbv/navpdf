import { useEffect, useId, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextAlignment, TextFontFace } from "../../services/document-commands";
import { readPageTextStyles, type PageTextStyle } from "../../services/pdf/text-styles";

export interface TextStyle {
  face: TextFontFace;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  size: number;
  color: string;
  alignment: TextAlignment;
  lineSpacing: number;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  face: "sans",
  bold: false,
  italic: false,
  underline: false,
  size: 14,
  color: "#24332d",
  alignment: "left",
  lineSpacing: 1,
};

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

const TOGGLES = [
  { key: "bold", label: "Bold", Icon: Bold },
  { key: "italic", label: "Italic", Icon: Italic },
  { key: "underline", label: "Underline", Icon: Underline },
] as const;

function standardFontLabel(style: Pick<TextStyle, "face" | "bold" | "italic">) {
  const slant = style.face === "serif" ? "Italic" : "Oblique";
  const variant = [style.bold && "Bold", style.italic && slant].filter(Boolean).join(" ");
  return variant ? `${FACE_LABELS[style.face]} ${variant}` : FACE_LABELS[style.face];
}

function styleOptionLabel(style: PageTextStyle) {
  const sample = style.sample.length > 24 ? `${style.sample.slice(0, 24)}...` : style.sample;
  return `"${sample}" - ${style.fontName}, ${style.size} pt`;
}

function pickerPrompt(styles: PageTextStyle[] | null, page: number) {
  if (styles === null) return "Reading text styles...";
  if (styles.length === 0) return `No visible text on page ${page}`;
  return `Choose a text style on page ${page}`;
}

/** Reads the visible text styles of one page, resetting while a new page loads. */
function usePageTextStyles(pdf: PDFDocumentProxy | null | undefined, page: number) {
  const [styles, setStyles] = useState<PageTextStyle[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setStyles(null);
    void (async () => {
      try {
        if (!pdf) throw new Error("No document");
        const found = await readPageTextStyles(await pdf.getPage(page));
        if (!cancelled) setStyles(found);
      } catch {
        if (!cancelled) setStyles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, page]);
  return styles;
}

export function TextStyleControls({
  pdf,
  page,
  text,
  value,
  onChange,
}: Readonly<{
  pdf: PDFDocumentProxy | null | undefined;
  page: number;
  text: string;
  value: TextStyle;
  onChange: (value: TextStyle) => void;
}>) {
  const ids = useId();
  const pageStyles = usePageTextStyles(pdf, page);
  const [matched, setMatched] = useState<PageTextStyle | null>(null);
  useEffect(() => {
    setMatched(null);
  }, [pdf, page]);

  /** Font, size and color changes mean the text no longer mirrors the matched style. */
  const update = (patch: Partial<TextStyle>) => {
    if (["face", "bold", "italic", "size", "color"].some((key) => key in patch)) setMatched(null);
    onChange({ ...value, ...patch });
  };

  const applyMatch = (style: PageTextStyle | undefined) => {
    if (!style) return;
    const { face, bold, italic, size, color } = style;
    onChange({ ...value, face, bold, italic, size, color });
    setMatched(style);
  };

  return (
    <>
      <fieldset className="setting-group">
        <legend className="setting-title">Match existing text</legend>
        <select
          aria-label={`Text style to match on page ${page}`}
          className="select-input"
          disabled={!pageStyles?.length}
          value={matched && pageStyles ? String(pageStyles.indexOf(matched)) : ""}
          onChange={(e) => {
            applyMatch(pageStyles?.[Number(e.target.value)]);
          }}
        >
          <option value="">{pickerPrompt(pageStyles, page)}</option>
          {pageStyles?.map((style, index) => (
            <option key={`${style.fontName}-${style.size}-${style.color}`} value={index}>
              {styleOptionLabel(style)}
            </option>
          ))}
        </select>
        <p className="field-hint">
          {matched
            ? `Uses ${standardFontLabel(matched)}, the closest built-in font to ${matched.fontName}. Size and color match exactly.`
            : "Copies the font style, size and color of text already on the page, using the closest built-in font."}
        </p>
      </fieldset>

      <div className="settings-row">
        <div className="setting-group">
          <label htmlFor={`${ids}-font`} className="setting-title">
            Font
          </label>
          <select
            id={`${ids}-font`}
            value={value.face}
            onChange={(e) => {
              update({ face: e.target.value as TextFontFace });
            }}
            className="select-input"
          >
            <option value="sans">Sans serif (Helvetica)</option>
            <option value="serif">Serif (Times)</option>
            <option value="mono">Monospace (Courier)</option>
          </select>
        </div>
        <div className="setting-group">
          <label htmlFor={`${ids}-size`} className="setting-title">
            Size (pt)
          </label>
          <input
            id={`${ids}-size`}
            type="number"
            min={4}
            max={144}
            step={0.5}
            value={value.size}
            onChange={(e) => {
              update({ size: Number(e.target.value) });
            }}
            className="text-input"
          />
        </div>
      </div>

      <div className="settings-row">
        <fieldset className="setting-group">
          <legend className="setting-title">Style</legend>
          <div className="tab-buttons-bar">
            {TOGGLES.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                className={`icon-toggle ${value[key] ? "active" : ""}`}
                aria-pressed={value[key]}
                aria-label={label}
                title={label}
                onClick={() => {
                  update({ [key]: !value[key] });
                }}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="setting-group">
          <legend className="setting-title">Alignment</legend>
          <div className="tab-buttons-bar">
            {ALIGNMENTS.map(({ value: alignment, label, Icon }) => (
              <button
                key={alignment}
                type="button"
                className={`icon-toggle ${value.alignment === alignment ? "active" : ""}`}
                aria-pressed={value.alignment === alignment}
                aria-label={`Align ${label.toLowerCase()}`}
                title={label}
                onClick={() => {
                  update({ alignment });
                }}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="settings-row">
        <div className="setting-group">
          <label htmlFor={`${ids}-spacing`} className="setting-title">
            Line spacing
          </label>
          <select
            id={`${ids}-spacing`}
            value={value.lineSpacing}
            onChange={(e) => {
              update({ lineSpacing: Number(e.target.value) });
            }}
            className="select-input"
          >
            <option value={1}>Single</option>
            <option value={1.15}>1.15</option>
            <option value={1.5}>1.5</option>
            <option value={2}>Double</option>
          </select>
        </div>
        <div className="setting-group">
          <label htmlFor={`${ids}-color`} className="setting-title">
            Color
          </label>
          <input
            id={`${ids}-color`}
            type="color"
            value={value.color}
            onChange={(e) => {
              update({ color: e.target.value });
            }}
            className="color-input"
          />
        </div>
      </div>

      <div className="setting-group">
        <span className="setting-title">Preview</span>
        <div
          className="text-preview"
          style={{
            fontFamily: PREVIEW_FONTS[value.face],
            fontWeight: value.bold ? 700 : 400,
            fontStyle: value.italic ? "italic" : "normal",
            textDecoration: value.underline ? "underline" : "none",
            textAlign: value.alignment,
            color: value.color,
            fontSize: `${Math.min(Math.max(value.size, 8), 32)}px`,
            lineHeight: 1.25 * value.lineSpacing,
          }}
        >
          {text.trim() || "The quick brown fox jumps over the lazy dog."}
        </div>
      </div>
    </>
  );
}
