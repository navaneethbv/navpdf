// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SearchPanel } from "../../src/features/search/SearchPanel";
import { useWorkspace } from "../../src/stores/workspace";
import { downloadBlob } from "../../src/utils/download";

vi.mock("../../src/utils/download", () => ({
  downloadBlob: vi.fn(async () => true),
  safeFileName: (name: string) => name,
}));

const result = { page: 3, index: 1, match: '=SUM("x")', context: "line one,\nline two" };
const controller = { search: vi.fn(), selectResult: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.getState().reset();
  useWorkspace.getState().set({
    document: { id: "a", name: "report.pdf", size: 10 },
    searchQuery: "=SUM",
    searchResultsKey: JSON.stringify(["=SUM", false, false]),
    results: [result],
    searchCount: 500,
  });
});

it("exports displayed matches with quoted text, inert formulas and honest totals", async () => {
  render(<SearchPanel controller={controller as never} />);
  fireEvent.click(screen.getByRole("button", { name: "Export displayed results" }));
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
  const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
  expect(name).toBe("report-search-results.csv");
  const text = await blob.text();
  expect(text).toContain("Total matches,Exported matches");
  expect(text).toContain("'=SUM,");
  expect(text).toContain('"\'=SUM(""x"")"');
  expect(text).toContain('"line one,\nline two"');
  expect(text).toContain(",500,1");
  await waitFor(() => expect(useWorkspace.getState().status).toContain("Exported 1 of 500"));
});

it("disables export while indexing or when there are no displayed matches", () => {
  useWorkspace.getState().set({ searchPending: true });
  render(<SearchPanel controller={controller as never} />);
  expect(
    (screen.getByRole("button", { name: "Export displayed results" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  act(() => useWorkspace.getState().set({ searchPending: false, results: [] }));
  expect(
    (screen.getByRole("button", { name: "Export displayed results" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("cannot label old results with a newly typed query during the debounce", () => {
  render(<SearchPanel controller={controller as never} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search document" }), {
    target: { value: "different" },
  });
  expect(
    (screen.getByRole("button", { name: "Export displayed results" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("keeps old results unexportable when an old completion clears pending during debounce", () => {
  render(<SearchPanel controller={controller as never} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search document" }), {
    target: { value: "new query" },
  });
  act(() => useWorkspace.getState().set({ searchPending: false, results: [result] }));
  expect(
    (screen.getByRole("button", { name: "Export displayed results" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("neutralizes spreadsheet formulas hidden behind leading whitespace", async () => {
  useWorkspace.getState().set({ results: [{ ...result, match: "  =1+1", context: "\t@SUM(A1)" }] });
  render(<SearchPanel controller={controller as never} />);
  fireEvent.click(screen.getByRole("button", { name: "Export displayed results" }));
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
  const csv = await vi.mocked(downloadBlob).mock.calls[0][0].text();
  expect(csv).toContain("'  =1+1");
  expect(csv).toContain("'\t@SUM(A1)");
});

it("keeps cancellation quiet and presents export errors for retry", async () => {
  vi.mocked(downloadBlob)
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("Disk full"));
  render(<SearchPanel controller={controller as never} />);
  fireEvent.click(screen.getByRole("button", { name: "Export displayed results" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Export displayed results" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(useWorkspace.getState().status).toBe("Ready");
  fireEvent.click(screen.getByRole("button", { name: "Export displayed results" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Disk full");
});

it("does not write success into a replacement document", async () => {
  let finish!: (saved: boolean) => void;
  vi.mocked(downloadBlob).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<SearchPanel controller={controller as never} />);
  fireEvent.click(screen.getByRole("button", { name: "Export displayed results" }));
  act(() => useWorkspace.getState().set({ document: { id: "b", name: "other.pdf", size: 10 } }));
  await act(async () => finish(true));
  expect(useWorkspace.getState().status).toBe("Ready");
});
