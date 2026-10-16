// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommandPalette } from "../../src/features/tools/CommandPalette";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => useWorkspace.getState().reset());
it("searches descriptions, opens the chosen tool and focuses the search", async () => {
  useWorkspace.getState().set({ document: { id: "d", name: "test.pdf", size: 1 } });
  const close = vi.fn();
  render(<CommandPalette onClose={close} />);
  const search = screen.getByRole("searchbox");
  await waitFor(() => expect(document.activeElement).toBe(search));
  fireEvent.change(search, { target: { value: "poster" } });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(close).toHaveBeenCalledOnce();
  expect(useWorkspace.getState().activeModal).toBe("impose");
});
it("keeps document-only tools disabled and reports no matches", () => {
  const close = vi.fn();
  render(<CommandPalette onClose={close} />);
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "poster" } });
  expect(screen.getByRole("button", { name: /Pages per Sheet/ })).toHaveProperty("disabled", true);
  fireEvent.keyDown(search, { key: "Enter" });
  expect(close).not.toHaveBeenCalled();
  fireEvent.change(search, { target: { value: "no-such-tool" } });
  expect(screen.getByText("No tools match your search.")).toBeTruthy();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});
it("supports arrow navigation and skips disabled tools", () => {
  render(<CommandPalette onClose={() => {}} />);
  const search = screen.getByRole("searchbox");
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(document.activeElement?.textContent).toContain("Combine Files");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: "ArrowDown" });
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement?.textContent).toContain("Import / Convert");
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement?.textContent).toContain("Combine Files");
});
