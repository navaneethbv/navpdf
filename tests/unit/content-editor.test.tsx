// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ContentEditor } from "../../src/features/editor/ContentEditor";
import {
  createBlankDocument,
  insertTextContent,
  insertImageContent,
  validateStandardFontCoverage,
} from "../../src/services/document-commands";
import { PDFDocument } from "pdf-lib";
import type { ViewerController } from "../../src/features/viewer/controller";

const TINY_PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("ContentEditor and content commands", () => {
  let samplePdf: Uint8Array;

  beforeEach(async () => {
    samplePdf = await createBlankDocument(2, 600, 800);
  });

  describe("validateStandardFontCoverage", () => {
    it("accepts valid ASCII and Latin-1 characters", () => {
      const result = validateStandardFontCoverage("Hello World! 123 - Café & Résumé (€, ©, ®)");
      expect(result.valid).toBe(true);
      expect(result.unsupportedChars).toHaveLength(0);
    });

    it("detects and reports unsupported Unicode characters", () => {
      // Cyrillic, CJK, Emoji
      const result = validateStandardFontCoverage("Hello Привет 世界 🚀");
      expect(result.valid).toBe(false);
      expect(result.unsupportedChars).toContain("П");
      expect(result.unsupportedChars).toContain("世");
    });
  });

  describe("insertTextContent", () => {
    it("successfully inserts text into PDF with font and alignment", async () => {
      const output = await insertTextContent(samplePdf, {
        page: 1,
        text: "Sample Heading\nWith a second wrapped line of text.",
        x: 50,
        y: 750,
        fontSize: 16,
        fontFamily: "Helvetica-Bold",
        alignment: "center",
        maxWidth: 300,
      });

      expect(output.length).toBeGreaterThan(samplePdf.length);
      const loaded = await PDFDocument.load(output);
      expect(loaded.getPageCount()).toBe(2);
    });

    it("rejects empty text", async () => {
      await expect(
        insertTextContent(samplePdf, {
          page: 1,
          text: "   ",
          x: 50,
          y: 700,
        }),
      ).rejects.toThrow("Text content cannot be empty.");
    });

    it("rejects unsupported Unicode glyphs before mutation", async () => {
      await expect(
        insertTextContent(samplePdf, {
          page: 1,
          text: "Invalid: Привет",
          x: 50,
          y: 700,
        }),
      ).rejects.toThrow(/Unsupported characters for standard PDF fonts/);
    });

    it("rejects out of bounds page numbers", async () => {
      await expect(
        insertTextContent(samplePdf, {
          page: 99,
          text: "Valid text",
          x: 50,
          y: 700,
        }),
      ).rejects.toThrow("Target page is outside the document.");
    });
  });

  describe("insertImageContent", () => {
    it("successfully inserts image with aspect-ratio preservation", async () => {
      const output = await insertImageContent(samplePdf, {
        page: 1,
        imageBytes: TINY_PNG,
        imageType: "png",
        preserveAspectRatio: true,
        opacity: 0.9,
        rotationDegrees: 90,
      });

      expect(output.length).toBeGreaterThan(samplePdf.length);
      const loaded = await PDFDocument.load(output);
      expect(loaded.getPageCount()).toBe(2);
    });

    it("rejects empty image data", async () => {
      await expect(
        insertImageContent(samplePdf, {
          page: 1,
          imageBytes: new Uint8Array([]),
          imageType: "png",
        }),
      ).rejects.toThrow("Image data is empty.");
    });
  });

  describe("ContentEditor UI Component", () => {
    it("displays error alert and disables insert button when unsupported characters are typed", () => {
      const mockController = {
        pdf: {
          saveDocument: vi.fn().mockResolvedValue(samplePdf),
        },
        replaceWithBytes: vi.fn(),
      } as unknown as ViewerController;

      render(<ContentEditor controller={mockController} type="text" onClose={vi.fn()} />);

      const textarea = screen.getByPlaceholderText(/Enter text to place on page/i);
      const insertBtn = screen.getByRole("button", { name: "Insert Text" }) as HTMLButtonElement;

      // Initially disabled because empty
      expect(insertBtn.disabled).toBe(true);

      // Enter unsupported text
      fireEvent.change(textarea, { target: { value: "Hello Привет" } });

      // Should display alert and stay disabled
      expect(screen.getByRole("alert")).toBeDefined();
      expect(screen.getByText(/Unsupported characters for standard fonts/i)).toBeDefined();
      expect(insertBtn.disabled).toBe(true);

      // Fix text to supported Latin-1
      fireEvent.change(textarea, { target: { value: "Hello World" } });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(insertBtn.disabled).toBe(false);
    });

    it("submits valid text and closes dialog", async () => {
      const onClose = vi.fn();
      const mockController = {
        pdf: {
          saveDocument: vi.fn().mockResolvedValue(samplePdf),
        },
        replaceWithBytes: vi.fn().mockResolvedValue(undefined),
      } as unknown as ViewerController;

      render(<ContentEditor controller={mockController} type="text" onClose={onClose} />);

      const textarea = screen.getByPlaceholderText(/Enter text to place on page/i);
      fireEvent.change(textarea, { target: { value: "Valid Document Text" } });

      const insertBtn = screen.getByRole("button", { name: "Insert Text" });
      fireEvent.click(insertBtn);

      await waitFor(() => {
        expect(mockController.replaceWithBytes).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });
  });
});
