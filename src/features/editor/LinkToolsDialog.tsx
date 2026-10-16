import { useEffect, useId, useRef, useState } from "react";
import { Link as LinkIcon } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import {
  addUrlLinks,
  inspectLinks,
  removeLinks,
  type LinkInventory,
} from "../../services/pdf/link-tools";
import type { DocumentToolProps } from "../tools/document-tools";
import { errorMessage, useDocumentEdit } from "../document/use-document-edit";
import { findUrlLinks } from "./url-links";

type Action = "create" | "broken" | "all";

const ACTIONS: [Action, string, string][] = [
  [
    "create",
    "Create links from web addresses",
    "Adds a link over each http, https or www address written in the text. Existing links to the same address are kept.",
  ],
  [
    "broken",
    "Remove broken links",
    "Removes page links that no longer reach a page and clears dead bookmark destinations, keeping the bookmark titles.",
  ],
  ["all", "Remove all links", "Removes every link annotation. Bookmarks are not changed."],
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function LinkToolsDialog({ controller, onClose }: Readonly<DocumentToolProps>) {
  const id = useId();
  const [inventory, setInventory] = useState<LinkInventory | null>(null);
  const [loadError, setLoadError] = useState("");
  const [action, setAction] = useState<Action>("create");
  const [revision, setRevision] = useState(0);
  const [progress, setProgress] = useState("");
  const abort = useRef<AbortController | null>(null);
  const { apply, busy, error } = useDocumentEdit(controller);

  useEffect(() => {
    let current = true;
    const source = controller?.pdf;
    if (source)
      void source
        .saveDocument()
        .then(inspectLinks)
        .then((result) => {
          if (current && source === controller?.pdf) setInventory(result);
        })
        .catch((cause: unknown) => {
          if (current) setLoadError(errorMessage(cause));
        });
    return () => {
      current = false;
    };
  }, [controller, revision]);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    const source = controller?.pdf;
    if (!source) return;
    let applied: boolean;
    if (action === "create") {
      abort.current = new AbortController();
      setProgress("Searching the text for web addresses…");
      applied = await apply("Links created", async (bytes) => {
        const found = await findUrlLinks(source, abort.current?.signal);
        if (!found.length) throw new Error("No web addresses were found in the text layer.");
        const result = await addUrlLinks(bytes, found);
        return { bytes: result.bytes, status: `Created ${plural(result.added, "link")}` };
      });
      setProgress("");
    } else {
      applied = await apply("Links removed", async (bytes) => {
        const result = await removeLinks(bytes, action);
        const parts = [`Removed ${plural(result.removedLinks, "link")}`];
        if (result.clearedBookmarks)
          parts.push(`cleared ${plural(result.clearedBookmarks, "bookmark destination")}`);
        return { bytes: result.bytes, status: parts.join(" and ") };
      });
    }
    if (applied) setRevision((value) => value + 1);
  };

  return (
    <ToolDialog
      title="Link Tools"
      icon={<LinkIcon size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError}
      primaryLabel="Apply"
      busyLabel="Applying…"
      onPrimary={() => void run()}
      primaryDisabled={!inventory}
    >
      {!inventory && !loadError && <output>Reading links…</output>}
      {inventory && (
        <ul className="check-list" aria-label="Links in this PDF">
          <li>{plural(inventory.total, "link")} in total</li>
          <li>{plural(inventory.web, "web link")}</li>
          <li>{plural(inventory.internal, "page link")}</li>
          <li>{plural(inventory.broken, "broken page link")}</li>
          <li>{plural(inventory.brokenBookmarks, "bookmark")} with a broken destination</li>
          {inventory.other > 0 && <li>{plural(inventory.other, "other link")}</li>}
        </ul>
      )}
      <fieldset className="preset-list">
        <legend className="setting-title">Action</legend>
        {ACTIONS.map(([value, label, hint]) => (
          <div key={value} className="preset-option">
            <input
              type="radio"
              id={`${id}-${value}`}
              name={`${id}-action`}
              checked={action === value}
              onChange={() => setAction(value)}
            />
            <label htmlFor={`${id}-${value}`}>
              <strong>{label}</strong>
              <span className="field-hint">{hint}</span>
            </label>
          </div>
        ))}
      </fieldset>
      {progress && <output aria-live="polite">{progress}</output>}
      <p className="field-hint">
        Addresses are found in the text layer only; scanned pages need OCR first, and an address
        broken across lines is not linked. Link areas are estimated from the text position.
      </p>
    </ToolDialog>
  );
}
