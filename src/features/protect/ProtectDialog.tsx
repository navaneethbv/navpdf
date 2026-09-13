import { useState } from "react";
import { Shield, Lock, X, AlertTriangle } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";

export function ProtectDialog({ onClose }: { onClose: () => void }) {
  const s = useWorkspace();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const isEncrypted = s.info?.encrypted;

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Password Protect PDF">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <Shield size={18} />
            <h3>{isEncrypted ? "Document Protection" : "Password Protect PDF"}</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {isEncrypted ? (
            <div className="security-status-box">
              <Lock size={20} />
              <p>
                This document is password protected and opens read-only in
                NavPDF. Editing or re-encrypting protected files is deferred
                until encryption-preserving editing is verified. Your original
                is unchanged.
              </p>
            </div>
          ) : (
            <>
              <div className="warning-banner">
                <AlertTriangle size={18} />
                <span>
                  Real PDF encryption needs the M6 protection engine (password
                  handling with an encryption-aware validator), which is not
                  yet integrated. The password fields below are disabled so this
                  dialog can never pretend a document is encrypted when it is
                  not.
                </span>
              </div>

              <div className="setting-group" style={{ marginTop: "12px" }}>
                <label className="setting-title">Document Password</label>
                <input
                  type="password"
                  placeholder="Password protection is not available yet"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="text-input"
                  disabled
                  aria-describedby="protect-engine-note"
                />
              </div>

              <div className="setting-group">
                <label className="setting-title">Confirm Password</label>
                <input
                  type="password"
                  placeholder="Password protection is not available yet"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="text-input"
                  disabled
                />
              </div>

              <p className="field-hint" id="protect-engine-note">
                Anyone opening this document is not yet protected by a password
                you set here. Keep sensitive files in encrypted storage until
                the protection engine lands.
              </p>
            </>
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
