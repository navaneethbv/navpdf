import {
  FileText,
  FolderOpen,
  ShieldCheck,
  Clock3,
  ArrowUpRight,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { native, clearRecents, discardRecovery } from "../../services/native";
export function Home({
  open,
  recent,
  recover,
  refresh,
  onError,
}: {
  open: () => void;
  recent: (id: string, page: number) => void;
  recover: () => void;
  refresh: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const local = useWorkspace((s) => s.local);
  return (
    <main className="home">
      <div className="home-intro">
        <div className="home-mark">
          <FileText size={35} />
        </div>
        <h1>
          Your documents.
          <br />
          Right where they belong.
        </h1>
        <p>
          A focused workspace for reading and marking up PDFs.
          <br />
          Private by design. Everything stays on this device.
        </p>
        <button className="button primary" onClick={open}>
          <FolderOpen size={18} /> Open PDF
        </button>
        <span className="home-shortcut">⌘ O to open a document</span>
      </div>
      <section className="recent-section">
        <div className="section-title">
          <h2>
            <Clock3 size={17} /> Recent documents
          </h2>
          {local.recents.length > 0 && (
            <button
              onClick={() => void clearRecents().then(refresh).catch(onError)}
            >
              Clear history
            </button>
          )}
        </div>
        {local.recovery && (
          <div className="recovery-box">
            <strong>Recover an unsaved document</strong>
            <p>{local.recovery.name}</p>
            <div>
              <button className="button" onClick={recover}>
                Open recovery
              </button>
              <button
                className="text-button"
                onClick={() =>
                  void discardRecovery().then(refresh).catch(onError)
                }
              >
                Discard recovery
              </button>
            </div>
          </div>
        )}
        {local.recents.length ? (
          <div className="recent-files">
            {local.recents.map((r) => (
              <button key={r.id} onClick={() => recent(r.id, r.page)}>
                <FileText size={22} />
                <span>
                  <strong>{r.name}</strong>
                  <small>
                    Opened {new Date(r.openedAt * 1000).toLocaleDateString()}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <div className="recent-empty">
            <FileText size={27} />
            <p>
              {local.preferences.recentFiles
                ? "Your recent PDFs will appear here."
                : "Recent document history is disabled."}
            </p>
          </div>
        )}
        <div className="home-privacy">
          <ShieldCheck size={17} />
          <span>
            {native
              ? "No uploads. No network access. No account."
              : "Browser development preview. Native saving is available in the desktop app."}
          </span>
        </div>
      </section>
    </main>
  );
}
