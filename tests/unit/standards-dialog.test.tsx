// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const engine = vi.hoisted(() => ({
  readStandards: vi.fn(),
  validatePdfa: vi.fn(),
  editStandards: vi.fn(),
}));
vi.mock("../../src/services/engine", () => engine);

import { StandardsDialog } from "../../src/features/document/StandardsDialog";
import { useWorkspace } from "../../src/stores/workspace";

const NONE = { pdfa: null, pdfua: null, pdfx: null, outputIntents: [] };
const CONVERTED = {
  pdfa: "PDF/A-3b",
  pdfua: null,
  pdfx: null,
  outputIntents: [
    {
      subtype: "GTS_PDFA1",
      condition: "sRGB IEC61966-2.1",
      info: "",
      hasProfile: true,
      components: 3,
    },
  ],
};

function controller() {
  return {
    pdf: { saveDocument: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) },
    replaceWithBytes: vi.fn(async () => {}),
  };
}

const finding = (rule: string, fixable: boolean, examples: string[] = []) => ({
  rule,
  message: `${rule} message`,
  count: Math.max(1, examples.length),
  examples,
  fixable,
});

beforeEach(() => {
  vi.clearAllMocks();
  act(() => useWorkspace.getState().reset());
});

describe("PDF/A and standards dialog", () => {
  it("checks a level, converts when every problem is fixable and lists the new declaration", async () => {
    engine.readStandards.mockResolvedValueOnce(NONE).mockResolvedValueOnce(CONVERTED);
    engine.validatePdfa.mockResolvedValue({
      level: "PDF/A-3b",
      declared: null,
      passed: false,
      findings: [finding("metadata", true), finding("actions", true, ["JavaScript"])],
      notChecked: ["Glyph widths"],
    });
    engine.editStandards.mockResolvedValue({
      bytes: new Uint8Array([1]),
      report: { message: "Converted to PDF/A-3b." },
    });
    const view = controller();
    render(<StandardsDialog controller={view as never} onClose={() => {}} />);
    expect(await screen.findByText("PDF/A: not declared")).toBeTruthy();
    expect(screen.getByText("Output intents: none")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Check against"), { target: { value: "3b" } });
    fireEvent.click(screen.getByText("Check"));
    expect(await screen.findByText("2 problem(s) found for PDF/A-3b.")).toBeTruthy();
    expect(engine.validatePdfa).toHaveBeenCalledWith(expect.any(Uint8Array), "3b");
    expect(screen.getByText("1 found, such as JavaScript.")).toBeTruthy();
    fireEvent.click(screen.getByText("Convert to PDF/A-3b"));
    await vi.waitFor(() =>
      expect(engine.editStandards).toHaveBeenCalledWith(expect.any(Uint8Array), {
        action: "convert",
        level: "3b",
      }),
    );
    expect(await screen.findByText("PDF/A: PDF/A-3b")).toBeTruthy();
    expect(screen.getByText(/sRGB IEC61966-2.1 \(GTS_PDFA1, RGB\)/)).toBeTruthy();
    expect(view.replaceWithBytes).toHaveBeenCalled();
    expect(useWorkspace.getState().status).toBe("Converted to PDF/A-3b.");
    expect((screen.getByText("Add sRGB Output Intent") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not offer conversion when a problem cannot be fixed", async () => {
    engine.readStandards.mockResolvedValue(NONE);
    engine.validatePdfa.mockResolvedValue({
      level: "PDF/A-2b",
      declared: null,
      passed: false,
      findings: [finding("fonts-embedded", false, ["Helvetica"])],
      notChecked: [],
    });
    render(<StandardsDialog controller={controller() as never} onClose={() => {}} />);
    fireEvent.click(await screen.findByText("Check"));
    expect(await screen.findByText(/cannot be fixed by NavPDF/)).toBeTruthy();
    const convert = screen.getByText("Convert to PDF/A-2b").closest("button") as HTMLButtonElement;
    expect(convert.disabled).toBe(true);
  });

  it("adds an output intent, removes identification and reports a passing check", async () => {
    engine.readStandards.mockResolvedValue({ ...CONVERTED, pdfua: "PDF/UA-1", outputIntents: [] });
    engine.editStandards
      .mockResolvedValueOnce({
        bytes: new Uint8Array([1]),
        report: { message: "Added an sRGB output intent" },
      })
      .mockRejectedValueOnce(new Error("The document declares no standards to remove."));
    engine.validatePdfa.mockResolvedValue({
      level: "PDF/A-2b",
      declared: "PDF/A-2b",
      passed: true,
      findings: [],
      notChecked: [],
    });
    render(<StandardsDialog controller={controller() as never} onClose={() => {}} />);
    fireEvent.click(await screen.findByText("Add sRGB Output Intent"));
    await vi.waitFor(() =>
      expect(engine.editStandards).toHaveBeenCalledWith(expect.any(Uint8Array), {
        action: "addOutputIntent",
      }),
    );
    fireEvent.click(await screen.findByText("Remove Standards Identification"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no standards to remove/);
    fireEvent.click(screen.getByText("Check"));
    expect(await screen.findByText(/No problems found for PDF\/A-2b/)).toBeTruthy();
  });
});
