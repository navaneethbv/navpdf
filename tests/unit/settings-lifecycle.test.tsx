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

it("switches previews without briefly restoring the saved theme", () => {
  useWorkspace.getState().set({
    local: {
      ...useWorkspace.getState().local,
      preferences: { ...defaultPreferences, theme: "dark" },
    },
  });
  render(<SettingsHost />);
  fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "light" } });
  const observer = new MutationObserver(() => {});
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
    attributeOldValue: true,
  });
  try {
    fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "system" } });
    const previousThemes = observer.takeRecords().map((record) => record.oldValue);
    expect(previousThemes).not.toContain("dark");
    expect(document.documentElement.dataset.theme).toBe("light");
  } finally {
    observer.disconnect();
  }
});

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

it("previews, cancels and persists independent Light and Dark palettes", async () => {
  vi.mocked(savePreferences).mockResolvedValue(undefined);
  render(<SettingsHost />);
  fireEvent.change(screen.getByLabelText("Light palette"), { target: { value: "amber" } });
  expect(document.documentElement.dataset.palette).toBe("amber");
  fireEvent.change(screen.getByLabelText("Dark palette"), { target: { value: "ocean" } });
  expect(document.documentElement.dataset.palette).toBe("amber");
  fireEvent.change(screen.getByLabelText(/Theme/), { target: { value: "dark" } });
  expect(document.documentElement.dataset.palette).toBe("ocean");
  fireEvent.click(screen.getByText("Cancel"));
  expect(document.documentElement.dataset.palette).toBe("default");
  act(() => useWorkspace.getState().set({ settingsOpen: true }));
  expect((screen.getByLabelText("Light palette") as HTMLSelectElement).value).toBe("default");
  fireEvent.change(screen.getByLabelText("Light palette"), { target: { value: "coral" } });
  fireEvent.change(screen.getByLabelText("Dark palette"), { target: { value: "violet" } });
  fireEvent.click(screen.getByText("Save settings"));
  await vi.waitFor(() => expect(useWorkspace.getState().settingsOpen).toBe(false));
  act(() => useWorkspace.getState().set({ settingsOpen: true }));
  expect((screen.getByLabelText("Light palette") as HTMLSelectElement).value).toBe("coral");
  expect((screen.getByLabelText("Dark palette") as HTMLSelectElement).value).toBe("violet");
});

it("previews, cancels, saves and resets custom colors independently", async () => {
  vi.mocked(savePreferences).mockResolvedValue(undefined);
  render(<SettingsHost />);
  fireEvent.click(screen.getByText("Custom background and accent colors"));
  fireEvent.click(screen.getByLabelText("Custom light background"));
  fireEvent.change(screen.getByLabelText("Light background color"), {
    target: { value: "#ffeeaa" },
  });
  expect(document.documentElement.style.getPropertyValue("--surface")).toBe("#ffeeaa");
  fireEvent.click(screen.getByText("Cancel"));
  expect(document.documentElement.style.getPropertyValue("--surface")).toBe("");
  act(() => useWorkspace.getState().set({ settingsOpen: true }));
  fireEvent.click(screen.getByText("Custom background and accent colors"));
  fireEvent.click(screen.getByLabelText("Custom light accent"));
  fireEvent.change(screen.getByLabelText("Light accent hex"), { target: { value: "#ff8800" } });
  fireEvent.click(screen.getByLabelText("Custom dark background"));
  fireEvent.change(screen.getByLabelText("Dark background color"), {
    target: { value: "#102030" },
  });
  fireEvent.click(screen.getByText("Save settings"));
  await vi.waitFor(() => expect(useWorkspace.getState().settingsOpen).toBe(false));
  act(() => useWorkspace.getState().set({ settingsOpen: true }));
  fireEvent.click(screen.getByText("Custom background and accent colors"));
  expect((screen.getByLabelText("Light accent color") as HTMLInputElement).value).toBe("#ff8800");
  expect((screen.getByLabelText("Dark background color") as HTMLInputElement).value).toBe(
    "#102030",
  );
  fireEvent.click(screen.getByText("Reset light colors"));
  expect((screen.getByLabelText("Light accent color") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Dark background color") as HTMLInputElement).value).toBe(
    "#102030",
  );
  fireEvent.click(screen.getByLabelText("Custom dark background"));
  expect((screen.getByLabelText("Dark background color") as HTMLInputElement).disabled).toBe(true);
});

it("allows incomplete hex edits while preventing invalid form submission", () => {
  render(<SettingsHost />);
  fireEvent.click(screen.getByText("Custom background and accent colors"));
  fireEvent.click(screen.getByLabelText("Custom light accent"));
  const hex = screen.getByLabelText("Light accent hex") as HTMLInputElement;
  fireEvent.change(hex, { target: { value: "" } });
  expect(hex.disabled).toBe(false);
  expect(hex.checkValidity()).toBe(false);
  fireEvent.change(hex, { target: { value: "#ff8800" } });
  expect(hex.checkValidity()).toBe(true);
  expect((screen.getByLabelText("Light accent color") as HTMLInputElement).value).toBe("#ff8800");
});
