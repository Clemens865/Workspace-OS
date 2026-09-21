/**
 * Wraps IPC-transferred bytes in a Blob with the given MIME type.
 * Copies into a fresh ArrayBuffer-backed view so the Blob part is typed
 * concretely (the raw IPC Uint8Array is ArrayBufferLike, which BlobPart rejects).
 */
export function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer], { type: mimeType })
}
