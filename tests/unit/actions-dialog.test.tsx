// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const runner = vi.hoisted(() => ({ runAction: vi.fn() }));
vi.mock("../../src/features/actions/run-action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/features/actions/run-action")>()),
  runAction: runner.runAction,
}));
const nativeMock = vi.hoisted(() => ({ savePreferences: vi.fn(async () => {}) }));
vi.mock("../../src/services/native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/native")>()),
  native: true,
  savePreferences: nativeMock.savePreferences,
}));
const download = vi.hoisted(() => ({ downloadBlob: vi.fn(async () => true) }));
vi.mock("../../src/utils/download", () => download);

import { ActionsDialog } from "../../src/features/actions/ActionsDialog";
import { useWorkspace } from "../../src/stores/workspace";

function controller() {
  return {
    pdf: { saveDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) },
    replaceWithBytes: vi.fn(async () => {}),
  };
}

const pdfFile = (name: string) =>
  new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  act(() => {
    useWorkspace.getState().reset();
    useWorkspace.getState().set({ document: { id: "doc", name: "report.pdf", size: 4 } });
  });
});

describe("guided actions dialog", () => {
  it("shows a built-in action's steps and runs it on the open document", async () => {
    runner.runAction.mockResolvedValue({
      bytes: new Uint8Array([1]),
      notes: ["Reduce file size: Already compact; left as it was."],
    });
    const view = controller();
    render(<ActionsDialog controller={view as never} onClose={() => {}} />);
    expect(screen.getByText("Remove hidden information")).toBeTruthy();
    expect(screen.getByText(/Converts to PDF\/A-2b/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "builtin-distribute" } });
    expect(screen.getByText("Flatten comments and form fields")).toBeTruthy();
    fireEvent.click(screen.getByText("Run on This Document"));
    await vi.waitFor(() => expect(view.replaceWithBytes).toHaveBeenCalled());
    expect(runner.runAction.mock.calls[0][1].id).toBe("builtin-distribute");
    expect(useWorkspace.getState().status).toBe(
      'Ran "Prepare for distribution". Reduce file size: Already compact; left as it was.',
    );
    expect((screen.getByText("Delete") as HTMLButtonElement).disabled).toBe(true);
  });

  it("copies a built-in action, edits its steps and saves it to preferences", async () => {
    render(<ActionsDialog controller={controller() as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Copy and Edit"));
    fireEvent.change(screen.getByLabelText("Action name"), { target: { value: "My archive" } });
    fireEvent.change(screen.getByLabelText("Add a step"), { target: { value: "watermark" } });
    fireEvent.click(screen.getByText("Add Step"));
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "FINAL" } });
    fireEvent.click(screen.getByLabelText("Move step 3 earlier"));
    fireEvent.click(screen.getByLabelText("Remove step 1"));
    fireEvent.click(screen.getByText("Save Action"));
    await vi.waitFor(() => expect(nativeMock.savePreferences).toHaveBeenCalled());
    const [saved] = useWorkspace.getState().local.preferences.actions;
    expect(saved.name).toBe("My archive");
    expect(saved.steps).toEqual([
      { kind: "watermark", text: "FINAL", opacity: 0.25, fontSize: 60 },
      { kind: "pdfa", level: "2b" },
    ]);
    expect(saved.id).not.toBe("builtin-archive");
    expect(await screen.findByText(/Draws "FINAL"/)).toBeTruthy();
    fireEvent.click(screen.getByText("Delete"));
    await vi.waitFor(() => expect(useWorkspace.getState().local.preferences.actions).toEqual([]));
  });

  it("runs on several files, saves the results as a ZIP and lists failures", async () => {
    runner.runAction
      .mockResolvedValueOnce({ bytes: new Uint8Array([2]), notes: [] })
      .mockRejectedValueOnce(new Error("Step 2, Convert to PDF/A: Every font must be embedded."));
    render(<ActionsDialog controller={null} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("PDF files"), {
      target: { files: [pdfFile("one.pdf"), pdfFile("two.pdf")] },
    });
    expect(screen.getByText("2 file(s) selected.")).toBeTruthy();
    fireEvent.click(screen.getByText("Run & Save ZIP"));
    expect(await screen.findByText(/two.pdf: Step 2, Convert to PDF\/A/)).toBeTruthy();
    expect(screen.getByText("one.pdf: Done")).toBeTruthy();
    await vi.waitFor(() =>
      expect(useWorkspace.getState().status).toBe("Saved 1 processed PDF(s) in a ZIP archive"),
    );
    expect(download.downloadBlob.mock.calls[0][1]).toMatch(/^Prepare for archiving-\d+\.zip$/);
  });

  it("reports a refused save of the action", async () => {
    nativeMock.savePreferences.mockRejectedValueOnce(new Error("An action needs 1 to 20 steps."));
    render(<ActionsDialog controller={controller() as never} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Copy and Edit"));
    fireEvent.click(screen.getByText("Save Action"));
    expect((await screen.findByRole("alert")).textContent).toBe("An action needs 1 to 20 steps.");
  });
});
