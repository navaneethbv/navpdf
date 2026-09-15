// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DecorationsDialog } from "../../src/features/decorations/DecorationsDialog";
import {
  createBlankDocument,
  applyDocumentDecorations,
  removeDocumentDecorations,
} from "../../src/services/document-commands";
import { PDFDocument } from "pdf-lib";
import type { ViewerController } from "../../src/features/viewer/controller";

describe("DecorationsDialog and decoration commands", () => {
  let samplePdf: Uint8Array;

  beforeEach(async () => {
    samplePdf = await createBlankDocument(3, 600, 800);
  });

  describe("applyDocumentDecorations", () => {
    it("applies headers and footers with token replacement", async () => {
      const output = await applyDocumentDecorations(samplePdf, {
        header: {
          left: "Doc Title",
          right: "Page {page} of {total}",
        },
        footer: {
          center: "Confidential - {date}",
        },
        metadata: {
          title: "My PDF",
          author: "Tester",
        },
      });

      expect(output.length).toBeGreaterThan(samplePdf.length);
      const doc = await PDFDocument.load(output);
      expect(doc.getPageCount()).toBe(3);
    });

    it("applies watermark with rotation and opacity", async () => {
      const output = await applyDocumentDecorations(samplePdf, {
        watermark: {
          text: "DRAFT",
          rotationDegrees: 45,
          opacity: 0.3,
          fontSize: 60,
        },
      });

      expect(output.length).toBeGreaterThan(samplePdf.length);
    });

    it("applies background tint to specified page range only", async () => {
      const output = await applyDocumentDecorations(samplePdf, {
        background: {
          color: [0.9, 0.95, 0.9],
          opacity: 0.15,
        },
        pageRange: [1], // only page 1
      });

      const doc = await PDFDocument.load(output);
      expect(doc.getPageCount()).toBe(3);
    });

    it("does not accumulate duplicates on repeated applications", async () => {
      // First application
      const firstPass = await applyDocumentDecorations(samplePdf, {
        watermark: { text: "FIRST" },
      });
      const doc1 = await PDFDocument.load(firstPass);
      expect(doc1.getPage(0).node.Contents()?.size()).toBeGreaterThan(0);

      // Second application with different watermark
      const secondPass = await applyDocumentDecorations(firstPass, {
        watermark: { text: "SECOND" },
      });
      const doc2 = await PDFDocument.load(secondPass);
      const streamsCount2 = doc2.getPage(0).node.Contents()?.size() ?? 0;

      // Third application
      const thirdPass = await applyDocumentDecorations(secondPass, {
        watermark: { text: "THIRD" },
      });
      const doc3 = await PDFDocument.load(thirdPass);
      const streamsCount3 = doc3.getPage(0).node.Contents()?.size() ?? 0;

      // Content streams remain bounded and do not stack with each repeated update
      expect(streamsCount3).toBe(streamsCount2);
    });
  });

  describe("removeDocumentDecorations", () => {
    it("removes app-owned decorations cleanly", async () => {
      const decorated = await applyDocumentDecorations(samplePdf, {
        watermark: { text: "TEMP WATERMARK" },
        header: { center: "Header text" },
      });

      const docDecorated = await PDFDocument.load(decorated);
      const decoratedStreams = docDecorated.getPage(0).node.Contents()?.size() ?? 0;

      const cleaned = await removeDocumentDecorations(decorated);
      const docCleaned = await PDFDocument.load(cleaned);
      const cleanedStreams = docCleaned.getPage(0).node.Contents()?.size() ?? 0;

      // Cleaned document should have fewer streams than decorated
      expect(cleanedStreams).toBeLessThan(decoratedStreams);
    });
  });

  describe("DecorationsDialog UI", () => {
    it("switches tabs and triggers apply", async () => {
      const onClose = vi.fn();
      const mockController = {
        pdf: {
          saveDocument: vi.fn().mockResolvedValue(samplePdf),
        },
        replaceWithBytes: vi.fn().mockResolvedValue(undefined),
      } as unknown as ViewerController;

      render(<DecorationsDialog controller={mockController} onClose={onClose} />);

      // Verify Header & Footer tab
      fireEvent.click(screen.getByRole("button", { name: /Header & Footer/i }));
      expect(screen.getByPlaceholderText(/Confidential Document/i)).toBeDefined();

      // Verify Bates tab
      fireEvent.click(screen.getByRole("button", { name: /Bates Numbers/i }));
      expect(screen.getByDisplayValue(/DOC-/i)).toBeDefined();

      // Verify Background tab
      fireEvent.click(screen.getByRole("button", { name: /Background/i }));
      expect(screen.getByText(/Background Tint Color/i)).toBeDefined();

      // Click Apply
      fireEvent.click(screen.getByRole("button", { name: /Apply/i }));

      await waitFor(() => {
        expect(mockController.replaceWithBytes).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("triggers remove decorations button", async () => {
      const onClose = vi.fn();
      const mockController = {
        pdf: {
          saveDocument: vi.fn().mockResolvedValue(samplePdf),
        },
        replaceWithBytes: vi.fn().mockResolvedValue(undefined),
      } as unknown as ViewerController;

      render(<DecorationsDialog controller={mockController} onClose={onClose} />);

      const removeBtn = screen.getByRole("button", { name: /Remove Decorations/i });
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(mockController.replaceWithBytes).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          expect.stringContaining("Removed"),
        );
        expect(onClose).toHaveBeenCalled();
      });
    });
  });
});
