// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NavigationRail, QuickToolRail, Toolbar } from "../../src/app/Toolbar";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  act(() => {
    useWorkspace.getState().set({
      busy: false,
      status: "Ready",
      error: "",
      quickRailVisible: true,
      document: { id: "d", name: "d.pdf", size: 100 },
      info: {
        pages: 5,
        encrypted: false,
        title: "",
        author: "",
        version: "1.7",
      },
      page: 2,
      canUndo: true,
      canRedo: true,
    });
  });
  vi.clearAllMocks();
});

function renderToolbar(controller?: Record<string, ReturnType<typeof vi.fn>>) {
  const callbacks = { open: vi.fn(), save: vi.fn(), home: vi.fn() };
  const mock = {
    readAloud: { supported: false },
    undo: vi.fn(),
    redo: vi.fn(),
    setTool: vi.fn(),
    zoom: vi.fn(),
    setLayout: vi.fn(),
    goTo: vi.fn(),
    ...controller,
  };
  render(
    <>
      <QuickToolRail controller={mock as never} />
      <NavigationRail controller={mock as never} />
      <Toolbar
        controller={mock as never}
        open={callbacks.open}
        save={callbacks.save}
        home={callbacks.home}
      />
    </>,
  );
  return { callbacks, mock };
}

describe("Toolbar remaining handlers", () => {
  it("switches every mode tab and opens settings", () => {
    renderToolbar();
    for (const tab of ["Convert", "E-Sign", "Create"]) {
      fireEvent.click(screen.getByText(tab));
    }
    expect(useWorkspace.getState().toolMode).toBe("esign");
    expect(useWorkspace.getState().activeModal).toBe("create-pdf");
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(useWorkspace.getState().settingsOpen).toBe(true);
  });

  it("drives undo, redo, select, hand, and quick tools", () => {
    const { mock } = renderToolbar();
    fireEvent.click(screen.getByLabelText("Undo"));
    fireEvent.click(screen.getByLabelText("Redo"));
    expect(mock.undo).toHaveBeenCalled();
    expect(mock.redo).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Select text"));
    fireEvent.click(screen.getByLabelText("Hand tool"));
    expect(mock.setTool).toHaveBeenCalledWith("hand");
    fireEvent.click(screen.getByLabelText("Ink & Draw"));
    expect(useWorkspace.getState().activeModal).toBe("annotations");
    fireEvent.click(screen.getByLabelText("Add Text"));
    expect(useWorkspace.getState().activeModal).toBe("add-text");
    fireEvent.click(screen.getByLabelText("Fill & Sign"));
    expect(useWorkspace.getState().activeModal).toBe("fill-sign");
    fireEvent.click(screen.getByLabelText("Snapshot region"));
    expect(useWorkspace.getState().activeSnapshot).toBe(true);
    fireEvent.click(screen.getByLabelText("Print Document"));
    expect(useWorkspace.getState().activeModal).toBe("print");
  });

  it("drives every zoom control and the layout picker", () => {
    const { mock } = renderToolbar();
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(mock.zoom).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Zoom percentage"), {
      target: { value: "200" },
    });
    expect(mock.zoom).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByLabelText("Fit width"));
    expect(mock.zoom).toHaveBeenCalledWith("page-width");
    fireEvent.change(screen.getByLabelText("Page layout"), {
      target: { value: "spread" },
    });
    expect(mock.setLayout).toHaveBeenCalledWith("spread");
  });
});

describe("Statusbar page input", () => {
  it("navigates on Enter and on blur", () => {
    const mock = { goTo: vi.fn(), readAloud: { supported: false } };
    render(<NavigationRail controller={mock as never} />);
    const input = screen.getByLabelText("Page number") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mock.goTo).toHaveBeenCalledWith(4);
    fireEvent.blur(input);
    expect(mock.goTo).toHaveBeenCalledTimes(2);
  });
});
