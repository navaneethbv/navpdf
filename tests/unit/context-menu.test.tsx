// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "../../src/components/ContextMenu";

describe("ContextMenu", () => {
  it("exposes keyboard-operable menu items and closes on Escape", () => {
    const onClose = vi.fn();
    const onAction = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        onClose={onClose}
        onAction={onAction}
        actions={[{ id: "copy", label: "Copy" }]}
      />,
    );
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(onAction).toHaveBeenCalledWith("copy");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
