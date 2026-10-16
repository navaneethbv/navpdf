import { useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { FeatureDialog } from "../../components/FeatureDialog";
import { useWorkspace } from "../../stores/workspace";
import { documentTools, type ToolItem } from "./tool-catalog";

export function CommandPalette({
  onClose,
  commands = [],
}: Readonly<{ onClose: () => void; commands?: ToolItem[] }>) {
  const state = useWorkspace();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const terms = query.trim().toLocaleLowerCase().split(/\s+/);
  const matches = [...commands, ...documentTools(state)].filter((tool) => {
    const text = `${tool.label} ${tool.description} ${tool.category}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });

  const run = (tool: ToolItem) => {
    if (state.busy || tool.disabled) return;
    onClose();
    tool.action();
  };

  return (
    <FeatureDialog title="Search tools" onClose={onClose} initialFocusRef={input}>
      <div className="modal-dialog command-palette">
        <div className="modal-header">
          <h3>Search tools</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="Close tool search"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <label className="tool-search-box" htmlFor={id}>
            <Search size={16} aria-hidden="true" />
            <input
              ref={input}
              id={id}
              type="search"
              aria-label="Find a tool"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  list.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  const tool = matches.find((item) => !item.disabled);
                  if (tool) run(tool);
                }
              }}
            />
          </label>
          <output aria-live="polite">{matches.length} tools</output>
          <ul
            ref={list}
            className="command-results"
            aria-label="Matching tools"
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              const buttons = [
                ...(list.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ??
                  []),
              ];
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              if (event.key === "ArrowUp" && index === 0) input.current?.focus();
              else {
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1));
                buttons[next]?.focus();
              }
            }}
          >
            {matches.map((tool) => (
              <li key={tool.id}>
                <button
                  type="button"
                  disabled={state.busy || tool.disabled}
                  onClick={() => run(tool)}
                >
                  <tool.icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{tool.label}</strong>
                    <small>{tool.description}</small>
                    {tool.disabled && (
                      <small>
                        {state.document
                          ? "Unavailable for the current document or history."
                          : "Open a PDF to use this tool."}
                      </small>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!matches.length && <p>No tools match your search.</p>}
        </div>
      </div>
    </FeatureDialog>
  );
}
