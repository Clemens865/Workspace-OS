/**
 * Impress outline view model: one title and one body per slide, read and
 * written through WosSlideText. Body paragraphs travel tab-separated (a tab
 * cannot occur in outliner text the way a newline can), and '|' is folded to
 * '/' by the macro since it is the field separator.
 */

export interface SlideText {
  index: number
  title: string
  /** Body paragraphs (bullets). */
  body: string[]
}

export function parseSlideText(raw: string): SlideText[] {
  return raw.split('\n').filter((l) => /^\d+\|/.test(l)).map((l) => {
    const i = l.indexOf('|'), j = l.indexOf('|', i + 1)
    const title = j < 0 ? l.slice(i + 1) : l.slice(i + 1, j)
    const body = j < 0 ? '' : l.slice(j + 1)
    return { index: Number(l.slice(0, i)), title: title.trim(), body: body.split('\t').map((s) => s.trim()).filter(Boolean) }
  })
}

/** The 'set' op for one slide; separators are stripped from the text. */
export function slideTextSetArgs(index: number, title: string, body: string[]): string {
  const clean = (s: string): string => s.replace(/[|\t\r\n]/g, ' ').trim()
  return `set|${index}|${clean(title)}|${body.map(clean).filter(Boolean).join('\t')}`
}
