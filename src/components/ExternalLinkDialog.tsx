import { useState } from "react";
import { FeatureDialog } from "./FeatureDialog";

export function ExternalLinkDialog({
  url,
  reason,
  onClose,
  onOpen,
}: Readonly<{
  url: string;
  reason?: string;
  onClose: () => void;
  onOpen: (allowHost: boolean) => void;
}>) {
  const [allowHost, setAllowHost] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(url).catch(() => undefined);
  };
  return (
    <FeatureDialog title="Open external link" onClose={onClose}>
      <div className="modal-dialog">
        <div className="modal-body">
          <p>NavPDF stopped this document from navigating automatically.</p>
          <p className="external-link-value" title={url}>
            {url}
          </p>
          {reason ? (
            <p className="error-text" role="alert">
              {reason}
            </p>
          ) : (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={allowHost}
                onChange={(event) => setAllowHost(event.target.checked)}
              />{" "}
              Allow this host for this session
            </label>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button-secondary" onClick={copy}>
            Copy link
          </button>
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          {!reason && (
            <button type="button" className="button-primary" onClick={() => onOpen(allowHost)}>
              Open
            </button>
          )}
        </div>
      </div>
    </FeatureDialog>
  );
}
