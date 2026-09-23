import { useEffect, useRef, useState } from "react";
import { FolderOpen, Search, Highlighter, Save, Palette, Lightbulb, BookOpen } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { useWorkspace } from "../../stores/workspace";
import { savePreferences } from "../../services/native";
import type { Preferences } from "../../types/document";

const steps = [
  {
    icon: FolderOpen,
    title: "Your PDFs, on your device",
    text: "Open a PDF from the toolbar, drop one onto NavPDF, or use Finder's Open With menu. Your documents stay on your device.",
    detail: "Start with one document. Recent files and recovery copies appear on Home.",
  },
  {
    icon: Search,
    title: "Find your way around",
    text: "Use the right rail for page thumbnails, bookmarks, search and comments. Page numbers and zoom controls are at the bottom of that rail.",
    detail:
      "Find text with Command+F on macOS or Control+F on Windows and Linux. Image-only scans need OCR before text search.",
  },
  {
    icon: Highlighter,
    title: "Read, mark up and edit",
    text: "Select text to highlight it, add comments, or use the pen to draw. All tools groups page organization, forms, signatures and other editing tools.",
    detail:
      "Use Undo and Redo to revise edits. Painting over content is not secure redaction; use the Redact tool for permanent removal.",
  },
  {
    icon: Save,
    title: "Keep your changes",
    text: "Save commits your edits. Save As lets you keep a separate copy, and NavPDF asks before you leave unsaved changes behind.",
    detail:
      "Autosave creates local recovery copies for unencrypted PDFs. It does not replace saving your document.",
  },
  {
    icon: Palette,
    title: "Make the workspace yours",
    text: "Settings offers System, Light and Dark modes, with 15 color palettes for each mode. You can also choose your own background and accent colors.",
    detail:
      "Return to this tour or browse tips anytime from Help and tips. Startup tips can be turned off in their dialog or in Settings.",
  },
];
const tips = [
  {
    title: "Keep an original copy",
    text: "Use Save As when you want to experiment without replacing your original PDF. In Settings, choose Always save a copy to make this your default.",
  },
  {
    title: "Search scanned pages",
    text: "If Find cannot locate words on a scanned page, run OCR from All tools first. Review the recognized text before relying on it.",
  },
  {
    title: "Find your place faster",
    text: "The right rail opens page thumbnails, bookmarks, search results and comments. Click a thumbnail to jump directly to that page.",
  },
  {
    title: "Give your eyes a change",
    text: "Settings remembers separate Light and Dark palettes. Try Amber, Ocean or Acrobat Gray, or override the background and accent with your own colors.",
  },
  {
    title: "Recovery is a safety net",
    text: "Autosave keeps local recovery copies for unencrypted PDFs. Check Home after an interrupted session, then use Save As to keep a recovered copy.",
  },
  {
    title: "Redact, then verify",
    text: "A rectangle or highlight does not remove the text underneath it. Use Redact for permanent removal and inspect the saved result before sharing.",
  },
  {
    title: "Focus on reading",
    text: "Use Read mode to give the document more room. Press Escape to return to the full workspace.",
  },
  {
    title: "Retrace your steps",
    text: "After following a link or bookmark, Previous View (⌘[ or Alt+Left) returns to where you were. Next View (⌘]) goes forward again.",
  },
  {
    title: "Listen or scroll hands-free",
    text: "View > Read Out Loud reads pages with your system voice, and Automatically Scroll (⇧⌘H) moves through long documents. Press Escape to stop scrolling.",
  },
];

export function GettingStarted({ ready }: Readonly<{ ready: boolean }>) {
  const state = useWorkspace();
  const startupHandled = useRef(false);
  useEffect(() => {
    if (!ready || startupHandled.current || state.busy || state.settingsOpen || state.activeModal)
      return;
    startupHandled.current = true;
    if (!state.local.preferences.tourCompleted) state.set({ activeModal: "tour" });
    else if (state.local.preferences.showStartupTips) state.set({ activeModal: "tips" });
  }, [ready, state]);
  const mode = state.activeModal;
  if (mode !== "help" && mode !== "tour" && mode !== "tips") return null;
  return <GuideDialog key={mode} mode={mode} />;
}

type GuideMode = "help" | "tour" | "tips";

function GuideDialog({ mode }: Readonly<{ mode: GuideMode }>) {
  const [step, setStep] = useState(0);
  const [tip, setTip] = useState(() => Math.floor(Date.now() / 86_400_000) % tips.length);
  const [hideTips, setHideTips] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const close = async () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await persistGuidePreferences(mode, hideTips);
    } catch {
      setError("Your preference could not be saved. Try again to dismiss this dialog.");
      pending.current = false;
      setSaving(false);
      return;
    }
    useWorkspace.getState().set({ activeModal: null });
  };
  const card = getGuideCard(mode, step, tip);
  const nextLabel = step === steps.length - 1 ? "Get started" : "Next";
  const Icon = card.icon;
  return (
    <Dialog
      title={getGuideTitle(mode)}
      onClose={() => void close()}
      busy={saving}
      className="guide-dialog"
    >
      {mode === "help" ? (
        <div className="guide-help">
          <p>Get familiar with your workspace, or discover a useful shortcut.</p>
          <button
            className="button"
            data-autofocus
            onClick={() => useWorkspace.getState().set({ activeModal: "tour" })}
          >
            <BookOpen size={20} /> Take a tour
          </button>
          <button
            className="button"
            onClick={() => useWorkspace.getState().set({ activeModal: "tips" })}
          >
            <Lightbulb size={20} /> Browse tips
          </button>
        </div>
      ) : (
        <>
          <div className="guide-content" aria-live="polite" aria-atomic="true">
            <span className="guide-icon" aria-hidden="true">
              <Icon size={30} />
            </span>
            <p className="guide-progress">{card.progress}</p>
            <h3>{card.title}</h3>
            <p>{card.text}</p>
            {card.detail && <p className="guide-detail">{card.detail}</p>}
          </div>
          {mode === "tips" && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={hideTips}
                disabled={saving}
                onChange={(event) => {
                  setHideTips(event.target.checked);
                }}
              />{" "}
              Don’t show tips again
            </label>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="guide-actions">
            {mode === "tour" ? (
              <>
                <button className="button" disabled={saving} onClick={() => void close()}>
                  Skip tour
                </button>
                <span />
                <button
                  className="button"
                  disabled={saving || step === 0}
                  onClick={() => {
                    setStep(step - 1);
                  }}
                >
                  Back
                </button>
                <button
                  data-autofocus
                  className="button primary"
                  disabled={saving}
                  onClick={() => {
                    if (step === steps.length - 1) void close();
                    else setStep(step + 1);
                  }}
                >
                  {saving ? "Saving…" : nextLabel}
                </button>
              </>
            ) : (
              <>
                <button
                  className="button"
                  disabled={saving}
                  onClick={() => {
                    setTip((tip + 1) % tips.length);
                  }}
                >
                  Next tip
                </button>
                <span />
                <button
                  data-autofocus
                  className="button primary"
                  disabled={saving}
                  onClick={() => void close()}
                >
                  {saving ? "Saving…" : "Dismiss"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

function getGuideTitle(mode: "help" | "tour" | "tips"): string {
  switch (mode) {
    case "tour":
      return "Welcome to NavPDF";
    case "tips":
      return "A tip for your workspace";
    case "help":
    default:
      return "Help and tips";
  }
}

function getGuideCard(mode: GuideMode, step: number, tip: number) {
  if (mode === "tour") {
    const current = steps.at(step) ?? steps[0];
    return {
      icon: current.icon,
      title: current.title,
      text: current.text,
      detail: current.detail,
      progress: `Step ${step + 1} of ${steps.length}`,
    };
  }
  const currentTip = tips.at(tip) ?? tips[0];
  return {
    icon: Lightbulb,
    title: currentTip.title,
    text: currentTip.text,
    detail: undefined,
    progress: `Tip ${tip + 1} of ${tips.length}`,
  };
}

async function persistGuidePreferences(mode: GuideMode, hideTips: boolean): Promise<void> {
  const state = useWorkspace.getState();
  const patch: Partial<Preferences> = {};
  if (mode === "tour" && !state.local.preferences.tourCompleted) patch.tourCompleted = true;
  if (mode === "tips" && hideTips) patch.showStartupTips = false;
  if (Object.keys(patch).length === 0) return;
  const preferences = { ...state.local.preferences, ...patch };
  await savePreferences(preferences);
  useWorkspace.getState().set({ local: { ...state.local, preferences } });
}
