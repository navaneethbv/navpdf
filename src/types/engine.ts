/** Shapes shared with the native engine commands in `src-tauri/src/commands/engine.rs`. */

export type PdfRect = [number, number, number, number];

export interface RedactionRegion {
  page: number;
  rect: PdfRect;
}

export interface SanitizeOptions {
  removeMetadata: boolean;
  removeAttachments: boolean;
  removeScripts: boolean;
  removeComments: boolean;
  removeBookmarks: boolean;
  removeHiddenContent: boolean;
}

export interface RedactionRequest {
  regions: RedactionRegion[];
  terms: string[];
  options: SanitizeOptions;
  acknowledgeSignatures: boolean;
}

export interface AuditReport {
  passed: boolean;
  regionsChecked: number;
  residualRegionItems: number;
  termsChecked: number;
  residualTerms: number;
  streamsScanned: number;
}

export interface RedactionReport {
  pages: number[];
  removedGlyphs: number;
  pixelRedactedImages: number;
  removedImages: number;
  removedPaths: number;
  removedAnnotations: number;
  hiddenAnnotationsRemoved: number;
  removedFormFields: number;
  rewrittenForms: number;
  sanitized: string[];
  warnings: string[];
  audit: AuditReport;
}

export type CompressionPreset = "lossless" | "balanced" | "small";

export interface FidelityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CompressionReport {
  preset: CompressionPreset;
  beforeBytes: number;
  afterBytes: number;
  useful: boolean;
  unusedObjectsRemoved: number;
  duplicateStreamsMerged: number;
  imagesExamined: number;
  imagesRecompressed: number;
  imagesSkipped: number;
  checks: FidelityCheck[];
  message: string;
}

export interface PermissionRequest {
  print: boolean;
  printHighQuality: boolean;
  copy: boolean;
  modify: boolean;
  annotate: boolean;
  fillForms: boolean;
  assemble: boolean;
  accessibility: boolean;
}

export interface ProtectionRequest {
  userPassword: string;
  ownerPassword: string;
  permissions: PermissionRequest;
}

export interface ProtectedSave {
  name: string;
  size: number;
  replacedSource: boolean;
}

export interface PageObject {
  id: string;
  kind: "text" | "image";
  bbox: PdfRect;
  text: string | null;
  font: string | null;
  fontSize: number | null;
  pixelWidth: number | null;
  pixelHeight: number | null;
  shared: boolean;
  replaceable: boolean;
  reason: string | null;
}

export interface PageObjects {
  page: number;
  mediaBox: PdfRect;
  objects: PageObject[];
}

export type EditRequest =
  | { type: "replaceText"; objectId: string; text: string; preview?: boolean }
  | { type: "deleteObject"; objectId: string }
  | { type: "replaceImage"; objectId: string; width: number; height: number }
  | {
      type: "transformImage";
      objectId: string;
      cm: [number, number, number, number, number, number];
    };

export interface EditReport {
  applied: boolean;
  message: string;
  widthBefore: number | null;
  widthAfter: number | null;
  missingCharacters: string[];
}

export interface EngineResult<R> {
  bytes: Uint8Array<ArrayBuffer> | null;
  report: R;
}

/** DocMDP choices for a certifying signature; "none" makes an approval signature. */
export type Certification = "none" | "noChanges" | "formFilling" | "formFillingAndComments";

export interface SignRequest {
  reason: string;
  location: string;
  certification: Certification;
}

export interface CertificateSummary {
  subject: string;
  issuer: string;
  notBefore: string;
  notAfter: string;
  keyType: string;
  chainLength: number;
  selfSigned: boolean;
}

export interface SignedSave {
  name: string;
  size: number;
}

export type SignatureStatus = "valid" | "modified" | "invalid" | "unsupported";

export interface SignatureInfo {
  field: string;
  signer: string | null;
  issuer: string | null;
  signedAt: string | null;
  reason: string | null;
  subFilter: string | null;
  status: SignatureStatus;
  message: string;
  coversWholeDocument: boolean;
  certification: number | null;
}
