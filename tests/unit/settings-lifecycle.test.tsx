// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Settings } from "../../src/features/settings/Settings";
import { savePreferences, localState } from "../../src/services/native";
import { useWorkspace } from "../../src/stores/workspace";
import { defaultPreferences } from "../../src/types/document";

vi.mock("../../src/services/native", () => ({
  savePreferences: vi.fn(),
  localState: vi.fn(),
}));

let media: EventTarget & { matches: boolean };
beforeEach(() => {
  vi.clearAllMocks();
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  useWorkspace.getState().set({
    settingsOpen: true,
    local: { preferences: { ...defaultPreferences }, recents: [], recoveries: [] },
  });
});

function SettingsHost() {
  return useWorkspace((s) => s.settingsOpen) ? <Settings /> : null;
}

it("tracks system appearance during a preview and restores the saved mode on Cancel", () => {
  render(<SettingsHost />);
  fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "dark" } });
  media.matches = true;
  act(() => media.dispatchEvent(new Event("change")));
  expect(document.documentElement.dataset.theme).toBe("dark");
  fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "system" } });
  media.matches = false;
  act(() => media.dispatchEvent(new Event("change")));
  expect(document.documentElement.dataset.theme).toBe("light");
  fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "dark" } });
  fireEvent.click(screen.getByText("Cancel"));
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("serializes saves, blocks dismissal, and retains current workspace metadata", async () => {
  let finish!: () => void;
  vi.mocked(savePreferences).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<SettingsHost />);
  fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "dark" } });
  const form = view.container.querySelector("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(savePreferences).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(/Theme/).closest("fieldset")?.disabled).toBe(true);
  fireEvent.click(screen.getByText("Cancel"));
  fireEvent.click(screen.getByLabelText("Close dialog"));
  fireEvent(view.container.querySelector("dialog")!, new Event("cancel", { cancelable: true }));
  expect(useWorkspace.getState().settingsOpen).toBe(true);
  const recoveries = [{ id: "recovery", name: "synthetic.pdf", pages: 1, savedAt: 1 }];
  act(() =>
    useWorkspace.getState().set({ local: { ...useWorkspace.getState().local, recoveries } }),
  );
  await act(async () => finish());
  expect(useWorkspace.getState().settingsOpen).toBe(false);
  expect(useWorkspace.getState().local.preferences.theme).toBe("dark");
  expect(useWorkspace.getState().local.recoveries).toEqual(recoveries);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localState).not.toHaveBeenCalled();
});

it("retains an editable draft after a failed save and allows retry", async () => {
  vi.mocked(savePreferences)
    .mockRejectedValueOnce(new Error("Storage unavailable"))
    .mockResolvedValueOnce(undefined);
  render(<SettingsHost />);
  fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "dark" } });
  fireEvent.click(screen.getByText("Save settings"));
  expect((await screen.findByRole("alert")).textContent).toContain("Storage unavailable");
  expect(useWorkspace.getState().local.preferences.theme).toBe("system");
  expect((screen.getByLabelText(/Theme/) as HTMLSelectElement).value).toBe("dark");
  fireEvent.click(screen.getByText("Save settings"));
  await vi.waitFor(() => expect(useWorkspace.getState().settingsOpen).toBe(false));
  expect(savePreferences).toHaveBeenCalledTimes(2);
});

it("clears visible recent history only after the privacy preference commits", async () => {
  vi.mocked(savePreferences)
    .mockRejectedValueOnce(new Error("Write failed"))
    .mockResolvedValueOnce(undefined);
  const recents = [{ id: "synthetic", name: "synthetic.pdf", openedAt: 1, page: 1 }];
  useWorkspace.getState().set({ local: { ...useWorkspace.getState().local, recents } });
  render(<SettingsHost />);
  fireEvent.click(screen.getByLabelText("Keep recent document history"));
  fireEvent.click(screen.getByText("Save settings"));
  await screen.findByRole("alert");
  expect(useWorkspace.getState().local.recents).toEqual(recents);
  expect(useWorkspace.getState().local.preferences.recentFiles).toBe(true);
  fireEvent.click(screen.getByText("Save settings"));
  await vi.waitFor(() => expect(useWorkspace.getState().settingsOpen).toBe(false));
  expect(useWorkspace.getState().local.recents).toEqual([]);
  expect(useWorkspace.getState().local.preferences.recentFiles).toBe(false);
});
