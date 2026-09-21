export type RendererType =
  | 'monaco'
  | 'html'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'csv'
  | 'office'
  | 'whiteboard'
  | 'hex'

const EXT_RENDERER: Record<string, RendererType> = {
  // Infinite/open canvas — MIT tldraw SDK
  wcanvas: 'whiteboard',

  // Office — native LibreOfficeKit view + editing (Docker-free)
  docx: 'office', doc: 'office', odt: 'office',
  xlsx: 'office', xls: 'office', ods: 'office',
  pptx: 'office', ppt: 'office', odp: 'office',

  // Documents
  pdf: 'pdf',

  // Code / text — Monaco
  ts: 'monaco', tsx: 'monaco', js: 'monaco', jsx: 'monaco',
  py: 'monaco', rs: 'monaco', go: 'monaco', java: 'monaco',
  cpp: 'monaco', c: 'monaco', h: 'monaco',
  md: 'monaco', txt: 'monaco', json: 'monaco',
  yaml: 'monaco', yml: 'monaco', toml: 'monaco',
  html: 'html', htm: 'html', css: 'monaco', scss: 'monaco',
  sh: 'monaco', bash: 'monaco', zsh: 'monaco', sql: 'monaco',
  xml: 'monaco', ini: 'monaco', env: 'monaco',

  // CSV/TSV — the real spreadsheet. Opened in Calc with a sniffed delimiter
  // token (see csvSniff.ts), so semicolon/decimal-comma German-locale exports
  // split correctly and save back in their own dialect. The lightweight
  // CsvRenderer remains in the tree as the intended fallback for giant files
  // once size-aware routing exists (needs an fs:stat IPC).
  csv: 'office', tsv: 'office',

  // Images
  png: 'image', jpg: 'image', jpeg: 'image',
  gif: 'image', svg: 'image', webp: 'image', ico: 'image',
  bmp: 'image', tiff: 'image',

  // Video
  mp4: 'video', mov: 'video', webm: 'video',
  avi: 'video', mkv: 'video', m4v: 'video',

  // Audio
  mp3: 'audio', wav: 'audio', flac: 'audio',
  aac: 'audio', ogg: 'audio', m4a: 'audio',
}

export function routeFile(filePath: string): RendererType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_RENDERER[ext] ?? 'hex'
}

export function getMonacoLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const MAP: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go',
    java: 'java', cpp: 'cpp', c: 'c', h: 'c',
    md: 'markdown', json: 'json',
    yaml: 'yaml', yml: 'yaml', toml: 'toml',
    html: 'html', css: 'css', scss: 'scss',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    sql: 'sql', xml: 'xml',
  }
  return MAP[ext] ?? 'plaintext'
}
