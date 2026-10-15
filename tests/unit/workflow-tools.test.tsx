// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToolPanel } from "../../src/features/tools/ToolPanel";
import { useWorkspace } from "../../src/stores/workspace";

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().set({ document: { id: "doc", name: "example.pdf", size: 100 } });
});

it.each([
  ["Form Data", "form-data"],
  ["Document Insights", "document-insights"],
])("opens %s from searchable tools", (name, modal) => {
  render(<ToolPanel mode="all" onClose={() => {}} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search tools" }), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("button", { name }));
  expect(useWorkspace.getState().activeModal).toBe(modal);
});

it("makes form data discoverable within Fill & Sign", () => {
  render(<ToolPanel mode="esign" onClose={() => {}} />);
  expect(screen.getByRole("button", { name: "Form Data" })).toBeTruthy();
});
