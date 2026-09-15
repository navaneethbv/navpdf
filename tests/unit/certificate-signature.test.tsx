// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  ENGINE_UNAVAILABLE: "desktop only",
  chooseCertificate: vi.fn(),
  forgetCertificate: vi.fn(async () => {}),
  saveSignedCopy: vi.fn(),
  verifySignatures: vi.fn(),
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
      <CertificateSignature controller={view as never} onClose={onClose} />,
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
      },
    ]);
    engine.chooseCertificate.mockResolvedValueOnce(null).mockResolvedValueOnce(SUMMARY);
    engine.saveSignedCopy
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("The signed copy did not verify. Nothing was saved."));
    render(<CertificateSignature controller={controller() as never} onClose={() => {}} />);

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
    render(<CertificateSignature controller={controller() as never} onClose={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/cannot be checked yet/);
    expect(screen.queryByText("Checking signatures…")).toBeNull();
    fireEvent.click(screen.getByText("Choose Certificate…"));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "The certificate file could not be opened.",
      ),
    );
  });
});
