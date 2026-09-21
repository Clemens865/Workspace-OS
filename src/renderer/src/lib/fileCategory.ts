export type FileCategory =
  | 'document' | 'spreadsheet' | 'presentation' | 'pdf'
  | 'image' | 'video' | 'audio' | 'code' | 'text' | 'data' | 'canvas' | 'unknown'

const EXT_CATEGORY: Record<string, FileCategory> = {
  docx: 'document', doc: 'document', odt: 'document',
  xlsx: 'spreadsheet', xls: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet', tsv: 'spreadsheet',
  pptx: 'presentation', ppt: 'presentation', odp: 'presentation',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image', bmp: 'image',
  mp4: 'video', mov: 'video', webm: 'video', avi: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code', rs: 'code', go: 'code',
  java: 'code', cpp: 'code', c: 'code', h: 'code', html: 'code', css: 'code', scss: 'code',
  sh: 'code', bash: 'code', sql: 'code', xml: 'code',
  json: 'data', yaml: 'data', yml: 'data', toml: 'data',
  md: 'text', txt: 'text',
  wcanvas: 'canvas',
}

export function categoryOf(filePath: string): FileCategory {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_CATEGORY[ext] ?? 'unknown'
}

/** Categories whose content the app can edit and save in place. */
export const EDITABLE: ReadonlySet<FileCategory> = new Set(['code', 'text', 'data'])

/** Categories the app can send to the OS print pipeline. */
export const PRINTABLE: ReadonlySet<FileCategory> = new Set(['document', 'spreadsheet', 'presentation', 'pdf', 'text', 'data', 'code'])

/** Office categories handled by the document engine (export/convert capable). */
export const OFFICE: ReadonlySet<FileCategory> = new Set(['document', 'spreadsheet', 'presentation'])
