import type { ReactNode } from "react";
import { X } from "lucide-react";
import { FeatureDialog } from "./FeatureDialog";

/**
 * The common frame for a document tool: a titled header, a body, an error line and a
 * footer with Cancel and one primary action. Close and Cancel are disabled while busy.
 */
export function ToolDialog({
  title,
  icon,
  onClose,
  busy = false,
  error = "",
  primaryLabel,
  busyLabel = "Working…",
  onPrimary,
  primaryDisabled = false,
  secondary,
  children,
}: Readonly<{
  title: string;
  icon: ReactNode;
  onClose: () => void;
  busy?: boolean;
  error?: string;
  primaryLabel: string;
  busyLabel?: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** Extra footer controls shown before Cancel. */
  secondary?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <FeatureDialog title={title} onClose={onClose} busy={busy}>
      <form
        className="modal-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !primaryDisabled) onPrimary();
        }}
      >
        <div className="modal-header">
          <div className="modal-title">
            {icon}
            <h3>{title}</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {children}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          {secondary}
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={busy || primaryDisabled}>
            {busy ? busyLabel : primaryLabel}
          </button>
        </div>
      </form>
    </FeatureDialog>
  );
}
