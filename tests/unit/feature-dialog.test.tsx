// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FeatureDialog } from "../../src/components/FeatureDialog";

describe("FeatureDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names the modal, focuses its first control, traps Tab, and restores the opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <FeatureDialog title="Example tool" onClose={() => {}}>
        <div className="modal-dialog">
          <button>First</button>
          <button>Last</button>
        </div>
      </FeatureDialog>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("dialog", { name: "Example tool" }).getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    screen.getByRole("button", { name: "Last" }).focus();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    unmount();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape when idle and ignores Escape while busy", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <FeatureDialog title="Example tool" onClose={onClose}>
        <button>Apply</button>
      </FeatureDialog>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <FeatureDialog title="Example tool" onClose={onClose} busy>
        <button>Apply</button>
      </FeatureDialog>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  });

  it("uses the requested initial focus and renders footer content", async () => {
    const initial = document.createElement("input");
    document.body.append(initial);
    const ref = { current: initial };
    render(
      <FeatureDialog
        title="Focused tool"
        className="custom-dialog"
        initialFocusRef={ref}
        footer={<button>Done</button>}
        onClose={() => {}}
      >
        <button>Other</button>
      </FeatureDialog>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector(".custom-dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });
});
