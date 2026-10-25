// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  ENGINE_UNAVAILABLE: "desktop only",
  chooseCertificate: vi.fn(),
  forgetCertificate: vi.fn(async () => {}),
  saveSignedCopy: vi.fn(),
  verifySignatures: vi.fn(),
  trustedCertificates: vi.fn(async () => [] as unknown[]),
  trustSignatureCertificate: vi.fn(),
  importTrustedCertificate: vi.fn(),
  untrustCertificate: vi.fn(),
  signedRevision: vi.fn(),
}));

vi.mock("../../src/services/engine", () => engine);
vi.mock("../../src/services/native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/native")>()),
  native: true,
}));

import { CertificateSignature } from "../../src/features/signatures/CertificateSignature";
import { useWorkspace } from "../../src/stores/workspace";

const SUMMARY = {
  subject: "CN=Synthetic Signer,O=NavPDF Tests",
  issuer: "CN=Synthetic Root",
  notBefore: "2026-09-01",
  notAfter: "2026-10-01",
  keyType: "RSA 2048-bit",
  chainLength: 2,
  selfSigned: false,
};

const INSPECTION = {
  certificates: [],
  trust: null,
  trustMessage: "",
  revisionLength: null,
  changes: [],
  changesPermitted: null,
};

const LEAF = {
  subject: "CN=Earlier Signer",
  issuer: "CN=Synthetic Root",
  serial: "02",
  notBefore: "2026-09-01",
  notAfter: "2027-09-01",
  fingerprint: "AA:BB",
  selfSigned: false,
  trusted: false,
};
const ROOT = {
  ...LEAF,
  subject: "CN=Synthetic Root",
  serial: "01",
  fingerprint: "CC:DD",
  selfSigned: true,
};

function seed() {
  act(() => {
    useWorkspace.getState().reset();
    useWorkspace.getState().set({
      document: { id: "doc", name: "synthetic.pdf", size: 10 },
      page: 1,
    });
  });
}

function controller() {
  return {
    pdf: { numPages: 3, saveDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) },
    editor: { commitOrRemove: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("certificate signature dialog", () => {
  it("chooses a certificate, signs a copy and releases the key when closed", async () => {
    seed();
    engine.verifySignatures.mockResolvedValue([]);
    engine.chooseCertificate.mockResolvedValue(SUMMARY);
    engine.saveSignedCopy.mockResolvedValue({ name: "synthetic-signed.pdf", size: 900 });
    const view = controller();
    const onClose = vi.fn();
    const { unmount } = render(
      <CertificateSignature controller={view as never} onClose={onClose} onOpen={() => {}} />,
    );

    expect(await screen.findByText("This file has no certificate signatures.")).toBeTruthy();
    expect(engine.verifySignatures).toHaveBeenCalledWith("doc");
    fireEvent.change(screen.getByLabelText("Certificate file password"), {
      target: { value: "synthetic-p12" },
    });
    fireEvent.click(screen.getByText("Choose Certificate…"));
    expect(await screen.findByText("Signing as CN=Synthetic Signer,O=NavPDF Tests")).toBeTruthy();
    expect(engine.chooseCertificate).toHaveBeenCalledWith("synthetic-p12");
    expect(screen.queryByLabelText("Certificate file password")).toBeNull();

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Synthetic approval" } });
    fireEvent.change(screen.getByLabelText("Certification"), { target: { value: "formFilling" } });
    fireEvent.click(screen.getByText("Save Signed Copy…"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(view.editor.commitOrRemove).toHaveBeenCalled();
    expect(engine.saveSignedCopy).toHaveBeenCalledWith("doc", expect.any(Uint8Array), 3, {
      reason: "Synthetic approval",
      location: "",
      certification: "formFilling",
    });
    expect(useWorkspace.getState().status).toBe(
      "Signed copy saved as synthetic-signed.pdf. The open document itself is not signed.",
    );
    unmount();
    expect(engine.forgetCertificate).toHaveBeenCalled();
  });

  it("lists existing signatures, never certifies a signed file and reports failures", async () => {
    seed();
    engine.verifySignatures.mockResolvedValue([
      {
        field: "Signature1",
        signer: "CN=Earlier Signer",
        issuer: "CN=Synthetic Root",
        signedAt: "D:20260914000000Z",
        reason: null,
        subFilter: "ETSI.CAdES.detached",
        status: "valid",
        message:
          "The signed revision is unchanged, but the document was changed after this signature.",
        coversWholeDocument: false,
        certification: 2,
        ...INSPECTION,
      },
      {
        field: "Signature2",
        signer: null,
        issuer: null,
        signedAt: null,
        reason: null,
        subFilter: null,
        status: "modified",
        message: "The signed content was changed after signing.",
        coversWholeDocument: true,
        certification: null,
        ...INSPECTION,
      },
    ]);
    engine.chooseCertificate.mockResolvedValueOnce(null).mockResolvedValueOnce(SUMMARY);
    engine.saveSignedCopy
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("The signed copy did not verify. Nothing was saved."));
    render(
      <CertificateSignature
        controller={controller() as never}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );

    expect(await screen.findByText(/CN=Earlier Signer/)).toBeTruthy();
    expect(screen.getByText("Changed after signing")).toBeTruthy();
    expect(screen.getByText(/Signature2/)).toBeTruthy();
    expect(screen.getByText("Certifying signature, permission level 2.")).toBeTruthy();

    fireEvent.click(screen.getByText("Choose Certificate…"));
    // The button reads "Opening…" until the cancelled picker resolves.
    fireEvent.click(await screen.findByText("Choose Certificate…"));
    await vi.waitFor(() => expect(engine.chooseCertificate).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Signing as/)).toBeTruthy();
    const select = screen.getByLabelText("Certification") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(screen.getByText(/already signed, so a new signature cannot certify it/)).toBeTruthy();

    fireEvent.click(screen.getByText("Save Signed Copy…"));
    await vi.waitFor(() => expect(useWorkspace.getState().status).toBe("Save cancelled"));
    expect(engine.saveSignedCopy.mock.calls[0][3].certification).toBe("none");
    fireEvent.click(screen.getByText("Save Signed Copy…"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The signed copy did not verify. Nothing was saved.",
    );

    fireEvent.click(screen.getByText("Use Another Certificate"));
    expect(screen.getByText("Choose Certificate…")).toBeTruthy();
    expect(engine.forgetCertificate).toHaveBeenCalled();
  });

  it("explains when the signatures in the file cannot be checked", async () => {
    seed();
    engine.verifySignatures.mockRejectedValue(
      new Error("Signatures in password-protected PDFs cannot be checked yet."),
    );
    engine.chooseCertificate.mockRejectedValue(
      new Error("The certificate file could not be opened."),
    );
    render(
      <CertificateSignature
        controller={controller() as never}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot be checked yet/);
    expect(screen.queryByText("Checking signatures…")).toBeNull();
    fireEvent.click(screen.getByText("Choose Certificate…"));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "The certificate file could not be opened.",
      ),
    );
  });

  it("shows the chain and later changes, trusts a signer and opens the signed version", async () => {
    seed();
    const earlier = {
      field: "Signature1",
      signer: "CN=Earlier Signer",
      issuer: "CN=Synthetic Root",
      signedAt: "D:20260914000000Z",
      reason: null,
      subFilter: "ETSI.CAdES.detached",
      status: "valid",
      message:
        "The signed revision is unchanged, but the document was changed after this signature.",
      coversWholeDocument: false,
      certification: 2,
      certificates: [LEAF, ROOT],
      trust: "notTrusted",
      trustMessage: "No certificate in the signer's chain is one you chose to trust.",
      revisionLength: 900,
      changes: [{ kind: "comments", description: "Page 1: Text comment added" }],
      changesPermitted: false,
    };
    engine.verifySignatures
      .mockResolvedValueOnce([earlier])
      .mockResolvedValueOnce([
        { ...earlier, trust: "trusted", certificates: [LEAF, { ...ROOT, trusted: true }] },
      ]);
    engine.trustSignatureCertificate.mockResolvedValue([{ ...ROOT, trusted: true }]);
    engine.untrustCertificate.mockResolvedValue([]);
    engine.signedRevision.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(
      <CertificateSignature controller={controller() as never} onClose={onClose} onOpen={onOpen} />,
    );

    expect(await screen.findByText(/Signer not trusted/)).toBeTruthy();
    expect(screen.getByText("Page 1: Text comment added")).toBeTruthy();
    expect(
      screen.getByText("The document's certification does not allow these changes."),
    ).toBeTruthy();
    expect(screen.getByText("Trusted certificates (0)")).toBeTruthy();
    expect(screen.getByText("CC:DD")).toBeTruthy();

    fireEvent.click(screen.getByText("Trust This Issuer"));
    await vi.waitFor(() =>
      expect(engine.trustSignatureCertificate).toHaveBeenCalledWith("doc", "CC:DD"),
    );
    // Trust is part of the result, so the signatures are checked again.
    expect(await screen.findByText(/Signer trusted/)).toBeTruthy();
    expect(engine.verifySignatures).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Trusted certificates (1)")).toBeTruthy();

    fireEvent.click(screen.getByText("Stop Trusting"));
    await vi.waitFor(() => expect(engine.untrustCertificate).toHaveBeenCalledWith("CC:DD"));
    expect(await screen.findByText("Trusted certificates (0)")).toBeTruthy();

    fireEvent.click(screen.getByText("Open Signed Version"));
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalled());
    expect(engine.signedRevision).toHaveBeenCalledWith("doc", "Signature1");
    const file = onOpen.mock.calls[0][0] as File;
    expect(file.name).toBe("synthetic (signed version, Signature1).pdf");
    expect(file.size).toBe(4);
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a visible appearance on the chosen page and corner", async () => {
    seed();
    engine.verifySignatures.mockResolvedValue([]);
    engine.chooseCertificate.mockResolvedValue(SUMMARY);
    engine.saveSignedCopy.mockResolvedValue({ name: "synthetic-signed.pdf", size: 900 });
    render(
      <CertificateSignature
        controller={controller() as never}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );
    fireEvent.click(await screen.findByText("Choose Certificate…"));
    fireEvent.click(await screen.findByLabelText("Show the signature on a page"));
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Corner"), { target: { value: "topLeft" } });
    fireEvent.click(screen.getByText("Save Signed Copy…"));
    await vi.waitFor(() => expect(engine.saveSignedCopy).toHaveBeenCalled());
    // The page is kept within the document.
    expect(engine.saveSignedCopy.mock.calls[0][3].appearance).toEqual({
      page: 3,
      corner: "topLeft",
    });
  });
});
