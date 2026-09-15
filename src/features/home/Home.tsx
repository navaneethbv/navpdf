import { FileText, FolderOpen, ShieldCheck, Clock3, ArrowUpRight } from "lucide-react";
import { Fragment } from "react";
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
  recover: (id: string) => void;
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
            <button onClick={() => void clearRecents().then(refresh).catch(onError)}>
              Clear history
            </button>
          )}
        </div>
        {local.recoveries.length > 0 && (
          <div className="recovery-box">
            <strong>
              {local.recoveries.length === 1
                ? "Recover an unsaved document"
                : "Recover unsaved documents"}
            </strong>
            {local.recoveries.map((entry) => (
              <Fragment key={entry.id}>
                <p>
                  {entry.name}
                  {entry.savedAt > 0 && (
                    <small> Saved {new Date(entry.savedAt * 1000).toLocaleString()}</small>
                  )}
                </p>
                <div>
                  <button
                    className="button"
                    onClick={() => recover(entry.id)}
                    aria-label={`Open recovery for ${entry.name}`}
                  >
                    Open recovery
                  </button>
                  <button
                    className="text-button"
                    onClick={() => void discardRecovery(entry.id).then(refresh).catch(onError)}
                    aria-label={`Discard recovery for ${entry.name}`}
                  >
                    Discard recovery
                  </button>
                </div>
              </Fragment>
            ))}
          </div>
        )}
        {local.recents.length ? (
          <div className="recent-files">
            {local.recents.map((r) => (
              <button key={r.id} onClick={() => recent(r.id, r.page)}>
                <FileText size={22} />
                <span>
                  <strong>{r.name}</strong>
                  <small>Opened {new Date(r.openedAt * 1000).toLocaleDateString()}</small>
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
