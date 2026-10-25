// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Toolbar } from "../../src/app/Toolbar";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
});

it("lists open documents, switches tabs and closes the shown or a background one", () => {
  const home = vi.fn();
  const switchTab = vi.fn();
  const closeTab = vi.fn();
  useWorkspace.getState().set({
    tabs: [
      { id: "a", name: "a.pdf", dirty: true },
      { id: "b", name: "stale name.pdf", dirty: false },
    ],
    document: { id: "b", name: "b.pdf", size: 1 },
    dirty: true,
  });
  render(
    <Toolbar
      controller={null}
      open={vi.fn()}
      save={vi.fn()}
      home={home}
      switchTab={switchTab}
      closeTab={closeTab}
    />,
  );
  const list = screen.getByRole("list", { name: "Open documents" });
  const items = within(list).getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual(["a.pdf", "b.pdf"]);
  // The shown document's tab uses its live name and unsaved state.
  expect(items[1].className).toContain("is-open");
  expect(within(items[1]).getByTitle("Unsaved changes")).toBeTruthy();
  expect(screen.getByRole("button", { name: "b.pdf" }).getAttribute("aria-current")).toBe("page");
  fireEvent.click(screen.getByRole("button", { name: "a.pdf" }));
  expect(switchTab).toHaveBeenCalledWith("a");
  fireEvent.click(screen.getByRole("button", { name: "Close a.pdf" }));
  expect(closeTab).toHaveBeenCalledWith("a");
  fireEvent.click(screen.getByRole("button", { name: "Close document" }));
  expect(home).toHaveBeenCalled();
});

it("shows the application name with no document open", () => {
  render(<Toolbar controller={null} open={vi.fn()} save={vi.fn()} home={vi.fn()} />);
  expect(screen.queryByRole("list", { name: "Open documents" })).toBeNull();
  expect(screen.getByText("NavPDF")).toBeTruthy();
});
