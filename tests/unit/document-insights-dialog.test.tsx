// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentInsightsDialog } from "../../src/features/document/DocumentInsightsDialog";
import type { ViewerController } from "../../src/features/viewer/controller";
import { useWorkspace } from "../../src/stores/workspace";

function controller(texts: string[]) {
  return {
    pdf: {
      numPages: texts.length,
      async getPage(number: number) {
        return {
          rotate: number === 2 ? 90 : 0,
          getViewport: () => ({
            width: number === 2 ? 792 : 612,
            height: number === 2 ? 612 : 792,
          }),
          async getTextContent() {
            return { items: [{ str: texts[number - 1] }] };
          },
        };
      },
    },
  } as unknown as ViewerController;
}

beforeEach(() => useWorkspace.getState().reset());
afterEach(() => vi.restoreAllMocks());

describe("DocumentInsightsDialog", () => {
  it("inspects only a chosen range and presents honest text counts and page geometry", async () => {
    render(
      <DocumentInsightsDialog
        controller={controller(["excluded", "hello world", ""])}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Page range"), { target: { value: "2-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect pages" }));
    expect(await screen.findByText("2 words")).toBeTruthy();
    expect(screen.getByText("10 characters")).toBeTruthy();
    expect(screen.getByText("Textless pages: 3")).toBeTruthy();
    expect(screen.getByText(/does not prove a page is blank/i)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Page inventory" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Landscape")).toBeTruthy();
    expect(within(table).getByText("90°")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export CSV" })).toHaveProperty("disabled", false);
    fireEvent.change(screen.getByLabelText("Page range"), { target: { value: "oops" } });
    expect(screen.getByRole("alert").textContent).toMatch(/invalid page range/i);
    expect(screen.getByRole("button", { name: "Inspect pages" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("allows cancellation during reading without publishing the late result", async () => {
    const current = controller(["late"]);
    let complete: ((value: unknown) => void) | undefined;
    current.pdf!.getPage = (() =>
      new Promise((resolve) => {
        complete = resolve;
      })) as never;
    render(<DocumentInsightsDialog controller={current} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect pages" }));
    expect(screen.getByRole("progressbar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel inspection" }));
    expect(screen.getByText("Inspection cancelled.")).toBeTruthy();
    await act(async () => {
      complete!({ getTextContent: async () => ({ items: [{ str: "late" }] }) });
    });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect pages" })).toHaveProperty("disabled", false);
  });

  it("discards pending results after closing even when the caller leaves the component mounted", async () => {
    const current = controller(["late"]);
    let complete: ((value: unknown) => void) | undefined;
    current.pdf!.getPage = (() =>
      new Promise((resolve) => {
        complete = resolve;
      })) as never;
    const close = vi.fn();
    render(<DocumentInsightsDialog controller={current} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect pages" }));
    fireEvent.click(screen.getByRole("button", { name: "Close document insights" }));
    expect(close).toHaveBeenCalledOnce();
    await act(async () => {
      complete!({ getTextContent: async () => ({ items: [{ str: "late" }] }) });
    });
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("clears results and cancels stale jobs when the PDF changes on the same controller", async () => {
    const current = controller(["original"]);
    const { rerender } = render(<DocumentInsightsDialog controller={current} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect pages" }));
    await screen.findByRole("table");
    current.pdf = controller(["replacement words"]).pdf;
    rerender(<DocumentInsightsDialog controller={current} onClose={vi.fn()} />);
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inspect pages" }));
    expect(await screen.findByText("2 words")).toBeTruthy();
  });

  it("does not classify failed text extraction as a textless page", async () => {
    const current = controller(["ignored"]);
    current.pdf!.getPage = (async () => ({
      rotate: 0,
      getViewport: () => ({ width: 612, height: 792 }),
      getTextContent: async () => {
        throw new Error("reader failure");
      },
    })) as never;
    render(<DocumentInsightsDialog controller={current} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect pages" }));
    expect(await screen.findByText(/Unreadable pages: 1/)).toBeTruthy();
    expect(screen.getByText("Textless pages: None")).toBeTruthy();
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
  });

  it("requires an open document", async () => {
    render(<DocumentInsightsDialog controller={null} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Inspect pages" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    expect(screen.getByText("Open a PDF to inspect its pages.")).toBeTruthy();
  });

  it("discards a pending result when the controller source changes before a rerender", async () => {
    const current = controller(["late"]);
    let complete: ((value: unknown) => void) | undefined;
    current.pdf!.getPage = (() =>
      new Promise((resolve) => {
        complete = resolve;
      })) as never;
    render(<DocumentInsightsDialog controller={current} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect pages" }));
    current.pdf = controller(["replacement"]).pdf;
    await act(async () => {
      complete!({});
    });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Inspect pages" })).toHaveProperty("disabled", false);
  });

  it("exports a CSV with all pages while limiting the visible table to 100 rows", async () => {
    const saved: Blob[] = [];
    let filename = "";
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      saved.push(blob as Blob);
      return "blob:report";
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      filename = this.download;
    });
    render(
      <DocumentInsightsDialog
        controller={controller(Array.from({ length: 101 }, () => "private"))}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Inspect pages" }));
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    fireEvent.click(screen.getByRole("button", { name: "Next rows" }));
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText("Rows 101-101 of 101")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous rows" }));
    expect(within(table).getAllByRole("row")).toHaveLength(101);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText("CSV report exported.")).toBeTruthy();
    expect(filename).toBe("document-page-report.csv");
    const csv = await saved[0].text();
    expect(csv.trim().split("\r\n")).toHaveLength(102);
    expect(csv).toContain("101,1,7,Text present,612,792,0,Portrait");
    expect(csv).not.toContain("private");
  });
});
