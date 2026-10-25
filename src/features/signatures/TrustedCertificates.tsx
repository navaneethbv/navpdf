import { useState } from "react";
import { importTrustedCertificate, untrustCertificate } from "../../services/engine";
import type { CertificateDetails } from "../../types/engine";
import { CertificateCard } from "./SignatureDetails";

/** The certificates trusted on this device for checking signatures; changes go to `onChange`. */
export function TrustedCertificates({
  list,
  onChange,
  onProblem,
}: Readonly<{
  list: CertificateDetails[];
  onChange: (list: CertificateDetails[]) => void;
  onProblem: (message: string) => void;
}>) {
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<CertificateDetails[] | null>) => {
    setBusy(true);
    try {
      const result = await action();
      if (result) onChange(result);
    } catch (error) {
      onProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="setting-group trusted-certificates">
      <summary className="setting-title">Trusted certificates ({list.length})</summary>
      <p className="field-hint">
        A signature is shown as trusted when its certificate, or one that issued it, is in this
        list. The list stays on this device. Revocation is not checked.
      </p>
      {list.length === 0 && <p className="field-hint">No certificates are trusted yet.</p>}
      {list.map((certificate) => (
        <CertificateCard
          key={certificate.fingerprint}
          certificate={certificate}
          action={
            <button
              type="button"
              className="button-secondary"
              disabled={busy}
              onClick={() => void run(() => untrustCertificate(certificate.fingerprint))}
            >
              Stop Trusting
            </button>
          }
        />
      ))}
      <button
        type="button"
        className="button-secondary"
        disabled={busy}
        onClick={() => void run(importTrustedCertificate)}
      >
        Add Certificate File…
      </button>
    </details>
  );
}
