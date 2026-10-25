import type { ComponentType } from "react";
import type { ViewerController } from "../viewer/controller";
import { StampDialog } from "../annotations/StampDialog";
import { FlattenDialog } from "../document/FlattenDialog";
import { PageLabelsDialog } from "../pages/PageLabelsDialog";
import { ImposeDialog } from "../pages/ImposeDialog";
import { CommentSummaryDialog } from "../annotations/CommentSummaryDialog";
import { FieldLayoutDialog } from "../forms/FieldLayoutDialog";
import { AccessibilityDialog } from "../document/AccessibilityDialog";
import { ExtractImagesDialog } from "../convert/ExtractImagesDialog";
import { MeasureDialog } from "../annotations/MeasureDialog";
import { FormDataDialog } from "../forms/FormDataDialog";
import { DocumentInsightsDialog } from "../document/DocumentInsightsDialog";

import { InitialViewDialog } from "../document/InitialViewDialog";
import { LinkToolsDialog } from "../editor/LinkToolsDialog";
import { HeadingBookmarksDialog } from "../bookmarks/HeadingBookmarksDialog";
import { SpaceAuditDialog } from "../document/SpaceAuditDialog";
import { PagePropertiesDialog } from "../pages/PagePropertiesDialog";
import { FileCommentDialog, TextEditProposalDialog } from "../annotations/CommentDialogs";
import { FieldPropertiesDialog, FormAssistDialog } from "../forms/FormToolsDialogs";
import { OcrBatchDialog } from "../ocr/OcrBatchDialog";
import { CoverUpDialog } from "../redact/CoverUpDialog";
import { TagsDialog } from "../document/TagsDialog";

export interface DocumentToolProps {
  controller: ViewerController | null;
  onClose: () => void;
}

/** Document tools opened as modals, keyed by their `activeModal` and menu identifiers. */
export const DOCUMENT_TOOL_DIALOGS: Readonly<Record<string, ComponentType<DocumentToolProps>>> = {
  "initial-view": InitialViewDialog,
  stamp: StampDialog,
  flatten: FlattenDialog,
  "page-labels": PageLabelsDialog,
  impose: ImposeDialog,
  "comment-summary": CommentSummaryDialog,
  "field-layout": FieldLayoutDialog,
  accessibility: AccessibilityDialog,
  "extract-images": ExtractImagesDialog,
  measure: MeasureDialog,
  "form-data": FormDataDialog,
  "document-insights": DocumentInsightsDialog,
  "link-tools": LinkToolsDialog,
  "heading-bookmarks": HeadingBookmarksDialog,
  "space-audit": SpaceAuditDialog,
  "page-properties": PagePropertiesDialog,
  "text-edit-proposal": TextEditProposalDialog,
  "file-comment": FileCommentDialog,
  "field-properties": FieldPropertiesDialog,
  "form-assist": FormAssistDialog,
  "cover-ups": CoverUpDialog,
  "ocr-batch": OcrBatchDialog,
  tags: TagsDialog,
};
