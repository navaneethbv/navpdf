// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(() => false) }));
import { downloadBlob, REVOKE_DELAY_MS } from "../../src/utils/download";

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
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

describe("native exports", () => {
  afterEach(() => vi.mocked(isTauri).mockReturnValue(false));
  it("sends exact bytes and a safe Unicode filename to the native picker without a browser download", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValue(true);
    const urls = vi.spyOn(URL, "createObjectURL");
    const bytes = new Uint8Array([0, 255, 128, 42]);
    expect(await downloadBlob(new Blob([bytes]), "../Résumé.pptx")).toBe(true);
    const [command, payload, options] = vi.mocked(invoke).mock.calls.at(-1)!;
    expect(command).toBe("export_file");
    expect(payload).toEqual(bytes);
    expect(JSON.parse((options!.headers as Record<string, string>)["x-export-name"])).toBe(
      "Résumé.pptx",
    );
    expect(urls).not.toHaveBeenCalled();
    urls.mockRestore();
  });
  it("returns cancellation and propagates write errors", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("Disk full"));
    expect(await downloadBlob(new Blob(["x"]), "file.txt")).toBe(false);
    await expect(downloadBlob(new Blob(["x"]), "file.txt")).rejects.toThrow("Disk full");
  });
});
