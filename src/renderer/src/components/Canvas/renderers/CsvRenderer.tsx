import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import Papa from 'papaparse'
import { Plus, Trash2, ArrowUpDown } from 'lucide-react'
import { useFilePrint } from '../../../hooks/useFilePrint'
import { escapePrintText } from '../../../lib/printDocument'
import styles from './CsvRenderer.module.css'

interface CsvRendererProps {
  filePath: string
  onDirty?: (dirty: boolean) => void
  /** Registers a save callback for the toolbar Save button. */
  onSaveRegister?: (save: (() => void) | null) => void
}

type SortDir = 'asc' | 'desc' | null

export function CsvRenderer({ filePath, onDirty, onSaveRegister }: CsvRendererProps): JSX.Element {
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [filter, setFilter] = useState('')
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [error, setError] = useState<string | null>(null)

  useFilePrint(filePath, async () => {
    if (error) throw new Error(error)
    const cells = (row: string[], tag: 'th' | 'td'): string => row.map((c) => `<${tag}>${escapePrintText(c)}</${tag}>`).join('')
    const html = `<table><thead><tr>${cells(headers, 'th')}</tr></thead><tbody>${rows.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`
    await window.workspace.print.document(filePath.split('/').pop() ?? filePath, html)
  })

  useEffect(() => {
    setError(null)
    window.workspace.fs.readFile(filePath)
      .then((text: string) => {
        const result = Papa.parse<string[]>(text, { skipEmptyLines: true })
        const [head, ...body] = result.data
        setHeaders(head ?? [])
        setRows(body)
        onDirty?.(false)
      })
      .catch((e: Error) => setError(e.message))
  }, [filePath, onDirty])

  const markDirty = useCallback(() => onDirty?.(true), [onDirty])

  // --- Save (serialize back to CSV) + ⌘S + toolbar registration ---
  const save = useCallback(async () => {
    const csv = Papa.unparse([headers, ...rows])
    await window.workspace.fs.writeFile(filePath, csv)
    onDirty?.(false)
  }, [filePath, headers, rows, onDirty])

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    onSaveRegister?.(() => void saveRef.current())
    return () => onSaveRegister?.(null)
  }, [onSaveRegister])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // --- Edits ---
  const updateCell = useCallback((rowRef: string[], ci: number, value: string) => {
    setRows((prev) => {
      const idx = prev.indexOf(rowRef)
      if (idx === -1 || prev[idx][ci] === value) return prev
      const next = prev.slice()
      next[idx] = prev[idx].map((c, j) => (j === ci ? value : c))
      return next
    })
    markDirty()
  }, [markDirty])

  const updateHeader = useCallback((ci: number, value: string) => {
    setHeaders((prev) => (prev[ci] === value ? prev : prev.map((h, i) => (i === ci ? value : h))))
    markDirty()
  }, [markDirty])

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, new Array(Math.max(headers.length, 1)).fill('')])
    markDirty()
  }, [headers.length, markDirty])

  const addColumn = useCallback(() => {
    setHeaders((prev) => [...prev, `Column ${prev.length + 1}`])
    setRows((prev) => prev.map((r) => [...r, '']))
    markDirty()
  }, [markDirty])

  const deleteRow = useCallback((rowRef: string[]) => {
    setRows((prev) => prev.filter((r) => r !== rowRef))
    markDirty()
  }, [markDirty])

  const handleSort = (colIndex: number) => {
    if (sortCol === colIndex) {
      const nextDir: SortDir = sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? null : 'asc'
      setSortDir(nextDir)
      if (nextDir === null) setSortCol(null)
    } else {
      setSortCol(colIndex)
      setSortDir('asc')
    }
  }

  const displayed = useMemo(() => {
    let data = rows
    if (filter.trim()) {
      const q = filter.toLowerCase()
      data = data.filter((row) => row.some((cell) => (cell ?? '').toLowerCase().includes(q)))
    }
    if (sortCol !== null && sortDir) {
      data = [...data].sort((a, b) => {
        const av = a[sortCol] ?? ''
        const bv = b[sortCol] ?? ''
        const num = Number(av) - Number(bv)
        const cmp = isNaN(num) ? av.localeCompare(bv) : num
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return data
  }, [rows, filter, sortCol, sortDir])

  if (error) return <div className={styles.error}>Cannot open CSV: {error}</div>

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <input
          className={styles.filter}
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className={styles.opBtn} onClick={addColumn} title="Add column"><Plus size={13} /> Column</button>
        <button className={styles.opBtn} onClick={addRow} title="Add row"><Plus size={13} /> Row</button>
        <span className={styles.count}>{displayed.length} / {rows.length} rows</span>
      </div>

      {headers.length === 0 ? (
        <div className={styles.empty}>
          <p>Empty CSV.</p>
          <button className={styles.opBtn} onClick={addColumn}><Plus size={13} /> Add a column to start</button>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className={styles.th}>
                    <span
                      className={styles.cellEdit}
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => updateHeader(i, e.currentTarget.textContent ?? '')}
                    >
                      {h}
                    </span>
                    <button className={styles.sortBtn} onClick={() => handleSort(i)} title="Sort">
                      {sortCol === i ? (sortDir === 'asc' ? '↑' : '↓') : <ArrowUpDown size={11} />}
                    </button>
                  </th>
                ))}
                <th className={styles.actionTh} />
              </tr>
            </thead>
            <tbody>
              {displayed.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? styles.even : ''}>
                  {headers.map((_, ci) => (
                    <td
                      key={ci}
                      className={`${styles.td} ${styles.cellEdit}`}
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => updateCell(row, ci, e.currentTarget.textContent ?? '')}
                    >
                      {row[ci] ?? ''}
                    </td>
                  ))}
                  <td className={styles.actionTd}>
                    <button className={styles.delBtn} onClick={() => deleteRow(row)} title="Delete row">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
