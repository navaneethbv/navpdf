import { useState } from "react";
import { ScanSearch } from "lucide-react";
import type { ViewerController } from "../viewer/controller";
import { findPatternMarks, type PatternMark } from "./redaction-marks";
import { SENSITIVE_KINDS, type SensitiveKind } from "./sensitive-patterns";

const LABELS = new Map(SENSITIVE_KINDS);

/** "Marked 3 email addresses and 1 phone number on 2 pages." style summary. */
export function patternSummary(marks: PatternMark[]) {
  if (!marks.length) return "No matching data was found in the text layer.";
  const counts = new Map<SensitiveKind, number>();
  for (const mark of marks) counts.set(mark.kind, (counts.get(mark.kind) ?? 0) + 1);
  const parts = [...counts].map(
    ([kind, count]) => `${count} × ${(LABELS.get(kind) ?? kind).toLowerCase()}`,
  );
  const pages = new Set(marks.map((mark) => mark.page)).size;
  return `Marked ${parts.join(", ")} on ${pages} page${pages === 1 ? "" : "s"}. Review each mark before applying.`;
}

export function PatternFinder({
  controller,
  onFound,
  onError,
}: Readonly<{
  controller: ViewerController | null;
  onFound: (marks: PatternMark[]) => void;
  onError: (message: string) => void;
}>) {
  const [kinds, setKinds] = useState<Set<SensitiveKind>>(
    () => new Set<SensitiveKind>(["email", "phone", "ssn", "card"]),
  );
  const [searching, setSearching] = useState(false);

  const toggle = (kind: SensitiveKind, checked: boolean) =>
    setKinds((current) => {
      const next = new Set(current);
      if (checked) next.add(kind);
      else next.delete(kind);
      return next;
    });

  const search = async () => {
    if (!controller?.pdf || !kinds.size) return;
    setSearching(true);
    try {
      onFound(await findPatternMarks(controller.pdf, [...kinds]));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "The text could not be searched.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <fieldset className="preset-list">
      <legend className="setting-title">Find sensitive data</legend>
      {SENSITIVE_KINDS.map(([kind, label]) => (
        <label key={kind} className="checkbox-row">
          <input
            type="checkbox"
            checked={kinds.has(kind)}
            onChange={(event) => toggle(kind, event.target.checked)}
          />
          <span>{label}</span>
        </label>
      ))}
      <button
        type="button"
        className="button-secondary"
        disabled={!kinds.size || searching || !controller?.pdf}
        onClick={() => void search()}
      >
        <ScanSearch size={15} /> {searching ? "Searching…" : "Mark Sensitive Data"}
      </button>
      <p className="field-hint">
        Searches the text layer only; scanned pages need OCR first. Formats vary, so review the
        marks and add any that were missed.
      </p>
    </fieldset>
  );
}
