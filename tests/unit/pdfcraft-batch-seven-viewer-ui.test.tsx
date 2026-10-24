// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../../src/features/settings/Settings";
import { AboutDialog } from "../../src/features/help/AboutDialog";
import { MarqueeZoomTool } from "../../src/features/viewer/MarqueeZoomTool";
import { savePreferences } from "../../src/services/native";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";
import type { ViewerController } from "../../src/features/viewer/controller";

vi.mock("../../src/services/native", () => ({
  native: true,
  savePreferences: vi.fn(async () => {}),
  localState: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "9.8.7") }));
vi.mock("pdfjs-dist", () => ({ version: "6.4.299" }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: false }));
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    settingsOpen: true,
    local: { preferences: { ...defaultPreferences }, recents: [], recoveries: [] },
  });
});

describe("page colour settings", () => {
  it("offers custom colours, warns about low contrast and saves the choice", async () => {
    render(<Settings />);
    expect(screen.queryByLabelText("Text colour")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Page colours/), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Text colour"), { target: { value: "#777777" } });
    fireEvent.change(screen.getByLabelText("Page colour"), { target: { value: "#888888" } });
    expect(screen.getByRole("status").textContent).toMatch(/contrast ratio of 1\.\d:1/);
    fireEvent.change(screen.getByLabelText("Page colour"), { target: { value: "#000000" } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByText("Save settings"));
    await waitFor(() => expect(savePreferences).toHaveBeenCalled());
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        pageColors: "custom",
        pageForeground: "#777777",
        pageBackground: "#000000",
      }),
    );
    expect(useWorkspace.getState().local.preferences.pageColors).toBe("custom");
  });
});

describe("About NavPDF", () => {
  it("shows the application and PDF.js versions", async () => {
    const close = vi.fn();
    render(<AboutDialog onClose={close} />);
    expect(await screen.findByText("Version 9.8.7")).toBeTruthy();
    expect(screen.getByText(/PDF\.js 6\.4\.299/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalled();
  });
});

describe("marquee zoom tool", () => {
  function setup() {
    const page = document.createElement("div");
    page.className = "page";
    page.dataset.pageNumber = "3";
    document.body.append(page);
    document.elementsFromPoint = () => [page];
    const controller = {
      pdf: {},
      zoomToArea: vi.fn(),
      container: { scrollBy: vi.fn() },
    } as unknown as ViewerController;
    useWorkspace.getState().set({ tool: "marquee" });
    render(<MarqueeZoomTool controller={controller} />);
    return { controller, overlay: screen.getByRole("application") };
  }

  it("zooms to a dragged area on the page under the pointer", () => {
    const { controller, overlay } = setup();
    fireEvent.pointerDown(overlay, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: 60, clientY: 90 });
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: 110, clientY: 120, altKey: true });
    expect(controller.zoomToArea).toHaveBeenCalledWith(
      3,
      { x: 10, y: 20 },
      { x: 110, y: 120 },
      true,
    );
  });

  it("scrolls the pages under it and returns to Select on Escape", () => {
    const { controller, overlay } = setup();
    fireEvent.wheel(overlay, { deltaX: 0, deltaY: 40 });
    expect(controller.container.scrollBy).toHaveBeenCalledWith(0, 40);
    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(useWorkspace.getState().tool).toBe("select");
  });
});
