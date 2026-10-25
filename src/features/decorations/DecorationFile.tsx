import { useId, useState } from "react";
import { decorationSourceType } from "../../services/pdf/decoration-images";

/** A chosen watermark or background file and how it is placed. */
export interface DecorationFileChoice {
  name: string;
  bytes: Uint8Array;
  type: "png" | "jpg" | "pdf";
  pageNumber: number;
  /** Percent of the page width. */
  scale: number;
}

/** Chooses a PNG, JPEG or PDF file, the PDF page to use and its size relative to the page. */
export function DecorationFile({
  value,
  onChange,
  label,
}: Readonly<{
  value: DecorationFileChoice | null;
  onChange: (value: DecorationFileChoice | null) => void;
  label: string;
}>) {
  const ids = useId();
  const [error, setError] = useState("");
  return (
    <>
      <div className="setting-group">
        <label htmlFor={`${ids}-file`} className="setting-title">
          {label}
        </label>
        <input
          id={`${ids}-file`}
          type="file"
          accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.arrayBuffer().then((buffer) => {
              const bytes = new Uint8Array(buffer);
              const type = decorationSourceType(bytes);
              if (!type) {
                setError("Choose a PNG, JPEG or PDF file.");
                onChange(null);
                return;
              }
              setError("");
              onChange({ name: file.name, bytes, type, pageNumber: 1, scale: value?.scale ?? 50 });
            });
          }}
        />
        {value && <p className="field-hint">{value.name}</p>}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {value && (
        <div className="settings-row">
          {value.type === "pdf" && (
            <div className="setting-group">
              <label htmlFor={`${ids}-page`} className="setting-title">
                Page of that PDF
              </label>
              <input
                id={`${ids}-page`}
                type="number"
                min={1}
                value={value.pageNumber}
                onChange={(event) =>
                  onChange({ ...value, pageNumber: Math.max(1, Number(event.target.value) || 1) })
                }
                className="text-input"
              />
            </div>
          )}
          <div className="setting-group">
            <label htmlFor={`${ids}-scale`} className="setting-title">
              Size ({value.scale}% of the page width)
            </label>
            <input
              id={`${ids}-scale`}
              type="range"
              min="10"
              max="100"
              step="5"
              value={value.scale}
              onChange={(event) => onChange({ ...value, scale: Number(event.target.value) })}
            />
          </div>
        </div>
      )}
    </>
  );
}
