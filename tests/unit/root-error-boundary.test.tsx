// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootErrorBoundary } from "../../src/components/RootErrorBoundary";

class BrokenWorkspace extends Error {
  constructor() {
    super("render failure");
    this.name = "BrokenWorkspace";
  }
}

function ThrowingChild(): never {
  throw new BrokenWorkspace();
}

const saveDocument = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  saveDocument.mockClear();
  consoleError.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RootErrorBoundary", () => {
  it("keeps a save-copy escape hatch for the current PDF proxy", async () => {
    const controller = {
      pdf: { numPages: 1, saveDocument },
    } as never;
    render(
      <RootErrorBoundary
        controller={controller}
        document={{ id: "doc", name: "broken.pdf", size: 4 }}
      >
        <ThrowingChild />
      </RootErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));
    await waitFor(() => expect(saveDocument).toHaveBeenCalledOnce());
    expect(screen.getByText("A copy was saved.")).toBeTruthy();
    expect(consoleError).toHaveBeenCalled();
  });
});
