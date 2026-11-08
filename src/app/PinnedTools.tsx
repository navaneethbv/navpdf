import { useWorkspace } from "../stores/workspace";
import { documentTools } from "../features/tools/tool-catalog";
import { movePinned, savePinned } from "../features/tools/pinned-tools";

/** The tools pinned from All Tools, as toolbar buttons in the order chosen. */
export function PinnedTools() {
  const s = useWorkspace();
  const pinned = s.local.preferences.pinnedTools ?? [];
  if (!pinned.length) return null;
  const tools = new Map(documentTools(s).map((tool) => [tool.id, tool]));
  const shown = pinned.flatMap((id) => (tools.has(id) ? [tools.get(id)!] : []));
  const move = (id: string, step: -1 | 1) =>
    void savePinned(movePinned(pinned, id, step)).catch((error: unknown) =>
      s.set({ error: String(error) }),
    );
  return (
    <div className="pinned-tools" role="toolbar" aria-label="Pinned tools">
      {shown.map((tool, index) => (
        <span key={tool.id} className="pinned-tool">
          <button
            type="button"
            className="icon-button"
            title={`${tool.label}. Alt-Left or Alt-Right moves it.`}
            aria-label={tool.label}
            disabled={s.busy || tool.disabled}
            onClick={tool.action}
            onKeyDown={(event) => {
              if (!event.altKey) return;
              if (event.key === "ArrowLeft" && index > 0) move(tool.id, -1);
              else if (event.key === "ArrowRight" && index < shown.length - 1) move(tool.id, 1);
              else return;
              event.preventDefault();
            }}
          >
            <tool.icon size={18} />
          </button>
        </span>
      ))}
    </div>
  );
}
