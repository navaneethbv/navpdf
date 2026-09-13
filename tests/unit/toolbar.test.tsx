// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Statusbar, Toolbar } from "../../src/app/Toolbar";
import { useWorkspace } from "../../src/stores/workspace";

const callbacks = { open: vi.fn(), save: vi.fn(), home: vi.fn() };

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({ quickRailVisible: true });
  vi.clearAllMocks();
});

function withDocument() {
  useWorkspace.getState().set({
    document: { id: "d", name: "report.pdf", size: 2048 },
    info: {
      pages: 5,
      encrypted: false,
      title: "Report",
      author: "Nav",
      version: "1.7",
    },
    page: 2,
  });
}

describe("Toolbar", () => {
  it("shows the workspace title and opens documents", () => {
    render(
      <Toolbar controller={null} open={callbacks.open} save={callbacks.save} home={callbacks.home} />,
    );
    expect(screen.getByText("Local workspace")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open PDF"));
    expect(callbacks.open).toHaveBeenCalled();
  });

  it("disables save and tools without a document", () => {
    render(
      <Toolbar controller={null} open={callbacks.open} save={callbacks.save} home={callbacks.home} />,
    );
    expect(
      (screen.getByLabelText("Save PDF") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Highlight text") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("toggles tool modes and fires save/home actions", () => {
    withDocument();
    render(
      <Toolbar controller={null} open={callbacks.open} save={callbacks.save} home={callbacks.home} />,
    );
    expect(screen.getByText("report.pdf")).toBeTruthy();
    fireEvent.click(screen.getByText("Edit"));
    expect(useWorkspace.getState().toolMode).toBe("edit");
    fireEvent.click(screen.getByText("Edit"));
    expect(useWorkspace.getState().toolMode).toBeNull();
    fireEvent.click(screen.getByLabelText("Save PDF"));
    expect(callbacks.save).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByLabelText("Save PDF As"));
    expect(callbacks.save).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText("Close document"));
    expect(callbacks.home).toHaveBeenCalled();
  });

  it("drives controller zoom, layout, and sidebar actions", () => {
    withDocument();
    const controller = {
      undo: vi.fn(),
      setTool: vi.fn(),
      zoom: vi.fn(),
      setLayout: vi.fn(),
      goTo: vi.fn(),
    };
    render(
      <Toolbar
        controller={controller as never}
        open={callbacks.open}
        save={callbacks.save}
        home={callbacks.home}
      />,
    );
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(controller.zoom).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Fit page"));
    expect(controller.zoom).toHaveBeenCalledWith("page-fit");
    fireEvent.change(screen.getByLabelText("Page layout"), {
      target: { value: "single" },
    });
    expect(controller.setLayout).toHaveBeenCalledWith("single");
    fireEvent.click(screen.getByLabelText("Highlight text"));
    expect(controller.setTool).toHaveBeenCalledWith("highlight");
    fireEvent.click(screen.getByLabelText("Organize Pages"));
    expect(useWorkspace.getState().activeModal).toBe("page-workspace");
    fireEvent.click(screen.getByLabelText("Find in PDF"));
    expect(useWorkspace.getState().sidebar).toBe("search");
  });

  it("hides the quick rail on request", () => {
    withDocument();
    render(
      <Toolbar controller={null} open={callbacks.open} save={callbacks.save} home={callbacks.home} />,
    );
    fireEvent.click(screen.getByLabelText("Toggle Quick Tool Rail"));
    expect(useWorkspace.getState().quickRailVisible).toBe(false);
  });
});

describe("Statusbar", () => {
  it("reports status, dirty state, and page navigation", () => {
    withDocument();
    useWorkspace.getState().set({ dirty: true });
    const controller = { goTo: vi.fn() };
    render(<Statusbar controller={controller as never} />);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByText("of 5")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(controller.goTo).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByLabelText("Previous page"));
    expect(controller.goTo).toHaveBeenCalledWith(1);
  });

  it("shows an idle status without a document", () => {
    render(<Statusbar controller={null} />);
    expect(screen.getByText("Ready")).toBeTruthy();
  });
});
