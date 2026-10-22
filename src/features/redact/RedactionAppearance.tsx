import { useId, useState } from "react";
import { parsePageRange } from "../pages/page-range";
import { mapInOrder } from "../../utils/async-sequence";
import type { PdfRect } from "../../types/engine";

/** Redaction code sets: US FOIA exemptions and Privacy Act exemptions, plus plain labels. */
export const CODE_SETS: Record<string, string[]> = {
  "US FOIA (5 U.S.C. 552)": [
    "(b)(1)",
    "(b)(2)",
    "(b)(3)",
    "(b)(4)",
    "(b)(5)",
    "(b)(6)",
    "(b)(7)(A)",
    "(b)(7)(B)",
    "(b)(7)(C)",
    "(b)(7)(D)",
    "(b)(7)(E)",
    "(b)(7)(F)",
    "(b)(8)",
    "(b)(9)",
  ],
  "US Privacy Act (5 U.S.C. 552a)": [
    "(k)(1)",
    "(k)(2)",
    "(k)(3)",
    "(k)(4)",
    "(k)(5)",
    "(k)(6)",
    "(k)(7)",
  ],
  General: ["REDACTED", "PII", "CONFIDENTIAL", "PRIVILEGED"],
};

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!match) return [0, 0, 0];
  return [1, 2, 3].map((index) => Number.parseInt(match[index], 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** Overlay colour and the text drawn on every marked area. */
export function RedactionAppearance({
  fill,
  onFill,
  label,
  onLabel,
}: Readonly<{
  fill: string;
  onFill: (value: string) => void;
  label: string;
  onLabel: (value: string) => void;
}>) {
  const id = useId();
  const [set, setSet] = useState(Object.keys(CODE_SETS)[0]);
  return (
    <fieldset className="setting-group">
      <legend className="setting-title">Overlay appearance</legend>
      <label className="color-label">
        Fill colour{" "}
        <input
          type="color"
          aria-label="Redaction fill colour"
          value={fill}
          onChange={(event) => onFill(event.target.value)}
        />
      </label>
      <label className="setting-title" htmlFor={`${id}-label`}>
        Overlay text (optional)
      </label>
      <input
        id={`${id}-label`}
        className="text-input"
        maxLength={60}
        placeholder="For example (b)(6)"
        value={label}
        onChange={(event) => onLabel(event.target.value)}
      />
      <div className="inline-field">
        <select
          aria-label="Redaction code set"
          className="text-input"
          value={set}
          onChange={(event) => setSet(event.target.value)}
        >
          {Object.keys(CODE_SETS).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Redaction code"
          className="text-input"
          value=""
          onChange={(event) => event.target.value && onLabel(event.target.value)}
        >
          <option value="">Insert a code…</option>
          {CODE_SETS[set].map((code) => (
            <option key={code}>{code}</option>
          ))}
        </select>
      </div>
      <p className="field-hint">
        Overlay text uses plain ASCII and is drawn on every mark, which must be large enough to hold
        it and must not overlap another mark. The audit accepts only this exact text inside a
        redacted area.
      </p>
    </fieldset>
  );
}

/** Marks whole pages, as boxes covering each page's visible area. */
export function WholePagesMarker({
  pdf,
  onMark,
  onError,
}: Readonly<{
  pdf: { numPages: number; getPage(page: number): Promise<{ view: number[] }> } | null | undefined;
  onMark: (marks: { page: number; rect: PdfRect }[]) => void;
  onError: (message: string) => void;
}>) {
  const id = useId();
  const [range, setRange] = useState("");
  const mark = async () => {
    if (!pdf) return;
    try {
      const pages = parsePageRange(range, pdf.numPages);
      const mark = async (index: number) => {
        const page = await pdf.getPage(index + 1);
        const [x0, y0, x1, y1] = page.view;
        return { page: index + 1, rect: [x0, y0, x1, y1] as PdfRect };
      };
      const marks = [];
      for await (const pageMark of mapInOrder(pages, mark)) marks.push(pageMark);
      onMark(marks);
      setRange("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Enter a page range such as 2-4.");
    }
  };
  return (
    <div className="setting-group">
      <label className="setting-title" htmlFor={`${id}-pages`}>
        Mark whole pages
      </label>
      <div className="inline-field">
        <input
          id={`${id}-pages`}
          className="text-input"
          placeholder="2-4, 7"
          value={range}
          onChange={(event) => setRange(event.target.value)}
        />
        <button
          type="button"
          className="button-secondary"
          disabled={!range.trim() || !pdf}
          onClick={() => void mark()}
        >
          Mark Pages
        </button>
      </div>
    </div>
  );
}
