// @vitest-environment happy-dom

import { readFile } from "node:fs/promises";
import { requireFixture } from "../helpers/fixtures";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PropertiesDialog } from "../../src/features/document/PropertiesDialog";
import { readMetadata } from "../../src/services/pdf/metadata";
import { useWorkspace } from "../../src/stores/workspace";

describe("PropertiesDialog", () => {
  beforeEach(() => {
    useWorkspace.getState().reset();
  });

  it("loads current metadata and persists edited values", async () => {
    const source = new Uint8Array(await readFile(requireFixture("reader-5.pdf")));
    const replaceWithBytes = vi.fn(async () => {});
    const controller = {
      pdf: { saveDocument: vi.fn(async () => source) },
      replaceWithBytes,
    };
    const onClose = vi.fn();
    render(<PropertiesDialog controller={controller as never} onClose={onClose} />);

    const title = await screen.findByDisplayValue("NavPDF reader fixture: 5 pages");
    fireEvent.change(title, { target: { value: "Updated fixture" } });
    fireEvent.change(screen.getByLabelText("Keywords"), {
      target: { value: "alpha, beta" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save properties" }));

    await waitFor(() => expect(replaceWithBytes).toHaveBeenCalledTimes(1));
    const changed = replaceWithBytes.mock.calls[0][0] as Uint8Array;
    await expect(readMetadata(changed)).resolves.toMatchObject({
      title: "Updated fixture",
      keywords: ["alpha", "beta"],
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles an absent PDF and a failed save without losing the dialog", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<PropertiesDialog controller={null} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const controller = {
      pdf: {
        saveDocument: vi.fn().mockRejectedValue(new Error("cannot read")),
      },
      replaceWithBytes: vi.fn(),
    };
    rerender(<PropertiesDialog controller={controller as never} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText(/cannot read/)).toBeTruthy());
  });
});
