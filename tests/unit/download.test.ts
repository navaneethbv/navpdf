// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, REVOKE_DELAY_MS } from "../../src/utils/download";

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("triggers a download with the requested filename", () => {
    const clicked: HTMLAnchorElement[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicked.push(this as HTMLAnchorElement);
    };

    downloadBlob(new Blob(["hello"]), "report.txt");

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("report.txt");
    expect(clicked[0].href).toContain("blob:test-url");
    HTMLAnchorElement.prototype.click = original;
  });

  it("does not revoke the object URL before the download can start", () => {
    downloadBlob(new Blob(["hello"]), "report.txt");

    // Revoking synchronously after click cancels the download in WebKit.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-url");
  });

  it("sanitizes path separators out of the filename", () => {
    const clicked: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      clicked.push((this as HTMLAnchorElement).download);
    };

    downloadBlob(new Blob(["x"]), "../../etc/passwd.pdf");

    expect(clicked[0]).not.toContain("/");
    expect(clicked[0]).not.toContain("..");
    HTMLAnchorElement.prototype.click = original;
  });
});
