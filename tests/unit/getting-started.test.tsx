// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GettingStarted } from "../../src/features/help/GettingStarted";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";
import { savePreferences } from "../../src/services/native";
vi.mock("../../src/services/native", () => ({ savePreferences: vi.fn(async () => {}) }));
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    busy: false,
    settingsOpen: false,
    local: { preferences: { ...defaultPreferences }, recents: [], recoveries: [] },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(cleanup);
it("waits for preferences and walks through the first-launch tour only once", async () => {
  const { rerender, unmount } = render(<GettingStarted ready={false} />);
  expect(screen.queryByText("Welcome to NavPDF")).toBeNull();
  rerender(<GettingStarted ready />);
  expect(screen.getByText("Step 1 of 5")).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" })),
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Step 2 of 5")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("Step 1 of 5")).toBeTruthy();
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Get started" })));
  expect(savePreferences).toHaveBeenCalledWith(
    expect.objectContaining({ tourCompleted: true, showStartupTips: true }),
  );
  expect(screen.queryByText("A tip for your workspace")).toBeNull();
  unmount();
  render(<GettingStarted ready />);
  expect(screen.queryByText("Welcome to NavPDF")).toBeNull();
  expect(screen.getByText("A tip for your workspace")).toBeTruthy();
});
it("saves tip opt-out on dismissal and keeps manual help available", async () => {
  const state = useWorkspace.getState();
  state.set({
    local: { ...state.local, preferences: { ...defaultPreferences, tourCompleted: true } },
  });
  const { unmount } = render(<GettingStarted ready />);
  const before = screen.getByText(/Tip \d of/).textContent;
  fireEvent.click(screen.getByRole("button", { name: "Next tip" }));
  expect(screen.getByText(/Tip \d of/).textContent).not.toBe(before);
  fireEvent.click(screen.getByRole("checkbox", { name: "Don’t show tips again" }));
  expect(savePreferences).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss" })));
  expect(useWorkspace.getState().local.preferences.showStartupTips).toBe(false);
  unmount();
  render(<GettingStarted ready />);
  expect(screen.queryByText("A tip for your workspace")).toBeNull();
  act(() => useWorkspace.getState().set({ activeModal: "help" }));
  fireEvent.click(screen.getByRole("button", { name: "Take a tour" }));
  expect(screen.getByText("Step 1 of 5")).toBeTruthy();
});
it("retains a failed opt-out and blocks duplicate saves until the write finishes", async () => {
  const state = useWorkspace.getState();
  state.set({
    local: { ...state.local, preferences: { ...defaultPreferences, tourCompleted: true } },
  });
  let reject!: (reason: Error) => void;
  vi.mocked(savePreferences).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(<GettingStarted ready />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect((screen.getByRole("button", { name: "Close dialog" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => reject(new Error("disk full")));
  expect(screen.getByRole("alert").textContent).toContain("could not be saved");
  expect(useWorkspace.getState().local.preferences.showStartupTips).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss" })));
  expect(useWorkspace.getState().local.preferences.showStartupTips).toBe(false);
});
it("dismisses a tip without opting out and postpones startup during other dialogs", async () => {
  const state = useWorkspace.getState();
  state.set({
    settingsOpen: true,
    local: { ...state.local, preferences: { ...defaultPreferences, tourCompleted: true } },
  });
  render(<GettingStarted ready />);
  expect(screen.queryByText("A tip for your workspace")).toBeNull();
  act(() => useWorkspace.getState().set({ settingsOpen: false }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss" })));
  expect(savePreferences).not.toHaveBeenCalled();
  expect(useWorkspace.getState().local.preferences.showStartupTips).toBe(true);
});
