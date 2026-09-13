import { useState } from "react";
import { Sparkles, Presentation, FolderKanban, BookOpen, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";

interface Citation {
  page: number;
  text: string;
}

export function AssistantPanel({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const [tab, setTab] = useState<"summary" | "presentation" | "spaces">("summary");
  const [summary, setSummary] = useState<Citation[]>([]);
  const [generating, setGenerating] = useState(false);

  const handleGenerateSummary = async () => {
    if (!controller?.pdf) return;
    setGenerating(true);
    try {
      const total = Math.min(controller.pdf.numPages, 10);
      const points: Citation[] = [];
      for (let i = 1; i <= total; i++) {
        const page = await controller.pdf.getPage(i);
        const textContent = await page.getTextContent();
        // @ts-expect-error item str
        const pageText = textContent.items.map((it) => it.str || "").join(" ").trim();
        if (pageText) {
          const firstSentence = pageText.split(".")[0] || pageText.slice(0, 80);
          points.push({
            page: i,
            text: firstSentence,
          });
        }
      }
      setSummary(points);
      s.set({ status: "Page key points extracted (first-sentence index)" });
    } catch (err) {
      s.set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Document Assistant">
      <div className="modal-dialog assistant-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Sparkles size={18} />
            <h3>Intelligent Document Tools</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="tab-buttons-bar">
          <button
            className={tab === "summary" ? "active" : ""}
            onClick={() => setTab("summary")}
          >
            <BookOpen size={15} /> Executive Summary
          </button>
          <button
            className={tab === "presentation" ? "active" : ""}
            onClick={() => setTab("presentation")}
          >
            <Presentation size={15} /> Slide Outline
          </button>
          <button
            className={tab === "spaces" ? "active" : ""}
            onClick={() => setTab("spaces")}
          >
            <FolderKanban size={15} /> PDF Spaces
          </button>
        </div>

        <div className="modal-body">
          {tab === "summary" && (
            <div className="assistant-content">
              <p className="field-hint">
                An extractive on-device index: the first sentence of each page
                with direct page citations. Abstractive summarization needs the
                M7 local-model decision, which is pending.
              </p>

              {summary.length === 0 ? (
                <div className="assistant-empty-state">
                  <button
                    className="button-primary"
                    onClick={handleGenerateSummary}
                    disabled={generating}
                  >
                    <Sparkles size={16} />
                    {generating ? "Indexing Pages..." : "Build Page Index"}
                  </button>
                </div>
              ) : (
                <div className="citations-list">
                  {summary.map((item, idx) => (
                    <div
                      key={idx}
                      className="citation-card"
                      onClick={() => {
                        controller?.goTo(item.page);
                        onClose();
                      }}
                    >
                      <span className="citation-badge">Page {item.page}</span>
                      <p className="citation-text">{item.text}.</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "presentation" && (
            <div className="assistant-content">
              <p className="field-hint">
                A static three-slide starter template. Real outline generation
                from document content needs the M7 decision and is pending.
              </p>
              <div className="outline-preview">
                <div className="slide-outline-item">
                  <strong>Slide 1: Title & Introduction</strong>
                  <span>Overview of {s.document?.name || "the document"}</span>
                </div>
                <div className="slide-outline-item">
                  <strong>Slide 2: Primary Content & Findings</strong>
                  <span>Key themes extracted across pages 1 to {s.info?.pages || 1}</span>
                </div>
                <div className="slide-outline-item">
                  <strong>Slide 3: Conclusions & Next Steps</strong>
                  <span>Action items and summary notes</span>
                </div>
              </div>
            </div>
          )}

          {tab === "spaces" && (
            <div className="assistant-content">
              <p className="field-hint">
                Organize projects and documents into local workspaces without cloud accounts.
              </p>
              <div className="spaces-card">
                <FolderKanban size={24} />
                <strong>Default Local Space</strong>
                <span>Active document: {s.document?.name || "None"}</span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="button-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
