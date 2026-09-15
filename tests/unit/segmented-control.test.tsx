// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SegmentedControl } from "../../src/components/SegmentedControl";

describe("SegmentedControl", () => {
  it("supports selection and roving keyboard focus", async () => {
    const values = ["one", "two", "three"] as const;
    let selected = "one";
    const { rerender } = render(
      <SegmentedControl
        label="Modes"
        value={selected}
        options={values.map((value) => ({ value, label: value }))}
        onChange={(value) => {
          selected = value;
        }}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].getAttribute("tabindex")).toBe("-1");
    fireEvent.click(buttons[1]);
    expect(selected).toBe("two");
    rerender(
      <SegmentedControl
        label="Modes"
        value={selected}
        options={values.map((value) => ({ value, label: value }))}
        onChange={(value) => {
          selected = value;
        }}
      />,
    );
    fireEvent.keyDown(buttons[1], { key: "ArrowRight" });
    await Promise.resolve();
    expect(document.activeElement).toBe(buttons[2]);
    rerender(
      <SegmentedControl
        label="Modes"
        value={selected}
        options={values.map((value) => ({ value, label: value }))}
        onChange={(value) => {
          selected = value;
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "three" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("does not move focus when there is no adjacent option", () => {
    render(
      <SegmentedControl
        label="Single mode"
        value="only"
        options={[{ value: "only", label: "Only" }]}
        onChange={() => {}}
      />,
    );
    const button = screen.getByRole("button", { name: "Only" });
    fireEvent.keyDown(button, { key: "ArrowLeft" });
    expect(button.getAttribute("tabindex")).toBe("0");
  });
});
