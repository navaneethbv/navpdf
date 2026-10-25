import { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, BadgeCheck, FileKey, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ViewerController } from "../viewer/controller";
import { native } from "../../services/native";
import {
  chooseCertificate,
  ENGINE_UNAVAILABLE,
  forgetCertificate,
  saveSignedCopy,
  signedRevision,
  trustedCertificates,
  trustSignatureCertificate,
  verifySignatures,
} from "../../services/engine";
import type {
  CertificateDetails,
  CertificateSummary,
  Certification,
  SignatureCorner,
  SignatureInfo,
} from "../../types/engine";
import { FeatureDialog } from "../../components/FeatureDialog";
import { SignatureDetails } from "./SignatureDetails";
import { TrustedCertificates } from "./TrustedCertificates";

const CERTIFICATION_OPTIONS: [Certification, string][] = [
  ["none", "Do not certify"],
  ["formFillingAndComments", "Certify: allow form filling, signing and comments"],
  ["formFilling", "Certify: allow form filling and signing"],
  ["noChanges", "Certify: allow no changes"],
];

const CORNER_OPTIONS: [SignatureCorner, string][] = [
  ["bottomRight", "Bottom right"],
  ["bottomLeft", "Bottom left"],
  ["topRight", "Top right"],
  ["topLeft", "Top left"],
];

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Releases the decrypted key in the native process; failures leave nothing to recover. */
const releaseCertificate = () => void forgetCertificate().catch(() => {});

export function CertificateSignature({
  controller,
  onClose,
  onOpen,
}: Readonly<{
  controller: ViewerController | null;
  onClose: () => void;
  /** Opens a file in a new tab, used for a signature's signed version. */
  onOpen: (file: File) => void;
}>) {
  const s = useWorkspace();
  const ids = useId();
  const documentId = s.document?.id;
  const [password, setPassword] = useState("");
  const [certificate, setCertificate] = useState<CertificateSummary | null>(null);
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [certification, setCertification] = useState<Certification>("none");
  const [visible, setVisible] = useState(false);
  const [appearancePage, setAppearancePage] = useState(s.page || 1);
  const [corner, setCorner] = useState<SignatureCorner>("bottomRight");
  const [signatures, setSignatures] = useState<SignatureInfo[] | null>(null);
  const [trusted, setTrusted] = useState<CertificateDetails[] | null>(null);
  // Bumped when the user changes the trust list, so the signatures are checked again.
  const [trustVersion, setTrustVersion] = useState(0);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const alreadySigned = (signatures?.length ?? 0) > 0;
  const pageCount = controller?.pdf?.numPages ?? 1;

  useEffect(() => {
    if (!native || !documentId) return undefined;
    let current = true;
    verifySignatures(documentId)
      .then((result) => current && setSignatures(result))
      .catch((error) => current && setProblem(errorText(error)));
    return () => {
      current = false;
    };
  }, [documentId, trustVersion]);

  useEffect(() => {
    if (!native) return undefined;
    let current = true;
    trustedCertificates()
      .then((result) => current && setTrusted(result))
      .catch((error) => current && setProblem(errorText(error)));
    return () => {
      current = false;
    };
  }, []);

  const changeTrust = useCallback((list: CertificateDetails[]) => {
    setTrusted(list);
    setTrustVersion((version) => version + 1);
  }, []);

  const trust = async (fingerprint: string) => {
    if (!documentId) return;
    setWorking(true);
    setProblem("");
    try {
      changeTrust(await trustSignatureCertificate(documentId, fingerprint));
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setWorking(false);
    }
  };

  const openSigned = async (signature: SignatureInfo) => {
    const doc = s.document;
    if (!doc) return;
    setWorking(true);
    setProblem("");
    try {
      const bytes = await signedRevision(doc.id, signature.field);
      const base = doc.name.replace(/\.pdf$/i, "");
      onOpen(
        new File([bytes], `${base} (signed version, ${signature.field}).pdf`, {
          type: "application/pdf",
        }),
      );
      onClose();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setWorking(false);
    }
  };

  const reportProblem = useCallback((message: string) => setProblem(message), []);

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
        ...(visible && {
          appearance: {
            page: Math.min(Math.max(1, Math.round(appearancePage)), pdf.numPages),
            corner,
          },
        }),
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

  const textField = (
    suffix: string,
    label: string,
    value: string,
    change: (value: string) => void,
  ) => (
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
    <FeatureDialog title="Certificate Signature" onClose={onClose} busy={working}>
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
            A certificate signature binds a saved copy to the certificate in your .p12 or .pfx file,
            so readers can detect later changes. A visible box on the page is optional and is only a
            picture of the signature. NavPDF adds no timestamp or revocation data, cannot decide
            whether other readers trust your certificate, and sends nothing over the network.
          </p>

          <section className="setting-group" aria-labelledby={`${ids}-existing`}>
            <h4 id={`${ids}-existing`} className="setting-title">
              Signatures in this file
            </h4>
            {native && signatures === null && !problem && (
              <p className="field-hint">Checking signatures…</p>
            )}
            {signatures?.length === 0 && (
              <p className="field-hint">This file has no certificate signatures.</p>
            )}
            {alreadySigned && (
              <>
                <ul className="signature-list">
                  {signatures!.map((signature) => (
                    <SignatureDetails
                      key={signature.field}
                      signature={signature}
                      busy={working}
                      onTrust={(fingerprint) => void trust(fingerprint)}
                      onOpenSigned={() => void openSigned(signature)}
                    />
                  ))}
                </ul>
                <p className="field-hint">
                  Valid means the signed bytes match the signature and the certificate it carries.
                  Trust means that certificate, or one that issued it, is in your trusted list.
                  Revocation and timestamps are not checked.
                </p>
              </>
            )}
          </section>

          {trusted && (
            <TrustedCertificates list={trusted} onChange={changeTrust} onProblem={reportProblem} />
          )}

          {certificate ? (
            <>
              <div className="security-status-box certificate-summary">
                <FileKey size={20} />
                <div>
                  <p>Signing as {certificate.subject}</p>
                  <p className="field-hint">
                    Issued by {certificate.selfSigned ? "itself (self-signed)" : certificate.issuer}
                    . Valid {certificate.notBefore} to {certificate.notAfter}. {certificate.keyType}
                    .
                  </p>
                </div>
              </div>
              {textField("reason", "Reason", reason, setReason)}
              {textField("location", "Location", location, setLocation)}
              <fieldset className="setting-group signature-appearance">
                <legend className="setting-title">Appearance</legend>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={working}
                    onChange={(event) => setVisible(event.target.checked)}
                  />
                  <span>Show the signature on a page</span>
                </label>
                {visible && (
                  <div className="signature-appearance-options">
                    <label htmlFor={`${ids}-appearance-page`}>Page</label>
                    <input
                      id={`${ids}-appearance-page`}
                      type="number"
                      className="text-input"
                      min={1}
                      max={pageCount}
                      value={appearancePage}
                      disabled={working}
                      onChange={(event) => setAppearancePage(Number(event.target.value))}
                    />
                    <label htmlFor={`${ids}-appearance-corner`}>Corner</label>
                    <select
                      id={`${ids}-appearance-corner`}
                      className="text-input"
                      value={corner}
                      disabled={working}
                      onChange={(event) => setCorner(event.target.value as SignatureCorner)}
                    >
                      {CORNER_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="field-hint">
                  The box names the signer, the signing time and the reason in a standard font;
                  characters outside Western European text appear as question marks.
                </p>
              </fieldset>
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
              <button
                type="button"
                className="button-secondary"
                disabled={working}
                onClick={useAnother}
              >
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
    </FeatureDialog>
  );
}
