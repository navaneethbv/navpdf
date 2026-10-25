import { useEffect, useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Tags } from "lucide-react";
import { ToolDialog } from "../../components/ToolDialog";
import type { ViewerController } from "../viewer/controller";
import { errorMessage, useDocumentEdit } from "./use-document-edit";
import { editTags, findUntagged, readTags } from "../../services/engine";
import { tagText, visibleTags } from "./tag-tree";
import type { TagEdit, TagNode, TagProperties, TagTree, UntaggedReport } from "../../types/engine";

/** Rows drawn at once; a filter narrows larger trees. */
const MAX_ROWS = 400;

/** Standard structure types offered while editing a tag's type. */
const STANDARD_TYPES = [
  "Document",
  "Part",
  "Sect",
  "Div",
  "Art",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "P",
  "L",
  "LI",
  "Lbl",
  "LBody",
  "Table",
  "TR",
  "TH",
  "TD",
  "Figure",
  "Formula",
  "Caption",
  "Link",
  "Annot",
  "Form",
  "Note",
  "Quote",
  "Span",
  "TOC",
  "TOCI",
];

function propertiesOf(node: TagNode): Required<TagProperties> {
  return {
    role: node.role,
    title: node.title,
    alt: node.alt,
    actualText: node.actualText,
    lang: node.lang,
  };
}

function describe(node: TagNode) {
  const content = [
    node.mcids.length ? `${node.mcids.length} content item(s)` : "",
    node.objects ? `${node.objects} annotation(s)` : "",
  ].filter(Boolean);
  return content.join(", ");
}

function untaggedSummary(report: UntaggedReport) {
  if (!report.pages.length) return "All page content and annotations are tagged or artifacts.";
  const pages = report.pages.length;
  return `${pages} page(s) have untagged content${report.truncated ? " (first 500 shown)" : ""}.`;
}

export function TagsDialog({
  controller,
  onClose,
}: Readonly<{ controller: ViewerController | null; onClose: () => void }>) {
  const ids = useId();
  const [tree, setTree] = useState<TagTree | null>(null);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Required<TagProperties> | null>(null);
  const [content, setContent] = useState("");
  const [untagged, setUntagged] = useState<UntaggedReport | null>(null);
  const { apply, busy, error, setError } = useDocumentEdit(controller);

  useEffect(() => {
    let current = true;
    const pdf = controller?.pdf;
    if (!pdf) return undefined;
    pdf
      .saveDocument()
      .then(readTags)
      .then((result) => current && setTree(result))
      .catch((cause) => current && setLoadError(errorMessage(cause)));
    return () => {
      current = false;
    };
  }, [controller, revision]);

  const selected = tree?.nodes.find((node) => node.id === selectedId) ?? null;

  useEffect(() => {
    setDraft(selected ? propertiesOf(selected) : null);
    setContent("");
    const pdf = controller?.pdf;
    if (!selected || !pdf) return undefined;
    let current = true;
    tagText(pdf, selected)
      .then((text) => current && setContent(text))
      .catch(() => current && setContent(""));
    return () => {
      current = false;
    };
  }, [controller, selected]);

  const rows = useMemo(
    () => (tree ? visibleTags(tree.nodes, filter, collapsed) : []),
    [tree, filter, collapsed],
  );
  const parents = useMemo(() => new Set(tree?.nodes.map((node) => node.parent)), [tree]);

  const run = async (edit: TagEdit, status: string) => {
    const changed = await apply(status, async (bytes) => {
      const result = await editTags(bytes, edit);
      if (!result.bytes) throw new Error("The tags were not changed.");
      return { bytes: result.bytes, status: result.report.message };
    });
    if (changed) {
      setUntagged(null);
      setRevision((value) => value + 1);
    }
    return changed;
  };

  const markArtifact = async () => {
    if (!selected) return;
    if (await run({ action: "markArtifact", id: selected.id }, "Tag marked as artifact")) {
      setSelectedId(null);
    }
  };

  const checkUntagged = async () => {
    const pdf = controller?.pdf;
    if (!pdf) return;
    setError("");
    try {
      setUntagged(await findUntagged(await pdf.saveDocument()));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const changedProperties = (): TagProperties | null => {
    if (!selected || !draft) return null;
    const original = propertiesOf(selected);
    const keys = Object.keys(draft) as (keyof TagProperties)[];
    const changes = Object.fromEntries(
      keys.filter((key) => draft[key] !== original[key]).map((key) => [key, draft[key]]),
    );
    return Object.keys(changes).length ? changes : null;
  };
  const pending = changedProperties();

  const field = (key: keyof TagProperties, label: string, list?: string) => (
    <div className="setting-group">
      <label className="setting-title" htmlFor={`${ids}-${key}`}>
        {label}
      </label>
      <input
        id={`${ids}-${key}`}
        className="text-input"
        value={draft?.[key] ?? ""}
        list={list}
        disabled={busy}
        onChange={(event) => draft && setDraft({ ...draft, [key]: event.target.value })}
      />
    </div>
  );

  return (
    <ToolDialog
      title="Tags and Reading Order"
      icon={<Tags size={18} />}
      onClose={onClose}
      busy={busy}
      error={error || loadError}
      primaryLabel={tree?.tagged ? "Save Tag Properties" : "Tag Automatically"}
      busyLabel="Updating tags…"
      primaryDisabled={!tree || (tree.tagged && !pending)}
      onPrimary={() => {
        if (!tree) return;
        if (!tree.tagged) void run({ action: "autotag" }, "Document tagged");
        else if (selected && pending)
          void run(
            { action: "setProperties", id: selected.id, properties: pending },
            "Tag properties updated",
          );
      }}
      secondary={
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !tree}
          onClick={() => void checkUntagged()}
        >
          Find Untagged Content
        </button>
      }
    >
      {!tree && !loadError && <p className="field-hint">Reading tags…</p>}
      {tree && !tree.tagged && (
        <p className="field-hint">
          This document has no tags. Tag Automatically marks each text object as a paragraph, images
          and forms as figures, other drawing as artifacts, and fields, links and comments as Form,
          Link and Annot tags, in the order they are drawn on each page. Review headings, figure
          descriptions and reading order afterwards; automatic tags are a starting point, not a
          finished accessible document.
        </p>
      )}
      {tree?.tagged && (
        <>
          <div className="setting-group">
            <label className="setting-title" htmlFor={`${ids}-filter`}>
              Find tags by type or title
            </label>
            <input
              id={`${ids}-filter`}
              className="text-input"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          {tree.truncated && <p className="field-hint">Only the first 20,000 tags are listed.</p>}
          <ul className="tag-tree" aria-label="Tags">
            {rows.slice(0, MAX_ROWS).map((node) => (
              <li key={node.id} style={{ paddingInlineStart: `${node.depth * 14}px` }}>
                {parents.has(node.id) && !filter.trim() ? (
                  <button
                    type="button"
                    className="icon-button tag-toggle"
                    aria-label={`${collapsed.has(node.id) ? "Expand" : "Collapse"} ${node.role}`}
                    aria-expanded={!collapsed.has(node.id)}
                    onClick={() => toggle(node.id)}
                  >
                    {collapsed.has(node.id) ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </button>
                ) : (
                  <span className="tag-toggle" />
                )}
                <button
                  type="button"
                  className={`tag-row${node.id === selectedId ? " selected" : ""}`}
                  aria-pressed={node.id === selectedId}
                  onClick={() => {
                    setSelectedId(node.id);
                    if (node.page) controller?.goTo(node.page);
                  }}
                >
                  <strong>{node.role}</strong>
                  {node.standardRole && <span className="field-hint"> ({node.standardRole})</span>}
                  {node.title && <span> {node.title}</span>}
                  <span className="field-hint">
                    {node.page ? ` · page ${node.page}` : ""}
                    {describe(node) ? ` · ${describe(node)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {rows.length > MAX_ROWS && (
            <p className="field-hint">
              Showing {MAX_ROWS} of {rows.length} tags; find tags to narrow the list.
            </p>
          )}
          {selected && draft && (
            <section className="tag-properties" aria-label="Selected tag">
              {field("role", "Type", `${ids}-types`)}
              <datalist id={`${ids}-types`}>
                {STANDARD_TYPES.map((type) => (
                  <option key={type} value={type} />
                ))}
              </datalist>
              {field("title", "Title")}
              {field("alt", "Alternate text")}
              {field("actualText", "Actual text")}
              {field("lang", "Language")}
              {content && (
                <p className="field-hint">
                  Content: <q>{content.length > 300 ? `${content.slice(0, 300)}…` : content}</q>
                </p>
              )}
              <div className="tag-actions">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "move", id: selected.id, offset: -1 }, "Tag moved")
                  }
                >
                  <ArrowUp size={14} /> Move Earlier
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void run({ action: "move", id: selected.id, offset: 1 }, "Tag moved")
                  }
                >
                  <ArrowDown size={14} /> Move Later
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy || !selected.mcids.length || selected.children > 0}
                  onClick={() => void markArtifact()}
                >
                  Mark as Artifact
                </button>
              </div>
              <p className="field-hint">
                Moving changes the order assistive technology reads this tag among its siblings; the
                page looks the same. Mark as Artifact keeps the content visible but removes it from
                the reading order, for decoration such as rules and page furniture.
              </p>
            </section>
          )}
        </>
      )}
      {untagged && (
        <section className="setting-group" aria-label="Untagged content">
          <p className="field-hint">{untaggedSummary(untagged)}</p>
          <ul className="tag-untagged">
            {untagged.pages.map((page) => (
              <li key={page.page}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => controller?.goTo(page.page)}
                >
                  Page {page.page}
                </button>
                {": "}
                {[
                  page.content ? `${page.content} drawing operation(s)` : "",
                  page.annotations ? `${page.annotations} comment(s) or link(s)` : "",
                  page.widgets ? `${page.widgets} form field(s)` : "",
                ]
                  .filter(Boolean)
                  .join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </ToolDialog>
  );
}
