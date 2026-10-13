// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GettingStarted } from "../../src/features/help/GettingStarted";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  const local = useWorkspace.getState().local;
  useWorkspace.getState().set({
    activeModal: "help",
    local: {
      ...local,
      preferences: { ...local.preferences, tourCompleted: true, showStartupTips: false },
    },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

it("opens a searchable shortcut reference from Help even without a document", () => {
  render(<GettingStarted ready />);
  fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
  expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a shortcut" }), {
    target: { value: "Save As" },
  });
  expect(screen.getByText("Save As")).toBeTruthy();
  expect(screen.queryByText("Fit page")).toBeNull();
  expect(screen.getByText("Cmd/Ctrl + Shift + S")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a shortcut" }), {
    target: { value: "xyz missing" },
  });
  expect(screen.getByText("No shortcuts match your search.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
