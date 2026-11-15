import { useState } from "react";
import { Regex, ScanSearch } from "lucide-react";
import type { ViewerController } from "../viewer/controller";
import { findExpressionMarks, findPatternMarks, type PatternMark } from "./redaction-marks";
import { ibanValid, luhnValid, SENSITIVE_KINDS, type SensitiveKind } from "./sensitive-patterns";
import { findPattern } from "../../services/engine";
import { native } from "../../services/native";

const LABELS = new Map<PatternMark["kind"], string>([
  ...SENSITIVE_KINDS,
  ["custom", "Expression matches"],
]);

/** Checks that keep only matches whose digits or letters pass a checksum. */
const CHECKS = {
  none: () => true,
  luhn: (text: string) => luhnValid(text.replaceAll(/\D/g, "")),
  iban: ibanValid,
} as const;
type Check = keyof typeof CHECKS;

/** "Marked 3 email addresses and 1 phone number on 2 pages." style summary. */
export function patternSummary(marks: PatternMark[]) {
  if (!marks.length) return "No matching data was found in the text layer.";
  const counts = new Map<PatternMark["kind"], number>();
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
  const [searching, setSearching] = useState<"" | "kinds" | "expression">("");
  const [expression, setExpression] = useState("");
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [check, setCheck] = useState<Check>("none");

  const toggle = (kind: SensitiveKind, checked: boolean) =>
    setKinds((current) => {
      const next = new Set(current);
      if (checked) next.add(kind);
      else next.delete(kind);
      return next;
    });

  const search = async () => {
    if (!controller?.pdf || !kinds.size) return;
    setSearching("kinds");
    try {
      onFound(await findPatternMarks(controller.pdf, [...kinds]));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "The text could not be searched.");
    } finally {
      setSearching("");
    }
  };

  const searchExpression = async () => {
    if (!controller?.pdf || !expression.trim()) return;
    setSearching("expression");
    try {
      onFound(
        await findExpressionMarks(
          controller.pdf,
          (texts) => findPattern(expression, ignoreCase, texts),
          CHECKS[check],
        ),
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSearching("");
    }
  };

  return (
    <>
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
          disabled={!kinds.size || !!searching || !controller?.pdf}
          onClick={() => void search()}
        >
          <ScanSearch size={15} /> {searching === "kinds" ? "Searching…" : "Mark Sensitive Data"}
        </button>
        <p className="field-hint">
          Searches the text layer only; scanned pages need OCR first. Formats vary, so review the
          marks and add any that were missed.
        </p>
      </fieldset>
      <fieldset className="preset-list">
        <legend className="setting-title">Find by regular expression</legend>
        <input
          type="text"
          className="text-input"
          aria-label="Regular expression"
          placeholder="For example: [A-Z]{2}-\\d{6}"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={1024}
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={ignoreCase}
            onChange={(event) => setIgnoreCase(event.target.checked)}
          />
          <span>Ignore upper and lower case</span>
        </label>
        <label className="checkbox-row">
          <span>Keep only matches that pass</span>
          <select
            className="select-input"
            aria-label="Checksum"
            value={check}
            onChange={(event) => setCheck(event.target.value as Check)}
          >
            <option value="none">no checksum</option>
            <option value="luhn">a card checksum (Luhn)</option>
            <option value="iban">an IBAN checksum</option>
          </select>
        </label>
        <button
          type="button"
          className="button-secondary"
          disabled={!native || !expression.trim() || !!searching || !controller?.pdf}
          onClick={() => void searchExpression()}
        >
          <Regex size={15} /> {searching === "expression" ? "Searching…" : "Mark Expression Matches"}
        </button>
        <p className="field-hint">
          Matches run within one page&apos;s text, with words and lines joined by a space.
          Look-around and back-references are not supported, and an expression must match at least
          one character.{native ? "" : " Available in the desktop app."}
        </p>
      </fieldset>
    </>
  );
}
