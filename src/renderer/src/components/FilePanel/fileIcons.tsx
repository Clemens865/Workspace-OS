import { Folder, FolderOpen } from 'lucide-react'

/**
 * Brand file-type icons ported from the Claude Design reference — a document
 * shape with a folded corner and a type glyph (Word "W", Excel "X", etc.).
 * Scannable by shape + color, matching real office apps.
 */

type IconKind =
  | 'word' | 'excel' | 'ppt' | 'pdf' | 'img' | 'video' | 'audio'
  | 'code' | 'md' | 'csv' | 'json' | 'generic'

const EXT_KIND: Record<string, IconKind> = {
  docx: 'word', doc: 'word', odt: 'word',
  xlsx: 'excel', xls: 'excel', ods: 'excel',
  pptx: 'ppt', ppt: 'ppt', odp: 'ppt',
  pdf: 'pdf',
  png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', svg: 'img', webp: 'img', ico: 'img',
  mp4: 'video', mov: 'video', webm: 'video', avi: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code', html: 'code', css: 'code', sh: 'code',
  md: 'md', txt: 'md',
  csv: 'csv', tsv: 'csv',
  json: 'json', yaml: 'json', yml: 'json', toml: 'json',
}

// Page body + folded corner shared by every type, parameterized by fill.
function Page({ fill, corner, children }: { fill: string; corner: string; children?: JSX.Element }): JSX.Element {
  return (
    <>
      <path d="M6 2.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1-1.5z" fill={fill} />
      <path d="M13.2 2.6 19 8.3h-4.4a1.4 1.4 0 0 1-1.4-1.4z" fill={corner} />
      {children}
    </>
  )
}

function letter(ch: string): JSX.Element {
  return (
    <text x="11.9" y="16.6" fontSize="7" fontWeight="800" fill="#fff" textAnchor="middle"
      fontFamily="-apple-system,Segoe UI,sans-serif">{ch}</text>
  )
}

const MARKS: Record<IconKind, JSX.Element> = {
  word: <Page fill="#2B579A" corner="#1B3F73">{letter('W')}</Page>,
  excel: <Page fill="#1E7145" corner="#13502F">{letter('X')}</Page>,
  ppt: <Page fill="#C43E1C" corner="#8F2C13">{letter('P')}</Page>,
  pdf: (
    <Page fill="#D7382B" corner="#9E2018">
      <text x="11.9" y="17.2" fontSize="5" fontWeight="800" fill="#fff" textAnchor="middle"
        fontFamily="-apple-system,Segoe UI,sans-serif" letterSpacing="-.3">PDF</text>
    </Page>
  ),
  img: (
    <Page fill="#7A48C9" corner="#542E91">
      <>
        <circle cx="9.2" cy="12.4" r="1.3" fill="#fff" />
        <path d="M7 18h9l-3.3-4-2.2 2.6-1.2-1.3z" fill="#fff" />
      </>
    </Page>
  ),
  video: <Page fill="#D6336C" corner="#9E2350"><path d="M10 11.5v5l4.2-2.5z" fill="#fff" /></Page>,
  audio: (
    <Page fill="#0E9488" corner="#09655D">
      <>
        <path d="M14.5 11v5.2" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="12.7" cy="16.4" r="1.5" fill="#fff" />
        <path d="M14.5 11l-3 .9" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
      </>
    </Page>
  ),
  code: (
    <Page fill="#3E6E9E" corner="#284C70">
      <path d="M10.3 11.5 8.5 14l1.8 2.5M13.7 11.5 15.5 14l-1.8 2.5" stroke="#fff" strokeWidth="1.3"
        fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Page>
  ),
  md: (
    <Page fill="#475569" corner="#2C3947">
      <>
        <path d="M7.5 16.5v-5l2 2.2 2-2.2v5" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
        <path d="M14.6 11.6v4.2M13 14.4l1.6 1.6 1.6-1.6" stroke="#fff" strokeWidth="1.2" fill="none"
          strokeLinecap="round" strokeLinejoin="round" />
      </>
    </Page>
  ),
  csv: (
    <Page fill="#2F9E5B" corner="#1C6B3C">
      <path d="M7.5 11.5h9M7.5 14h9M7.5 16.5h9M11 11.2v5.6" stroke="#fff" strokeWidth="1" opacity=".9" />
    </Page>
  ),
  json: (
    <Page fill="#C98A19" corner="#8F6210">
      <path d="M10.6 11c-1 0-1.4.5-1.4 1.4v.6c0 .6-.3.9-.9.9.6 0 .9.3.9.9v.6c0 .9.4 1.4 1.4 1.4M13.4 11c1 0 1.4.5 1.4 1.4v.6c0 .6.3.9.9.9-.6 0-.9.3-.9.9v.6c0 .9-.4 1.4-1.4 1.4"
        stroke="#fff" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Page>
  ),
  generic: <Page fill="#8B8B84" corner="#67675f" />,
}

interface FileIconProps {
  name: string
  isDirectory: boolean
  isExpanded?: boolean
  size?: number
}

export function FileIcon({ name, isDirectory, isExpanded, size = 17 }: FileIconProps): JSX.Element {
  if (isDirectory) {
    const Icon = isExpanded ? FolderOpen : Folder
    return <Icon size={size - 1} color="var(--fg-muted)" strokeWidth={1.9} />
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const kind = EXT_KIND[ext] ?? 'generic'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: 'none' }}>
      {MARKS[kind]}
    </svg>
  )
}
