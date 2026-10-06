import { useEffect, useId, useState } from "react";
import { Accessibility, AlertTriangle, CheckCircle2, Eye, XCircle } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { errorMessage, useDocumentEdit } from "./use-document-edit";
import {
  LANGUAGE_TAG,
  checkAccessibilityBytes,
  fixAccessibility,
  type AccessibilityCheck,
  type CheckStatus,
} from "../../services/pdf/accessibility";

const ICONS: Record<CheckStatus, typeof CheckCircle2> = {
  passed: CheckCircle2,
  failed: XCircle,
  warning: AlertTriangle,
  manual: Eye,
};

const STATUS_TEXT: Record<CheckStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  warning: "Needs attention",
  manual: "Check manually",
};

type Source = NonNullable<ViewerController["pdf"]>;

/** Whether each page has a text layer, read page by page so large files stay responsive. */
async function textPresence(pdf: Source, cancelled: () => boolean) {
  const result: boolean[] = [];
  for (let number = 1; number <= pdf.numPages && !cancelled(); number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    result.push(content.items.some((item) => "str" in item && item.str.trim() !== ""));
  }
  return result;
}

/** The system language as a PDF language tag, without POSIX suffixes such as "@posix". */
function defaultLanguage() {
  const tag = (navigator.language || "").split(/[@.]/)[0].replace("_", "-");
  return LANGUAGE_TAG.test(tag) ? tag : "en";
}

interface Result {
  checks: AccessibilityCheck[];
  title: string;
  language: string;
}

export function AccessibilityDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const [result, setResult] = useState<Result | null>(null);
  const [loadError, setLoadError] = useState("");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("");
  const [revision, setRevision] = useState(0);
  const { apply, busy, error } = useDocumentEdit(controller);

  useEffect(() => {
    let current = true;
    const run = async () => {
      const pdf = controller?.pdf;
      if (!pdf) return;
      const hasText = await textPresence(pdf, () => !current);
      const permissions = await pdf.getPermissions();
      const checked = await checkAccessibilityBytes(await pdf.saveDocument(), {
        hasText,
        permissions: permissions ? [...permissions] : null,
      });
      if (!current) return;
      setResult(checked);
      setTitle(checked.title);
      setLanguage(checked.language || defaultLanguage());
    };
    setResult(null);
    run().catch((cause: unknown) => {
      if (current) setLoadError(errorMessage(cause));
    });
    return () => {
      current = false;
    };
  }, [controller, revision]);

  const fixable = new Set(result?.checks.flatMap((item) => (item.fix ? [item.fix] : [])));
  const languageValid = !fixable.has("language") || LANGUAGE_TAG.test(language.trim());

  const fix = async () => {
    const applied = await apply("Accessibility settings updated", (bytes) =>
      fixAccessibility(bytes, {
        title: fixable.has("title") || title.trim() !== result?.title ? title : undefined,
        displayTitle: fixable.has("display-title") || fixable.has("title"),
        language: fixable.has("language") ? language : undefined,
        tabOrder: fixable.has("tab-order"),
      }),
    );
    if (applied) setRevision((value) => value + 1);
  };

  const failures = result?.checks.filter((item) => item.status === "failed").length ?? 0;

  return (
    <ToolDialog
      title="Accessibility Check"
      icon={<Accessibility size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError}
      primaryLabel="Fix Selected Issues"
      busyLabel="Fixing…"
      primaryDisabled={!fixable.size || !languageValid || !title.trim()}
      onPrimary={() => void fix()}
    >
      {!result && !loadError && <output className="field-hint">Checking the document…</output>}
      {result && (
        <>
          <output className="field-hint" aria-live="polite">
            {failures ? `${failures} check(s) failed.` : "No automatic checks failed."}
          </output>
          <ul className="check-list" aria-label="Accessibility checks">
            {result.checks.map((item) => {
              const Icon = ICONS[item.status];
              return (
                <li key={item.id} className={`accessibility-check ${item.status}`}>
                  <Icon size={15} aria-hidden="true" />
                  <span>
                    <strong>{item.label}</strong>: {STATUS_TEXT[item.status]}
                    <span className="field-hint">{item.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {fixable.size > 0 && (
        <fieldset className="preset-list">
          <legend className="setting-title">Fixes NavPDF can apply</legend>
          {(fixable.has("title") || fixable.has("display-title")) && (
            <>
              <label className="setting-title" htmlFor={`${ids}-title`}>
                Document title
              </label>
              <input
                id={`${ids}-title`}
                className="text-input"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </>
          )}
          {fixable.has("language") && (
            <>
              <label className="setting-title" htmlFor={`${ids}-language`}>
                Language (for example en-US)
              </label>
              <input
                id={`${ids}-language`}
                className="text-input"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              />
            </>
          )}
          {!title.trim() && <p className="field-hint">Enter a title to apply the fixes.</p>}
          {!languageValid && (
            <p className="field-hint">Use a language code such as en, en-US or fr-CA.</p>
          )}
          {fixable.has("tab-order") && (
            <p className="field-hint">Tab order will follow the document structure.</p>
          )}
        </fieldset>
      )}
      <p className="field-hint">
        Passing these checks does not by itself make a document accessible. Tags, alternate text and
        reading order come from the authoring application.
      </p>
    </ToolDialog>
  );
}
