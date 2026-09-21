import { useEffect, useState } from 'react'
import styles from './NameBox.module.css'

interface Props {
  /** The active cell (A1) or the selection, as the engine reports it. */
  address: string
  /** Enter: an address jumps, a known name selects, a new name names the selection. */
  onSubmit: (text: string) => void
}

/** The name box left of the formula bar — Excel's, with the same three behaviours. */
export function NameBox({ address, onSubmit }: Props): JSX.Element {
  const [text, setText] = useState(address)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setText(address) }, [address, editing])
  return (
    <input
      className={styles.box}
      data-testid="name-box"
      value={text}
      title="Name box: type a cell (B5), a range (A1:C3) or a name; a new name names the selection"
      spellCheck={false}
      onFocus={(e) => { setEditing(true); e.target.select() }}
      onBlur={() => { setEditing(false); setText(address) }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { const t = text.trim(); if (t) onSubmit(t); (e.target as HTMLInputElement).blur() }
        else if (e.key === 'Escape') { setText(address); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}
