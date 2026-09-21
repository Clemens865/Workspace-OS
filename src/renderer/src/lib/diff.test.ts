import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff, diffStats } from './diff'

const SAMPLE = [
  'diff --git a/notes.md b/notes.md',
  'index 3b18e51..a042389 100644',
  '--- a/notes.md',
  '+++ b/notes.md',
  '@@ -1,3 +1,3 @@',
  ' # Notes',
  '-old line',
  '+new line',
  ' unchanged',
  'diff --git a/created.txt b/created.txt',
  'new file mode 100644',
  'index 0000000..8bd6648',
  '--- /dev/null',
  '+++ b/created.txt',
  '@@ -0,0 +1,2 @@',
  '+first',
  '+second',
  '\\ No newline at end of file',
].join('\n')

describe('parseUnifiedDiff', () => {
  it('splits files and classifies lines', () => {
    const files = parseUnifiedDiff(SAMPLE)
    expect(files.map((f) => f.path)).toEqual(['notes.md', 'created.txt'])

    const [modified, created] = files
    expect(modified.adds).toBe(1)
    expect(modified.dels).toBe(1)
    expect(modified.lines).toEqual([
      { kind: 'hunk', text: '@@ -1,3 +1,3 @@' },
      { kind: 'ctx', text: '# Notes' },
      { kind: 'del', text: 'old line' },
      { kind: 'add', text: 'new line' },
      { kind: 'ctx', text: 'unchanged' },
    ])

    expect(created.adds).toBe(2)
    expect(created.dels).toBe(0)
    // "\ No newline" marker renders as context, never a phantom del/add.
    expect(created.lines.at(-1)).toEqual({ kind: 'ctx', text: '\\ No newline at end of file' })
  })

  it('keeps metadata lines (index/mode) out of the hunk body', () => {
    const files = parseUnifiedDiff(SAMPLE)
    for (const f of files) {
      expect(f.lines.some((l) => l.text.startsWith('index '))).toBe(false)
      expect(f.lines.some((l) => l.text.startsWith('+++'))).toBe(false)
    }
  })

  it('flags binary files', () => {
    const files = parseUnifiedDiff(
      'diff --git a/logo.png b/logo.png\nindex 1111111..2222222 100644\nBinary files a/logo.png and b/logo.png differ\n'
    )
    expect(files).toHaveLength(1)
    expect(files[0].binary).toBe(true)
    expect(files[0].lines).toHaveLength(0)
  })

  it('handles the empty diff (no changes since checkpoint)', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('sums stats across files', () => {
    expect(diffStats(parseUnifiedDiff(SAMPLE))).toEqual({ files: 2, adds: 3, dels: 1 })
  })
})
