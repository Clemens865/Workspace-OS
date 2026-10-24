/**
 * A file:// URL for a local path, in the renderer (no Node `url` module).
 * `file://${path}` breaks on Windows: C:\x\logo.png must become file:///C:/x/logo.png.
 */
export function fileUrl(p: string): string {
  const slashed = p.replace(/\\/g, '/')
  const rooted = slashed.startsWith('/') ? slashed : `/${slashed}`
  return 'file://' + encodeURI(rooted).replace(/#/g, '%23').replace(/\?/g, '%3F')
}
