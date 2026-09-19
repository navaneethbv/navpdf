// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToolPanel } from "../../src/features/tools/ToolPanel";
import { useWorkspace } from "../../src/stores/workspace";
import type { ToolMode } from "../../src/types/document";

beforeEach(() => {
  useWorkspace.getState().reset();
  act(() => {
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
  });
});

describe("ToolPanel actions and modes", () => {
  it("renders every mode title", () => {
    const modes: { mode: ToolMode; title: string }[] = [
      { mode: "all", title: "All Tools" },
      { mode: "edit", title: "Edit PDF" },
      { mode: "convert", title: "Convert & Export" },
      { mode: "esign", title: "Fill & Sign" },
      { mode: "create", title: "Create PDF" },
    ];
    for (const { mode, title } of modes) {
      const { unmount } = render(<ToolPanel mode={mode} onClose={() => {}} />);
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
      unmount();
    }
  });

  it("shows an empty grid when search matches nothing", () => {
    render(<ToolPanel mode="all" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search tools"), {
      target: { value: "zzz-no-such-tool" },
    });
    expect(document.querySelectorAll(".tool-card")).toHaveLength(0);
  });

  it("activates every tool action", () => {
    const onClose = vi.fn();
    render(<ToolPanel mode="all" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    const cards = document.querySelectorAll(".tool-card");
    expect(cards.length).toBeGreaterThan(20);
    cards.forEach((card) => {
      fireEvent.click(card);
    });
    expect(onClose).not.toHaveBeenCalled();
    const state = useWorkspace.getState();
    expect(state.toolMode).toBeNull();
  });

  it("closes after an action in scoped modes", () => {
    const onClose = vi.fn();
    render(<ToolPanel mode="edit" onClose={onClose} />);
    fireEvent.click(screen.getByText("Organize Pages"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useWorkspace.getState().activeModal).toBe("page-workspace");
  });

  it("selects the snapshot tool and highlight tool", () => {
    render(<ToolPanel mode="all" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "View more" }));
    fireEvent.click(screen.getByText("Take Snapshot"));
    expect(useWorkspace.getState()).toMatchObject({
      activeSnapshot: true,
      tool: "snapshot",
    });
    fireEvent.click(screen.getByText("Highlight Text"));
    expect(useWorkspace.getState().tool).toBe("highlight");
  });
});
