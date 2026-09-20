import { useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  RotateCw,
  Trash2,
  Crop,
  Layers,
  FilePlus,
  Combine,
  Split,
  Highlighter,
  PenTool,
  Camera,
  Download,
  FileSpreadsheet,
  Presentation,
  Shield,
  BadgeCheck,
  EyeOff,
  Sparkles,
  Search,
  CheckSquare,
  PenLine,
  Stamp,
  Heading,
  Droplets,
  Paperclip,
  Hash,
  Scan,
  Printer,
  Link as LinkIcon,
  Replace,
  X,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import type { ToolMode } from "../../types/document";

interface ToolItem {
  id: string;
  label: string;
  description: string;
  category: "edit" | "pages" | "review" | "convert" | "forms" | "protect";
  icon: typeof FileText;
  action: () => void;
  disabled?: boolean;
}

export function ToolPanel({ mode, onClose }: Readonly<{ mode: ToolMode; onClose: () => void }>) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const s = useWorkspace();
  const hasDoc = !!s.document;

  const tools: ToolItem[] = [
    // Pages
    {
      id: "organize-pages",
      label: "Organize Pages",
      description: "Reorder, rotate, delete, and extract pages visually",
      category: "pages",
      icon: Layers,
      action: () => s.set({ activeModal: "page-workspace" }),
      disabled: !hasDoc,
    },
    {
      id: "rotate-pages",
      label: "Rotate Pages",
      description: "Rotate selected or all pages in 90-degree increments",
      category: "pages",
      icon: RotateCw,
      action: () => s.set({ activeModal: "page-workspace" }),
      disabled: !hasDoc,
    },
    {
      id: "delete-pages",
      label: "Delete Pages",
      description: "Remove unwanted pages from the document",
      category: "pages",
      icon: Trash2,
      action: () => s.set({ activeModal: "page-workspace" }),
      disabled: !hasDoc,
    },
    {
      id: "crop-pages",
      label: "Crop Page Boxes",
      description: "Adjust visible page margins and crop box",
      category: "pages",
      icon: Crop,
      action: () => s.set({ activeModal: "page-workspace" }),
      disabled: !hasDoc,
    },
    {
      id: "split-pdf",
      label: "Split PDF",
      description: "Divide PDF by page ranges or extract each page",
      category: "pages",
      icon: Split,
      action: () => s.set({ activeModal: "page-workspace" }),
      disabled: !hasDoc,
    },
    {
      id: "combine-files",
      label: "Combine Files",
      description: "Merge multiple PDF documents or images into one",
      category: "pages",
      icon: Combine,
      action: () => s.set({ activeModal: "combine-pdf" }),
    },
    {
      id: "print-doc",
      label: "Print Document",
      description: "Send document or custom page ranges to print",
      category: "pages",
      icon: Printer,
      action: () => s.set({ activeModal: "print" }),
      disabled: !hasDoc,
    },
    // Edit Content
    {
      id: "add-text",
      label: "Add Text",
      description: "Insert new styled text anywhere on the page",
      category: "edit",
      icon: FileText,
      action: () => s.set({ activeModal: "add-text", tool: "text" }),
      disabled: !hasDoc,
    },
    {
      id: "document-properties",
      label: "Document Properties",
      description: "Edit title, author, subject, keywords, and PDF metadata",
      category: "edit",
      icon: FileText,
      action: () => s.set({ activeModal: "properties" }),
      disabled: !hasDoc,
    },
    {
      id: "add-image",
      label: "Add Image",
      description: "Insert PNG or JPEG images with resize and position controls",
      category: "edit",
      icon: ImageIcon,
      action: () => s.set({ activeModal: "add-image" }),
      disabled: !hasDoc,
    },
    {
      id: "edit-existing",
      label: "Edit a PDF",
      description: "Replace or delete existing text runs and images on a page",
      category: "edit",
      icon: Replace,
      action: () => s.set({ activeModal: "edit-objects" }),
      disabled: !hasDoc,
    },
    {
      id: "header-footer",
      label: "Header & Footer",
      description: "Add page numbers, dates, titles, and custom slots",
      category: "edit",
      icon: Heading,
      action: () => s.set({ activeModal: "decorations" }),
      disabled: !hasDoc,
    },
    {
      id: "watermark",
      label: "Watermark",
      description: "Overlay customizable text or image watermark",
      category: "edit",
      icon: Droplets,
      action: () => s.set({ activeModal: "decorations" }),
      disabled: !hasDoc,
    },
    {
      id: "bates-numbering",
      label: "Bates Numbering",
      description: "Apply sequential legal indexing and prefix numbering",
      category: "edit",
      icon: Hash,
      action: () => s.set({ activeModal: "decorations" }),
      disabled: !hasDoc,
    },
    {
      id: "attachments",
      label: "File Attachments",
      description: "Embed files into the PDF or extract embedded attachments",
      category: "edit",
      icon: Paperclip,
      action: () => s.set({ activeModal: "attachments" }),
      disabled: !hasDoc,
    },
    {
      id: "add-link",
      label: "Link Annotation",
      description: "Create internal page jump or external web link",
      category: "edit",
      icon: LinkIcon,
      action: () => s.set({ activeModal: "add-link" }),
      disabled: !hasDoc,
    },
    // Review
    {
      id: "highlight-text",
      label: "Highlight Text",
      description: "Standard PDF text highlight annotation",
      category: "review",
      icon: Highlighter,
      action: () => s.set({ tool: "highlight" }),
      disabled: !hasDoc,
    },
    {
      id: "drawing-markup",
      label: "Freehand Ink & Text Boxes",
      description: "Freehand ink, text boxes, and standard shape annotations",
      category: "review",
      icon: PenTool,
      action: () => s.set({ tool: "draw", activeModal: "annotations" }),
      disabled: !hasDoc,
    },
    {
      id: "snapshot-tool",
      label: "Take Snapshot",
      description: "Capture rendered region to clipboard or image file",
      category: "review",
      icon: Camera,
      action: () => s.set({ activeSnapshot: true, tool: "snapshot" }),
      disabled: !hasDoc,
    },
    // Convert
    {
      id: "export-docx",
      label: "Microsoft Word (.docx)",
      description: "Editable paragraphs and headings from the PDF text layer",
      category: "convert",
      icon: FileText,
      action: () => s.set({ activeModal: "office-export" }),
      disabled: !hasDoc,
    },
    {
      id: "export-pptx",
      label: "PowerPoint (.pptx)",
      description: "Editable text slides or page-picture slides",
      category: "convert",
      icon: Presentation,
      action: () => s.set({ activeModal: "office-pptx" }),
      disabled: !hasDoc,
    },
    {
      id: "export-xlsx",
      label: "Excel Workbook (.xlsx)",
      description: "Page text aligned into typed cells; formulas are never created",
      category: "convert",
      icon: FileSpreadsheet,
      action: () => s.set({ activeModal: "office-xlsx" }),
      disabled: !hasDoc,
    },
    {
      id: "ocr-text",
      label: "Scan & OCR",
      description: "Recognize scanned pages locally or extract embedded page text",
      category: "convert",
      icon: Scan,
      action: () => s.set({ activeModal: "ocr" }),
      disabled: !hasDoc,
    },
    {
      id: "export-images",
      label: "Export to Images",
      description: "Export pages as high-resolution PNG or JPEG",
      category: "convert",
      icon: Download,
      action: () => s.set({ activeModal: "convert" }),
      disabled: !hasDoc,
    },
    {
      id: "compress-pdf",
      label: "Compress PDF",
      description: "Measured structural and image compression with fidelity checks",
      category: "convert",
      icon: Download,
      action: () => s.set({ activeModal: "compress" }),
      disabled: !hasDoc,
    },
    // Forms & Sign
    {
      id: "fill-and-sign",
      label: "Fill & Sign",
      description: "Place signature, initials, text, checkmarks, and dots",
      category: "forms",
      icon: PenLine,
      action: () => s.set({ activeModal: "fill-sign", tool: "signature" }),
      disabled: !hasDoc,
    },
    {
      id: "form-fields",
      label: "Prepare a Form",
      description: "Add interactive text fields, checkboxes, and buttons",
      category: "forms",
      icon: CheckSquare,
      action: () => s.set({ activeModal: "forms" }),
      disabled: !hasDoc,
    },
    {
      id: "signature-stamp",
      label: "Signature Library",
      description: "Manage drawn, typed, or uploaded signatures locally",
      category: "forms",
      icon: Stamp,
      action: () => s.set({ activeModal: "fill-sign", tool: "signature" }),
    },
    // Protect & Redact
    {
      id: "protect-pdf",
      label: "Protect a PDF",
      description: "Save an AES-256 protected copy or unlock a protected PDF",
      category: "protect",
      icon: Shield,
      action: () => s.set({ activeModal: "protect" }),
      disabled: !hasDoc,
    },
    {
      id: "redact-pdf",
      label: "Redact PDF",
      description: "Permanently remove marked text, image pixels and hidden data",
      category: "protect",
      icon: EyeOff,
      action: () => s.set({ activeModal: "redact" }),
      disabled: !hasDoc,
    },
    {
      id: "certificate-sign",
      label: "Certificate Signature",
      description: "Sign a copy with a .p12 certificate and check existing signatures",
      category: "protect",
      icon: BadgeCheck,
      action: () => s.set({ activeModal: "certificate-sign" }),
      disabled: !hasDoc,
    },
    // Intelligent Tools & Creation
    {
      id: "create-blank",
      label: "Create Blank PDF",
      description: "Generate a new empty document with custom page count",
      category: "pages",
      icon: FilePlus,
      action: () => s.set({ activeModal: "create-pdf" }),
    },
    {
      id: "design-cover",
      label: "Design Cover Page",
      description: "Generate stylish modern cover pages and title templates",
      category: "edit",
      icon: Sparkles,
      action: () => s.set({ activeModal: "design" }),
      disabled: !hasDoc,
    },
  ];

  tools.push(
    {
      id: "export-pdf",
      label: "Export a PDF",
      description: "Word, PowerPoint, Excel, images and text",
      category: "convert",
      icon: Download,
      action: () => s.set({ activeModal: "export-options" }),
      disabled: !hasDoc,
    },
    {
      id: "import-pdf",
      label: "Import / Convert to PDF",
      description: "Create a PDF from PDFs, PNG or JPEG images",
      category: "pages",
      icon: FilePlus,
      action: () => s.set({ activeModal: "import-pdf" }),
    },
  );
  const preferred = [
    "edit-existing",
    "export-pdf",
    "fill-and-sign",
    "create-blank",
    "combine-files",
    "organize-pages",
    "ocr-text",
    "protect-pdf",
    "redact-pdf",
    "compress-pdf",
    "form-fields",
    "drawing-markup",
    "import-pdf",
    "certificate-sign",
  ];
  const ordered =
    mode === "all"
      ? [...tools].sort((a, b) => {
          const rank = (id: string) => {
            const index = preferred.indexOf(id);
            return index < 0 ? preferred.length : index;
          };
          return rank(a.id) - rank(b.id);
        })
      : tools;
  const filtered = ordered.filter((t) => {
    if (mode === "edit" && !["edit", "pages"].includes(t.category)) return false;
    if (mode === "convert" && t.category !== "convert") return false;
    if (mode === "esign" && t.category !== "forms") return false;
    if (mode === "create" && !["create-blank", "combine-files"].includes(t.id)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
  });

  const title = getToolPanelTitle(mode);

  return (
    <section className="tool-drawer" aria-label={title}>
      <div className="tool-drawer-header">
        <div className="tool-drawer-title">
          <h3>{title}</h3>
          <span className="tool-count">{filtered.length} tools</span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close tools panel">
          <X size={18} />
        </button>
      </div>

      {mode === "all" && (
        <div className="tool-search-box">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search all tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tools"
          />
        </div>
      )}

      <div className="tool-grid">
        {(mode === "all" && !search && !expanded ? filtered.slice(0, 12) : filtered).map((tool) => (
          <button
            key={tool.id}
            className={`tool-card category-${tool.category} ${tool.disabled ? "disabled" : ""}`}
            title={tool.description}
            disabled={s.busy || tool.disabled}
            onClick={() => {
              tool.action();
              if (mode !== "all") onClose();
            }}
          >
            <div className="tool-card-icon">
              <tool.icon size={20} />
            </div>
            <div className="tool-card-text">
              <span className="tool-card-label">{tool.label}</span>
            </div>
          </button>
        ))}
      </div>
      {mode === "all" && !search && (
        <button
          className="tool-view-more"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded ? "View less" : "View more"}
        </button>
      )}
    </section>
  );
}

function getToolPanelTitle(mode: ToolMode): string {
  switch (mode) {
    case "all":
      return "All Tools";
    case "edit":
      return "Edit PDF";
    case "convert":
      return "Convert & Export";
    case "esign":
      return "Fill & Sign";
    default:
      return "Create PDF";
  }
}
