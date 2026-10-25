import type { CertificateDetails, SignatureInfo, TrustStatus } from "../../types/engine";

export const STATUS_LABELS: Record<SignatureInfo["status"], string> = {
  valid: "Valid",
  modified: "Changed after signing",
  invalid: "Invalid",
  unsupported: "Not checked",
};

export const TRUST_LABELS: Record<TrustStatus, string> = {
  trusted: "Signer trusted",
  notTrusted: "Signer not trusted",
  notValidAtSigning: "Certificate not valid when signed",
  brokenChain: "Certificate chain broken",
};

/** One certificate's identity, dates and fingerprint. */
export function CertificateCard({
  certificate,
  action,
}: Readonly<{ certificate: CertificateDetails; action?: React.ReactNode }>) {
  return (
    <div className="certificate-card">
      <dl>
        <dt>Subject</dt>
        <dd>{certificate.subject}</dd>
        <dt>Issuer</dt>
        <dd>{certificate.selfSigned ? "Itself (self-signed)" : certificate.issuer}</dd>
        <dt>Valid</dt>
        <dd>
          {certificate.notBefore} to {certificate.notAfter}
        </dd>
        <dt>Serial</dt>
        <dd className="certificate-hex">{certificate.serial}</dd>
        <dt>SHA-256</dt>
        <dd className="certificate-hex">{certificate.fingerprint}</dd>
      </dl>
      {certificate.trusted && <p className="field-hint">You trust this certificate.</p>}
      {action}
    </div>
  );
}

function permissionText(permitted: boolean | null) {
  if (permitted === null) return null;
  return permitted
    ? "The document's certification allows these changes."
    : "The document's certification does not allow these changes.";
}

/** A signature's result, its certificate chain and what changed after it. */
export function SignatureDetails({
  signature,
  busy,
  onTrust,
  onOpenSigned,
}: Readonly<{
  signature: SignatureInfo;
  busy: boolean;
  onTrust: (fingerprint: string) => void;
  onOpenSigned: () => void;
}>) {
  const changed = !signature.coversWholeDocument && signature.revisionLength !== null;
  const permission = permissionText(signature.changesPermitted);
  return (
    <li className={`signature-row ${signature.status}`}>
      <span>
        <strong>{STATUS_LABELS[signature.status]}</strong>
        {signature.trust && <> · {TRUST_LABELS[signature.trust]}</>} ·{" "}
        {signature.signer ?? signature.field}
      </span>
      <span className="field-hint">{signature.message}</span>
      {signature.trustMessage && <span className="field-hint">{signature.trustMessage}</span>}
      {signature.signedAt && (
        <span className="field-hint">Signing time stated by the signer: {signature.signedAt}</span>
      )}
      {signature.certification !== null && (
        <span className="field-hint">
          Certifying signature, permission level {signature.certification}.
        </span>
      )}
      {changed && (
        <div className="signature-changes">
          <strong>Changes after this signature</strong>
          <ul>
            {signature.changes.map((change) => (
              <li key={`${change.kind}-${change.description}`}>{change.description}</li>
            ))}
          </ul>
          {permission && <span className="field-hint">{permission}</span>}
        </div>
      )}
      {signature.certificates.length > 0 && (
        <details className="signature-certificates">
          <summary>Certificate details</summary>
          {signature.certificates.map((certificate, index) => (
            <CertificateCard
              key={certificate.fingerprint}
              certificate={certificate}
              action={
                !certificate.trusted && (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => onTrust(certificate.fingerprint)}
                  >
                    Trust {index === 0 ? "This Signer" : "This Issuer"}
                  </button>
                )
              }
            />
          ))}
        </details>
      )}
      {changed && (signature.status === "valid" || signature.status === "unsupported") && (
        <button
          type="button"
          className="button-secondary signature-open-signed"
          disabled={busy}
          onClick={onOpenSigned}
        >
          Open Signed Version
        </button>
      )}
    </li>
  );
}
