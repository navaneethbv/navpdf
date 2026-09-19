// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToolPanel } from "../../src/features/tools/ToolPanel";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({ quickRailVisible: true });
});

describe("ToolPanel", () => {
  it("lists every tool in All mode and filters by search", () => {
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 10 },
      info: {
        pages: 3,
        encrypted: false,
        title: "",
        author: "",
        version: "1.7",
      },
    });
    render(<ToolPanel mode="all" onClose={() => {}} />);
    expect(screen.getByText(/tools$/)).toBeTruthy();
    expect(screen.getByText("Organize Pages")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search tools"), {
      target: { value: "bates" },
    });
    expect(screen.getByText("Bates Numbering")).toBeTruthy();
    expect(screen.queryByText("Organize Pages")).toBeNull();
  });

  it("expands the reference tool list and opens the requested Office format", () => {
    useWorkspace.getState().set({ document: { id: "d", name: "d.pdf", size: 10 } });
    render(<ToolPanel mode="all" onClose={() => {}} />);
    expect(screen.queryByText("PowerPoint (.pptx)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    fireEvent.click(screen.getByRole("button", { name: "PowerPoint (.pptx)" }));
    expect(useWorkspace.getState().activeModal).toBe("office-pptx");
    fireEvent.click(screen.getByRole("button", { name: "View less" }));
    expect(screen.queryByText("PowerPoint (.pptx)")).toBeNull();
    expect(screen.queryByText(/assistant|Find and Cite/i)).toBeNull();
  });

  it("disables document tools when no document is open", () => {
    render(<ToolPanel mode="all" onClose={() => {}} />);
    expect(
      (screen.getByText("Organize Pages").closest("button") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("scopes Edit, Convert, E-Sign, and Create modes", () => {
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 10 },
    });
    const { unmount } = render(<ToolPanel mode="edit" onClose={() => {}} />);
    expect(screen.getByText("Add Text")).toBeTruthy();
    expect(screen.queryByText("Microsoft Word")).toBeNull();
    unmount();
    render(<ToolPanel mode="convert" onClose={() => {}} />);
    expect(screen.queryByText("Add Text")).toBeNull();
    expect(screen.getByText(/Excel Workbook/)).toBeTruthy();
  });

  it("runs the tool action and closes the panel", () => {
    const onClose = vi.fn();
    useWorkspace.getState().set({
      document: { id: "d", name: "d.pdf", size: 10 },
    });
    render(<ToolPanel mode="esign" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Fill & Sign" }));
    expect(useWorkspace.getState().activeModal).toBe("fill-sign");
    expect(onClose).toHaveBeenCalled();
  });
});
