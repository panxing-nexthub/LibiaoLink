export type ExportImageExtension = "png" | "jpeg" | "gif";

export interface ExportImage {
  bytes: Uint8Array;
  extension: ExportImageExtension;
}
