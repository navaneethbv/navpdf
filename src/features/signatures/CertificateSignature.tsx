import { useEffect, useId, useState } from "react";
import { AlertTriangle, BadgeCheck, FileKey, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { native } from "../../services/native";
import {
  chooseCertificate,
  ENGINE_UNAVAILABLE,
  forgetCertificate,
  saveSignedCopy,
  verifySignatures,
} from "../../services/engine";
import type { CertificateSummary, Certification, SignatureInfo } from "../../types/engine";

const CERTIFICATION_OPTIONS: [Certification, string][] = [
  ["none", "Do not certify"],
  ["formFillingAndComments", "Certify: allow form filling, signing and comments"],
  ["formFilling", "Certify: allow form filling and signing"],
  ["noChanges", "Certify: allow no changes"],
];

const STATUS_LABELS: Record<SignatureInfo["status"], string> = {
  valid: "Valid",
  modified: "Changed after signing",
  invalid: "Invalid",
  unsupported: "Not checked",
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Releases the decrypted key in the native process; failures leave nothing to recover. */
const releaseCertificate = () => void forgetCertificate().catch(() => {});

export function CertificateSignature({
  controller,
  onClose,
}: {
  controller: ViewerController | null;
  onClose: () => void;
}) {
  const s = useWorkspace();
  const ids = useId();
  const documentId = s.document?.id;
  const [password, setPassword] = useState("");
  const [certificate, setCertificate] = useState<CertificateSummary | null>(null);
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [certification, setCertification] = useState<Certification>("none");
  const [signatures, setSignatures] = useState<SignatureInfo[] | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const alreadySigned = (signatures?.length ?? 0) > 0;

  useEffect(() => {
    if (!native || !documentId) return;
    let current = true;
    verifySignatures(documentId)
      .then((result) => current && setSignatures(result))
      .catch((error) => current && setProblem(errorText(error)));
    return () => {
      current = false;
    };
  }, [documentId]);

  useEffect(() => releaseCertificate, []);

  const choose = async () => {
    setWorking(true);
    setProblem("");
    try {
      const summary = await chooseCertificate(password);
      if (summary) setCertificate(summary);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setPassword("");
      setWorking(false);
    }
  };

  const signCopy = async () => {
    const pdf = controller?.pdf;
    const doc = s.document;
    if (!controller || !pdf || !doc || !certificate) return;
    setWorking(true);
    setProblem("");
    try {
      controller.editor?.commitOrRemove();
      const bytes = await pdf.saveDocument();
      const result = await saveSignedCopy(doc.id, bytes, pdf.numPages, {
        reason,
        location,
        certification: alreadySigned ? "none" : certification,
      });
      if (!result) {
        s.set({ status: "Save cancelled" });
        return;
      }
      useWorkspace.getState().set({
        status: `Signed copy saved as ${result.name}. The open document itself is not signed.`,
      });
      onClose();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setWorking(false);
    }
  };

  const useAnother = () => {
    setCertificate(null);
    releaseCertificate();
  };

  const textField = (suffix: string, label: string, value: string, change: (value: string) => void) => (
    <div className="setting-group">
      <label className="setting-title" htmlFor={`${ids}-${suffix}`}>
        {label}
      </label>
      <input
        id={`${ids}-${suffix}`}
        className="text-input"
        value={value}
        maxLength={256}
        disabled={working}
        onChange={(event) => change(event.target.value)}
      />
    </div>
  );

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Certificate Signature">
      <div className="modal-dialog">
        <div className="modal-header">
          <div className="modal-title">
            <BadgeCheck size={18} />
            <h3>Certificate Signature</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form
          className="modal-body"
          onSubmit={(event) => {
            event.preventDefault();
            void (certificate ? signCopy() : choose());
          }}
        >
          {!native && (
            <div className="warning-banner">
              <AlertTriangle size={18} />
              <span>{ENGINE_UNAVAILABLE}</span>
            </div>
          )}
          <p className="field-hint">
            A certificate signature binds a saved copy to the certificate in your .p12 or .pfx
            file, so readers can detect later changes. It has no visible appearance on the page.
            NavPDF adds no timestamp or revocation data, does not check whether readers trust
            your certificate, and sends nothing over the network.
          </p>

          <section className="setting-group" aria-labelledby={`${ids}-existing`}>
            <h4 id={`${ids}-existing`} className="setting-title">
              Signatures in this file
            </h4>
            {native && signatures === null && !problem && <p className="field-hint">Checking signatures…</p>}
            {signatures?.length === 0 && <p className="field-hint">This file has no certificate signatures.</p>}
            {alreadySigned && (
              <>
                <ul className="signature-list">
                  {signatures!.map((signature) => (
                    <li key={signature.field} className={`signature-row ${signature.status}`}>
                      <span>
                        <strong>{STATUS_LABELS[signature.status]}</strong> · {signature.signer ?? signature.field}
                      </span>
                      <span className="field-hint">{signature.message}</span>
                      {signature.certification !== null && (
                        <span className="field-hint">
                          Certifying signature, permission level {signature.certification}.
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="field-hint">
                  Valid means the signed bytes match the signature and the certificate it
                  carries. Certificate trust and revocation are not checked.
                </p>
              </>
            )}
          </section>

          {certificate ? (
            <>
              <div className="security-status-box certificate-summary">
                <FileKey size={20} />
                <div>
                  <p>Signing as {certificate.subject}</p>
                  <p className="field-hint">
                    Issued by {certificate.selfSigned ? "itself (self-signed)" : certificate.issuer}. Valid{" "}
                    {certificate.notBefore} to {certificate.notAfter}. {certificate.keyType}.
                  </p>
                </div>
              </div>
              {textField("reason", "Reason", reason, setReason)}
              {textField("location", "Location", location, setLocation)}
              <div className="setting-group">
                <label className="setting-title" htmlFor={`${ids}-certification`}>
                  Certification
                </label>
                <select
                  id={`${ids}-certification`}
                  className="text-input"
                  value={alreadySigned ? "none" : certification}
                  disabled={working || alreadySigned}
                  onChange={(event) => setCertification(event.target.value as Certification)}
                >
                  {CERTIFICATION_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  {alreadySigned
                    ? "This file is already signed, so a new signature cannot certify it."
                    : "Certification states which later changes keep the signature valid in readers that honor it. Only the first signature can certify a document."}
                </p>
              </div>
            </>
          ) : (
            <div className="setting-group">
              <label className="setting-title" htmlFor={`${ids}-password`}>
                Certificate file password
              </label>
              <input
                id={`${ids}-password`}
                type="password"
                autoComplete="off"
                className="text-input"
                value={password}
                disabled={working || !native}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="field-hint">
                You choose the certificate file next. The password is used once to open it and is
                not stored.
              </p>
            </div>
          )}

          {problem && (
            <p className="error-text" role="alert">
              {problem}
            </p>
          )}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="button-secondary">
            Cancel
          </button>
          {certificate ? (
            <>
              <button type="button" className="button-secondary" disabled={working} onClick={useAnother}>
                Use Another Certificate
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={working || !controller?.pdf}
                onClick={() => void signCopy()}
              >
                <BadgeCheck size={16} /> {working ? "Signing…" : "Save Signed Copy…"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button-primary"
              disabled={working || !native}
              onClick={() => void choose()}
            >
              <FileKey size={16} /> {working ? "Opening…" : "Choose Certificate…"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
