// @vitest-environment happy-dom
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolErrorBoundary } from "../../src/components/ToolErrorBoundary";

function ThrowsInEffect({ message }: { message: string }) {
  useEffect(() => {
    throw new Error(message);
  }, [message]);
  return <p>Tool panel</p>;
}

describe("ToolErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes a tool that throws in an effect while the rest of the workspace stays mounted", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <div>
        <p>Open document</p>
        <ToolErrorBoundary resetKey="redact" onError={onError}>
          <ThrowsInEffect message="CANARY document text" />
        </ToolErrorBoundary>
      </div>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith();
    expect(screen.getByText("Open document")).toBeTruthy();
    expect(screen.queryByText("Tool panel")).toBeNull();
    expect(screen.queryByText(/CANARY/)).toBeNull();
  });

  it("renders the next tool after the reset key changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ToolErrorBoundary resetKey="redact" onError={() => {}}>
        <ThrowsInEffect message="failure" />
      </ToolErrorBoundary>,
    );
    rerender(
      <ToolErrorBoundary resetKey="compress" onError={() => {}}>
        <p>Compress panel</p>
      </ToolErrorBoundary>,
    );
    expect(screen.getByText("Compress panel")).toBeTruthy();
  });
});
