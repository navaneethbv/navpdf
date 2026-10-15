import { useState } from "react";
import { Keyboard } from "lucide-react";
import { Dialog } from "../../components/Dialog";

// Keep this reference aligned with App.handleShortcut and PageWorkspace's keyboard handlers.
const shortcuts = [
  ["Files", "Open PDF", "Cmd/Ctrl + O"],
  ["Files", "Save", "Cmd/Ctrl + S"],
  ["Files", "Save As", "Cmd/Ctrl + Shift + S"],
  ["Files", "Print", "Cmd/Ctrl + P"],
  ["Files", "Close document", "Cmd/Ctrl + W"],
  ["Workspace", "Settings", "Cmd/Ctrl + ,"],
  ["Editing", "Undo", "Cmd/Ctrl + Z"],
  ["Editing", "Redo", "Cmd/Ctrl + Shift + Z or Ctrl + Y"],
  ["Search", "Find in document", "Cmd/Ctrl + F"],
  ["Search", "Next match", "Cmd/Ctrl + G or Enter in search"],
  ["Search", "Previous match", "Cmd/Ctrl + Shift + G or Shift + Enter in search"],
  ["Reading", "Go to page", "Cmd/Ctrl + Shift + N"],
  ["Reading", "Previous view", "Cmd/Ctrl + [ or Alt + Left"],
  ["Reading", "Next view", "Cmd/Ctrl + ] or Alt + Right"],
  ["Reading", "Previous / next page (single-page layout)", "Page Up / Down or Left / Right"],
  ["Reading", "Fit page", "Cmd/Ctrl + 0"],
  ["Reading", "Zoom in / out", "Cmd/Ctrl + plus / minus"],
  ["Reading", "Toggle automatic scrolling", "Cmd/Ctrl + Shift + H"],
  ["Read aloud", "Read current page", "Cmd/Ctrl + Shift + V"],
  ["Read aloud", "Read to end", "Cmd/Ctrl + Shift + B"],
  ["Read aloud", "Pause / resume speech", "Cmd/Ctrl + Shift + C"],
  ["Read aloud", "Stop speech", "Cmd/Ctrl + Shift + E"],
  ["Organize Pages", "Select all pages", "Cmd/Ctrl + A"],
  ["Organize Pages", "Move page focus / extend selection", "Arrow keys / Shift + Arrow keys"],
  ["Organize Pages", "Toggle focused page selection", "Space"],
  ["Organize Pages", "Open focused page", "Enter"],
  ["Organize Pages", "Delete selected pages", "Delete or Backspace"],
  ["Organize Pages", "Rotate clockwise / counterclockwise", "R / Shift + R"],
  ["Workspace", "Close dialog, stop automatic scrolling or return to selection", "Escape"],
] as const;

export function ShortcutGuide({ onClose }: Readonly<{ onClose: () => void }>) {
  const [query, setQuery] = useState("");
  const matches = shortcuts.filter((row) =>
    row.join(" ").toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Dialog
      title="Keyboard shortcuts"
      icon={<Keyboard size={18} />}
      onClose={onClose}
      className="shortcut-guide"
    >
      <label className="setting-group">
        <span className="setting-title">Find a shortcut</span>
        <input
          type="search"
          className="text-input"
          data-autofocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="field-hint">
        Use Cmd on macOS and Ctrl on Windows or Linux. Page-organizing keys apply only in Organize
        Pages. Editing text keeps normal text-field shortcuts.
      </p>
      <output>{matches.length} shortcuts</output>
      {matches.length ? (
        <table className="workflow-table">
          <caption className="sr-only">Keyboard shortcut reference</caption>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Shortcut</th>
            </tr>
          </thead>
          <tbody>
            {matches.map(([group, action, keys]) => (
              <tr key={action}>
                <td>
                  <small>{group}</small>
                  <span>{action}</span>
                </td>
                <td>
                  <kbd>{keys}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-message">No shortcuts match your search.</p>
      )}
    </Dialog>
  );
}
