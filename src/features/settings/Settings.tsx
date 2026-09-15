import { useEffect, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { useWorkspace } from "../../stores/workspace";
import { savePreferences, localState } from "../../services/native";
import type { Preferences } from "../../types/document";
import { applyTheme } from "../../services/theme";
export function Settings() {
  const initial = useWorkspace((s) => s.local.preferences),
    persistedTheme = useWorkspace((s) => s.local.preferences.theme),
    set = useWorkspace((s) => s.set);
  const [preferences, update] = useState<Preferences>(initial),
    [error, setError] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(preferences.theme, media.matches);
    return () => applyTheme(persistedTheme, media.matches);
  }, [preferences.theme, persistedTheme]);
  const patch = (value: Partial<Preferences>) => update({ ...preferences, ...value });
  return (
    <Dialog title="Settings" onClose={() => set({ settingsOpen: false })}>
      <form
        className="settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await savePreferences(preferences);
            set({
              local: await localState(),
              settingsOpen: false,
              layout: preferences.layout,
            });
          } catch (err) {
            setError(String(err));
          }
        }}
      >
        <h3>Appearance</h3>
        <label htmlFor="settings-theme">
          Theme
          <select
            id="settings-theme"
            value={preferences.theme}
            onChange={(e) => patch({ theme: e.target.value as Preferences["theme"] })}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <span className="field-hint">
            System follows the macOS appearance. Light and dark keep NavPDF consistent regardless of
            the system setting.
          </span>
        </label>
        <h3>PDF viewing</h3>
        <div className="form-columns">
          <label>
            Default zoom
            <select
              value={preferences.defaultZoom}
              onChange={(e) => patch({ defaultZoom: e.target.value })}
            >
              <option value="page-fit">Fit page</option>
              <option value="page-width">Fit width</option>
              <option value="1">100%</option>
              <option value="1.5">150%</option>
              <option value="2">200%</option>
            </select>
          </label>
          <label>
            Page layout
            <select
              value={preferences.layout}
              onChange={(e) => patch({ layout: e.target.value as Preferences["layout"] })}
            >
              <option value="continuous">Continuous</option>
              <option value="single">Single page</option>
              <option value="spread">Two pages</option>
            </select>
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={preferences.rememberPage}
            onChange={(e) => patch({ rememberPage: e.target.checked })}
          />{" "}
          Remember last page
        </label>
        <h3>General & privacy</h3>
        <label>
          Default save behavior
          <select
            value={preferences.saveBehavior}
            onChange={(e) => patch({ saveBehavior: e.target.value as Preferences["saveBehavior"] })}
          >
            <option value="ask">Ask before replacing a file</option>
            <option value="save-as">Always save a copy</option>
          </select>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={preferences.confirmOnDelete}
            onChange={(e) => patch({ confirmOnDelete: e.target.checked })}
          />{" "}
          Confirm before deleting pages or annotations
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={preferences.autosave}
            onChange={(e) => patch({ autosave: e.target.checked })}
          />{" "}
          Autosave recovery for unencrypted PDFs
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={preferences.recentFiles}
            onChange={(e) => patch({ recentFiles: e.target.checked })}
          />{" "}
          Keep recent document history
        </label>
        <label className="check-label">
          <input type="checkbox" checked={false} disabled /> Allow network access
        </label>
        <p className="muted">Network access is disabled by the application policy.</p>
        <h3>Editing</h3>
        <div className="form-columns">
          <label>
            Default annotation color
            <input
              type="color"
              value={preferences.annotationColor}
              onChange={(e) => patch({ annotationColor: e.target.value })}
            />
          </label>
          <label>
            Default stroke width
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={preferences.annotationStrokeWidth}
              onChange={(e) =>
                patch({ annotationStrokeWidth: Math.max(1, Math.min(20, Number(e.target.value))) })
              }
            />
          </label>
        </div>
        <h3>OCR</h3>
        <div className="form-columns">
          <label>
            Default language
            <input
              value={preferences.ocrLanguage}
              onChange={(e) => patch({ ocrLanguage: e.target.value })}
              maxLength={16}
            />
          </label>
          <label>
            Default page scope
            <select
              value={preferences.ocrScope}
              onChange={(e) => patch({ ocrScope: e.target.value as Preferences["ocrScope"] })}
            >
              <option value="current">Current page</option>
              <option value="all">All pages</option>
            </select>
          </label>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => set({ settingsOpen: false })}>
            Cancel
          </button>
          <button className="button primary">Save settings</button>
        </div>
      </form>
    </Dialog>
  );
}
