// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../src/services/native", async (original) => ({
  ...(await original<object>()),
  savePreferences: vi.fn(async () => {}),
}));

import { movePinned, togglePinned, MAX_PINNED_TOOLS } from "../../src/features/tools/pinned-tools";
import { ToolPanel } from "../../src/features/tools/ToolPanel";
import { PinnedTools } from "../../src/app/PinnedTools";
import { useWorkspace } from "../../src/stores/workspace";
import { savePreferences } from "../../src/services/native";

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({ document: { id: "d", name: "a.pdf", size: 1 } });
  vi.clearAllMocks();
});

describe("Pinned tools", () => {
  it("adds, removes and reorders pins with a limit", () => {
    expect(togglePinned(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePinned(["a", "b"], "a")).toEqual(["b"]);
    expect(movePinned(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(movePinned(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    const full = Array.from({ length: MAX_PINNED_TOOLS }, (_, i) => `t${i}`);
    expect(() => togglePinned(full, "more")).toThrow(/at most/);
  });

  it("pins a tool from All Tools, lists it first and shows it on the toolbar", async () => {
    render(<ToolPanel mode="all" onClose={() => {}} />);
    fireEvent.click(screen.getByText("View more"));
    fireEvent.click(screen.getByLabelText("Pin Present to the toolbar"));
    await waitFor(() =>
      expect(useWorkspace.getState().local.preferences.pinnedTools).toEqual(["present"]),
    );
    expect(savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedTools: ["present"] }),
    );
    expect(screen.getAllByText(/./, { selector: ".tool-card-label" })[0].textContent).toBe(
      "Present",
    );
    const { getByRole } = render(<PinnedTools />, { container: document.createElement("div") });
    fireEvent.click(getByRole("button", { name: "Present" }));
    expect(useWorkspace.getState().activeModal).toBe("present");
  });
});
