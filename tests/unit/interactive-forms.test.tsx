// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormManager } from "../../src/features/forms/FormManager";
import { FillAndSign } from "../../src/features/signatures/FillAndSign";
import { useWorkspace } from "../../src/stores/workspace";
import * as docCommands from "../../src/services/document-commands";
import * as sigStore from "../../src/services/signature-store";

beforeEach(() => {
  useWorkspace.getState().reset();
  localStorage.clear();
  vi.restoreAllMocks();
});

const mockPdf = {
  saveDocument: vi.fn(async () => new Uint8Array([1, 2, 3])),
};

const controller = {
  pdf: mockPdf,
  replaceWithBytes: vi.fn(async () => {}),
};

describe("FormManager", () => {
  it("renders all supported field types and switches between them", () => {
    render(<FormManager controller={controller as never} onClose={() => {}} />);
    expect(screen.getByText("Text Input", { exact: false })).toBeTruthy();
    expect(screen.getByText("Checkbox")).toBeTruthy();
    expect(screen.getByText("Radio")).toBeTruthy();
    expect(screen.getByText("Dropdown")).toBeTruthy();
    expect(screen.getByText("Button")).toBeTruthy();

    fireEvent.click(screen.getByText("Checkbox"));
    expect(screen.getByText("Field Name")).toBeTruthy();

    fireEvent.click(screen.getByText("Radio"));
    expect(screen.getByText("Radio Group Name")).toBeTruthy();

    fireEvent.click(screen.getByText("Dropdown"));
    expect(screen.getByText("Dropdown Options")).toBeTruthy();
  });

  it("adds a text form field and calls controller.replaceWithBytes", async () => {
    const addFieldSpy = vi
      .spyOn(docCommands, "addFormField")
      .mockResolvedValue(new Uint8Array([9, 9, 9]));
    const onClose = vi.fn();

    render(<FormManager controller={controller as never} onClose={onClose} />);

    const nameInput = screen.getByPlaceholderText(/FirstName/i);
    fireEvent.change(nameInput, { target: { value: "CustomerName" } });

    const defaultValueInput = screen.getByPlaceholderText(/Optional default value/i);
    fireEvent.change(defaultValueInput, { target: { value: "John Doe" } });

    const submitBtn = screen.getByText("Add Field");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(addFieldSpy).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.objectContaining({
          type: "text",
          name: "CustomerName",
          defaultValue: "John Doe",
        }),
      );
      expect(controller.replaceWithBytes).toHaveBeenCalledWith(
        new Uint8Array([9, 9, 9]),
        'Form field "CustomerName" created',
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("handles field creation error without crashing", async () => {
    vi.spyOn(docCommands, "addFormField").mockRejectedValue(new Error("Duplicate field name"));

    render(<FormManager controller={controller as never} onClose={() => {}} />);

    const nameInput = screen.getByPlaceholderText(/FirstName/i);
    fireEvent.change(nameInput, { target: { value: "ExistingField" } });

    const submitBtn = screen.getByText("Add Field");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(useWorkspace.getState().error).toBe("Duplicate field name");
    });
  });
});

describe("FillAndSign safeguards and UI", () => {
  it("warns when document contains a digital signature", () => {
    useWorkspace.getState().set({ hasDigitalSignature: true });
    render(<FillAndSign controller={controller as never} onClose={() => {}} />);

    expect(screen.getByText(/This document contains an existing digital signature/i)).toBeTruthy();
  });

  it("renders non-cryptographic visual appearance notice", () => {
    render(<FillAndSign controller={controller as never} onClose={() => {}} />);

    expect(
      screen.getByText(/not cryptographic X.509 digital certificate signatures/i),
    ).toBeTruthy();
  });

  it("prompts for legacy plaintext signature migration when detected", async () => {
    vi.spyOn(sigStore, "hasLegacyPlaintextSignatures").mockReturnValue(true);
    const migrateSpy = vi
      .spyOn(sigStore, "migrateLegacySignatures")
      .mockResolvedValue({ count: 1, error: null });

    render(<FillAndSign controller={controller as never} onClose={() => {}} />);

    expect(screen.getByText(/Plaintext signatures detected/i)).toBeTruthy();

    const migrateBtn = screen.getByText("Migrate to Secure Storage");
    fireEvent.click(migrateBtn);

    await waitFor(() => {
      expect(migrateSpy).toHaveBeenCalledWith(true);
    });
  });

  it("creates a session-only signature when session toggle is checked", async () => {
    const stageSpy = vi.spyOn(sigStore, "persistOrStageSignature").mockResolvedValue({
      signature: {
        id: "sess-1",
        name: "Test Name",
        type: "signature",
        dataUrl: "data:image/png;base64,data",
        createdAt: 1000,
        storage: "session",
        sessionOnly: true,
      },
      error: null,
    });

    render(<FillAndSign controller={controller as never} onClose={() => {}} />);

    fireEvent.click(screen.getByText("Type"));

    const sessionCheckbox = screen.getByLabelText(/Session only/i);
    fireEvent.click(sessionCheckbox);

    const typeInput = screen.getByPlaceholderText(/Type your name/i);
    fireEvent.change(typeInput, { target: { value: "Test Name" } });

    const saveBtn = screen.getByText("Save Signature");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(stageSpy).toHaveBeenCalledWith(
        "Test Name",
        "signature",
        expect.stringContaining("data:image/png;base64"),
        true,
      );
    });
  });

  it("renders Unprotected badge for legacy unauthenticated signatures", async () => {
    vi.spyOn(sigStore, "fetchSignatureLibrary").mockResolvedValue({
      signatures: [
        {
          id: "unprot-1",
          name: "Plaintext Signature",
          type: "signature",
          dataUrl: "data:image/png;base64,data",
          createdAt: 1000,
          storage: "legacy",
        },
      ],
      error: null,
      warnings: ["One saved signature could not be read."],
    });

    render(<FillAndSign controller={controller as never} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("unprotected-badge")).toBeTruthy();
      expect(screen.getByText(/Unprotected/i)).toBeTruthy();
    });
    expect(screen.queryByText("Protected")).toBeNull();
    expect(screen.getByTestId("signature-warnings").textContent).toContain(
      "One saved signature could not be read.",
    );
  });
});
