/** Shapes shared with the native engine commands in `src-tauri/src/commands/engine.rs`. */

export type PdfRect = [number, number, number, number];

export interface RedactionRegion {
  page: number;
  rect: PdfRect;
  /** Overlay text such as a redaction code, centred on the region. */
  label?: string;
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
  /** Overlay colour as RGB channels from 0 to 1; black when absent. */
  fill?: [number, number, number];
}

export type CoverUpKind = "coveredText" | "unappliedRedaction" | "coveringAnnotation";

export interface CoverUp {
  page: number;
  kind: CoverUpKind;
  rect: PdfRect;
  characters: number;
  /** Start of the text under the cover, for the reviewer only. */
  sample: string;
}

export interface CoverUpReport {
  findings: CoverUp[];
  pagesChecked: number;
  truncated: boolean;
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
  /** One entry per chosen discard that changed the document. */
  discarded?: string[];
  message: string;
}

/** Structures the optimizer removes before compressing; every option defaults to off. */
export interface DiscardOptions {
  javascript: boolean;
  thumbnails: boolean;
  tags: boolean;
  bookmarks: boolean;
  printSettings: boolean;
  alternateImages: boolean;
  comments: boolean;
  multimedia: boolean;
  metadata: boolean;
  attachments: boolean;
  privateData: boolean;
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

/** Cipher for a protected copy; only AES-256 is recommended. */
export type EncryptionLevel = "aes256" | "aes128" | "rc4128" | "rc440";

export interface ProtectionRequest {
  userPassword: string;
  ownerPassword: string;
  permissions: PermissionRequest;
  encryption?: EncryptionLevel;
  /** False keeps the XMP metadata readable; AES levels only. */
  encryptMetadata?: boolean;
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

export type SignatureCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** A visible signature box in a displayed corner of a page. */
export interface SignatureAppearance {
  /** 1-based page number. */
  page: number;
  corner: SignatureCorner;
}

export interface SignRequest {
  reason: string;
  location: string;
  certification: Certification;
  /** Omitted for a signature with no visible appearance. */
  appearance?: SignatureAppearance;
}

export interface CertificateDetails {
  subject: string;
  issuer: string;
  /** Serial number in hexadecimal. */
  serial: string;
  notBefore: string;
  notAfter: string;
  /** SHA-256 of the certificate as colon-separated hexadecimal pairs. */
  fingerprint: string;
  selfSigned: boolean;
  /** The certificate is one the user chose to trust on this device. */
  trusted: boolean;
}

export type TrustStatus = "trusted" | "notTrusted" | "notValidAtSigning" | "brokenChain";

export interface RevisionChange {
  kind: "pages" | "comments" | "formFields" | "signatures" | "other";
  description: string;
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
  /** The signer's certificate first, then each issuer found for it. */
  certificates: CertificateDetails[];
  trust: TrustStatus | null;
  trustMessage: string;
  /** Length of the file as signed, which is the signed revision. */
  revisionLength: number | null;
  /** What changed after this signature when it does not cover the whole file. */
  changes: RevisionChange[];
  /** Whether a certified document allows those changes; null when not certified. */
  changesPermitted: boolean | null;
}

/** One indirect structure element in a tagged document. */
export interface TagNode {
  /** Object number and generation, such as "12 0". */
  id: string;
  parent: string | null;
  depth: number;
  /** Structure type, such as P, H1 or Figure. */
  role: string;
  /** The standard type a custom role maps to, when the role map names one. */
  standardRole: string | null;
  title: string;
  alt: string;
  actualText: string;
  lang: string;
  /** 1-based page of the tag or its first content. */
  page: number | null;
  mcids: number[];
  /** Annotations the tag owns directly. */
  objects: number;
  /** Child tags, including inline ones that are not listed. */
  children: number;
}

export interface TagTree {
  tagged: boolean;
  nodes: TagNode[];
  truncated: boolean;
}

/** Text properties; an empty string removes the entry and an omitted one is unchanged. */
export interface TagProperties {
  role?: string;
  title?: string;
  alt?: string;
  actualText?: string;
  lang?: string;
}

export type TagEdit =
  | { action: "setProperties"; id: string; properties: TagProperties }
  | { action: "move"; id: string; offset: number }
  | { action: "markArtifact"; id: string }
  | { action: "autotag" };

export interface TagReport {
  message: string;
}

export interface UntaggedPage {
  page: number;
  /** Painting operations outside tagged content and artifacts. */
  content: number;
  annotations: number;
  widgets: number;
}

export interface UntaggedReport {
  tagged: boolean;
  pages: UntaggedPage[];
  truncated: boolean;
}

export type PdfaLevel = "2b" | "2u" | "2a" | "3b" | "3u" | "3a";

export interface PdfaFinding {
  rule: string;
  message: string;
  count: number;
  examples: string[];
  /** Conversion fixes this rule. */
  fixable: boolean;
}

export interface PdfaReport {
  level: string;
  declared: string | null;
  passed: boolean;
  findings: PdfaFinding[];
  /** Requirements the checks do not read. */
  notChecked: string[];
}

export interface OutputIntentInfo {
  subtype: string;
  condition: string;
  info: string;
  hasProfile: boolean;
  components: number | null;
}

export interface DocumentStandards {
  pdfa: string | null;
  pdfua: string | null;
  pdfx: string | null;
  outputIntents: OutputIntentInfo[];
}

export type StandardsEdit =
  | { action: "convert"; level: PdfaLevel }
  | { action: "addOutputIntent" }
  | { action: "removeIdentification" };
