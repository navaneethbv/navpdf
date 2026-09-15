// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExternalLinkDialog } from "../../src/components/ExternalLinkDialog";

describe("ExternalLinkDialog", () => {
  it("allows an operator to open or copy a validated link", () => {
    const onOpen = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<ExternalLinkDialog url="https://example.org" onClose={() => {}} onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText(/allow this host/i));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(writeText).toHaveBeenCalledWith("https://example.org");
    expect(onOpen).toHaveBeenCalledWith(true);
  });

  it("hides Open for a blocked link and still permits dismissal", () => {
    const onClose = vi.fn();
    render(
      <ExternalLinkDialog
        url="javascript:alert(1)"
        reason="This link type cannot be opened."
        onClose={onClose}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
