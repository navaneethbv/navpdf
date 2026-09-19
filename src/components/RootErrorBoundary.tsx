import { Component, type ReactNode } from "react";
import type { ViewerController } from "../features/viewer/controller";
import type { DocumentDescriptor } from "../types/document";
import { downloadBytes, safeFileName } from "../utils/download";
import { native, saveDocument as saveNativeDocument } from "../services/native";

interface Props {
  children: ReactNode;
  controller?: ViewerController | null;
  document?: DocumentDescriptor | null;
  resetKey?: string;
}

interface State {
  failed: boolean;
  saving: boolean;
  saved: boolean;
  saveError: string;
}

/** Keeps a render failure from discarding the open PDF proxy and its unsaved edits. */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, saving: false, saved: false, saveError: "" };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch() {
    // The document and extracted text stay out of logs and the fallback UI.
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false, saveError: "", saved: false });
    }
  }

  private saveCopy = async () => {
    const pdf = this.props.controller?.pdf;
    if (!pdf) {
      this.setState({ saveError: "The current document is no longer available." });
      return;
    }
    this.setState({ saving: true, saveError: "" });
    try {
      const bytes = await pdf.saveDocument();
      if (native && this.props.document) {
        const result = await saveNativeDocument(this.props.document, bytes, pdf.numPages, true);
        if (!result) return;
      } else {
        const sourceName = this.props.document?.name ?? "document.pdf";
        const baseName = sourceName.replace(/\.pdf$/i, "") || "document";
        if (!(await downloadBytes(bytes, safeFileName(`${baseName}-recovered.pdf`)))) return;
      }
      this.setState({ saved: true });
    } catch {
      this.setState({ saveError: "The current document could not be saved." });
    } finally {
      this.setState({ saving: false });
    }
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="root-error-boundary" role="alert">
        <h1>NavPDF needs to recover this workspace</h1>
        <p>The workspace stopped rendering. Your open document is still held in this session.</p>
        <button
          type="button"
          className="button primary"
          onClick={() => void this.saveCopy()}
          disabled={this.state.saving}
        >
          {this.state.saving ? "Saving..." : "Save a copy"}
        </button>
        {this.state.saved && <p className="field-hint">A copy was saved.</p>}
        {this.state.saveError && <p className="error-text">{this.state.saveError}</p>}
      </main>
    );
  }
}
