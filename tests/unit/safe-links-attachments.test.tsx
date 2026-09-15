// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LinkDialog } from "../../src/features/editor/LinkDialog";
import { AttachmentsDialog } from "../../src/features/attachments/AttachmentsDialog";
import {
  createBlankDocument,
  validateSafeUrl,
  addLinkAnnotation,
  deleteLinkAnnotation,
  sanitizeAttachmentFilename,
  addEmbeddedAttachment,
  listEmbeddedAttachments,
  extractEmbeddedAttachment,
  deleteEmbeddedAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "../../src/services/document-commands";
import { PDFDocument } from "pdf-lib";
import type { ViewerController } from "../../src/features/viewer/controller";

describe("Safe links and attachments", () => {
  let samplePdf: Uint8Array;

  beforeEach(async () => {
    samplePdf = await createBlankDocument(3, 600, 800);
  });

  describe("validateSafeUrl", () => {
    it("permits https, http, and mailto protocols", () => {
      expect(validateSafeUrl("https://navpdf.org").valid).toBe(true);
      expect(validateSafeUrl("http://example.com/path?arg=1").valid).toBe(true);
      expect(validateSafeUrl("mailto:team@navpdf.org").valid).toBe(true);
      expect(validateSafeUrl("user@test.org").valid).toBe(true);
      expect(validateSafeUrl("user@test.org").normalizedUrl).toBe("mailto:user@test.org");
    });

    it("blocks javascript, data, file, and script schemes", () => {
      const js = validateSafeUrl("javascript:alert(1)");
      expect(js.valid).toBe(false);
      expect(js.reason).toContain("Blocked unsafe URI scheme");

      const file = validateSafeUrl("file:///etc/passwd");
      expect(file.valid).toBe(false);

      const data = validateSafeUrl("data:text/html,<script>alert(1)</script>");
      expect(data.valid).toBe(false);

      const vb = validateSafeUrl("vbscript:MsgBox(1)");
      expect(vb.valid).toBe(false);
    });

    it("rejects empty or malformed strings", () => {
      expect(validateSafeUrl("").valid).toBe(false);
      expect(validateSafeUrl("not-a-valid-url").valid).toBe(false);
    });
  });

  describe("addLinkAnnotation and deleteLinkAnnotation", () => {
    it("creates an external URL link annotation", async () => {
      const output = await addLinkAnnotation(samplePdf, {
        page: 1,
        rect: [50, 500, 200, 530],
        target: {
          type: "url",
          url: "https://example.com",
        },
      });

      const doc = await PDFDocument.load(output);
      const annots = doc.getPage(0).node.Annots();
      expect(annots.size()).toBe(1);
    });

    it("creates an internal page jump link annotation", async () => {
      const output = await addLinkAnnotation(samplePdf, {
        page: 1,
        rect: [50, 400, 200, 430],
        target: {
          type: "page",
          targetPage: 3,
        },
      });

      const doc = await PDFDocument.load(output);
      const annots = doc.getPage(0).node.Annots();
      expect(annots.size()).toBe(1);
    });

    it("rejects invalid rectangle geometry", async () => {
      await expect(
        addLinkAnnotation(samplePdf, {
          page: 1,
          rect: [200, 500, 50, 530], // x2 < x1
          target: { type: "url", url: "https://example.com" },
        }),
      ).rejects.toThrow("Invalid link rectangle geometry.");
    });

    it("deletes a link annotation", async () => {
      const withLink = await addLinkAnnotation(samplePdf, {
        page: 1,
        rect: [50, 500, 200, 530],
        target: { type: "url", url: "https://example.com" },
      });

      const docBefore = await PDFDocument.load(withLink);
      expect(docBefore.getPage(0).node.Annots().size()).toBe(1);

      const deleted = await deleteLinkAnnotation(withLink, 1, 0);
      const docAfter = await PDFDocument.load(deleted);
      expect(docAfter.getPage(0).node.Annots().size()).toBe(0);
    });
  });

  describe("sanitizeAttachmentFilename", () => {
    it("sanitizes directory traversal and separators", () => {
      expect(sanitizeAttachmentFilename("../../secret.pdf")).toBe("secret.pdf");
      expect(sanitizeAttachmentFilename("C:\\Users\\Admin\\data.csv")).toBe("data.csv");
      expect(sanitizeAttachmentFilename("/var/log/syslog.txt")).toBe("syslog.txt");
    });

    it("strips null bytes and provides fallback for empty names", () => {
      expect(sanitizeAttachmentFilename("safe\0file.pdf")).toBe("safefile.pdf");
      expect(sanitizeAttachmentFilename("...")).toBe("attachment.bin");
      expect(sanitizeAttachmentFilename("")).toBe("attachment.bin");
    });

    it("strips bidirectional override and isolate characters that disguise extensions", () => {
      expect(sanitizeAttachmentFilename("invoice‮txt.exe")).toBe("invoicetxt.exe");
      expect(sanitizeAttachmentFilename("⁦report⁩.pdf")).toBe("report.pdf");
    });
  });

  describe("embedded attachments lifecycle", () => {
    it("embeds, lists, extracts, and deletes attachments", async () => {
      const sampleData = new Uint8Array([10, 20, 30, 40, 50]);
      const withAtt = await addEmbeddedAttachment(
        samplePdf,
        "sample.bin",
        sampleData,
        "Test description",
      );

      // 1. List
      const list = await listEmbeddedAttachments(withAtt);
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("sample.bin");

      // 2. Extract
      const extracted = await extractEmbeddedAttachment(withAtt, "sample.bin");
      expect(extracted).not.toBeNull();
      expect(Array.from(extracted!)).toEqual(Array.from(sampleData));

      // 3. Delete
      const deleted = await deleteEmbeddedAttachment(withAtt, "sample.bin");
      const listAfter = await listEmbeddedAttachments(deleted);
      expect(listAfter).toHaveLength(0);
    });

    it("rejects attachments exceeding maximum size boundary (50MB)", async () => {
      // Mock large byte array length without allocating 50MB in RAM
      const fakeLarge = { length: MAX_ATTACHMENT_SIZE_BYTES + 1 } as unknown as Uint8Array;
      await expect(addEmbeddedAttachment(samplePdf, "huge.zip", fakeLarge)).rejects.toThrow(
        /Attachment exceeds maximum allowed size of 50 MB/,
      );
    });
  });

  describe("LinkDialog UI", () => {
    it("renders and adds safe link", async () => {
      const onClose = vi.fn();
      const mockController = {
        pdf: {
          saveDocument: vi.fn().mockResolvedValue(samplePdf),
        },
        replaceWithBytes: vi.fn().mockResolvedValue(undefined),
      } as unknown as ViewerController;

      render(<LinkDialog controller={mockController} onClose={onClose} />);

      const urlInput = screen.getByPlaceholderText("https://example.com");
      fireEvent.change(urlInput, { target: { value: "https://navpdf.org" } });

      const addBtn = screen.getByRole("button", { name: "Add Link" }) as HTMLButtonElement;
      expect(addBtn.disabled).toBe(false);
      fireEvent.click(addBtn);

      await waitFor(() => {
        expect(mockController.replaceWithBytes).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("disables button when unsafe scheme is typed", () => {
      render(<LinkDialog controller={null} onClose={vi.fn()} />);

      const urlInput = screen.getByPlaceholderText("https://example.com");
      fireEvent.change(urlInput, { target: { value: "javascript:alert(1)" } });

      expect(screen.getByRole("alert")).toBeDefined();
      const addBtn = screen.getByRole("button", { name: "Add Link" }) as HTMLButtonElement;
      expect(addBtn.disabled).toBe(true);
    });
  });

  describe("AttachmentsDialog UI", () => {
    it("renders attachments dialog and handles file attachment", async () => {
      const onClose = vi.fn();
      const mockController = {
        pdf: {
          saveDocument: vi.fn().mockResolvedValue(samplePdf),
        },
        replaceWithBytes: vi.fn().mockResolvedValue(undefined),
      } as unknown as ViewerController;

      render(<AttachmentsDialog controller={mockController} onClose={onClose} />);

      expect(screen.getByText("File Attachments")).toBeDefined();
      expect(screen.getByText(/No embedded attachments/i)).toBeDefined();

      const file = new File(["test data"], "attached.txt", { type: "text/plain" });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockController.replaceWithBytes).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          expect.stringContaining("attached.txt"),
        );
      });
    });
  });
});
