import { useEffect, useRef, useState } from 'react'
import styles from './SpecialCharDialog.module.css'

/** Curated BMP symbol sets (each char inserts via a single key event). */
const CATEGORIES: { name: string; chars: string }[] = [
  { name: 'Common', chars: '© ® ™ ° § ¶ • … † ‡ € £ ¥ ½ ¼ ¾ × ÷ ± ≈ ≠ ≤ ≥ → ← ↑ ↓' },
  { name: 'Currency', chars: '$ € £ ¥ ¢ ₹ ₽ ₩ ₪ ₺ ฿ ₴ ₦ ₡ ₫ ₱ ₲ ₵ ₸ ₼' },
  { name: 'Arrows', chars: '← → ↑ ↓ ↔ ↕ ⇐ ⇒ ⇔ ⇑ ⇓ ↩ ↪ ➜ ➤ ▲ ▼ ◀ ▶ ↻ ↺ ⤴ ⤵' },
  { name: 'Math', chars: '+ − × ÷ = ≠ ≈ ≡ ≤ ≥ ± ∓ ∞ √ ∛ ∑ ∏ ∫ ∂ ∆ ∇ π µ ∈ ∉ ⊂ ⊃ ∩ ∪ ∧ ∨ ¬' },
  { name: 'Punctuation', chars: '… — – ‐ ‘ ’ “ ” ‚ „ « » ‹ › ¡ ¿ § ¶ · • ※ ⁂' },
  { name: 'Greek', chars: 'α β γ δ ε ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ φ χ ψ ω Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω' },
  { name: 'Symbols', chars: '★ ☆ ♥ ♦ ♣ ♠ ✓ ✔ ✗ ✘ ☑ ☐ ☺ ☹ ♪ ♫ ⚠ ☀ ☁ ☂ ❄ ⌘ ⌥ ⇧ ⏎ ⌫ ✦ ✧ ❖' },
]

interface SpecialCharDialogProps {
  onInsert: (char: string) => void
  onClose: () => void
}

/** Native replacement for LibreOffice's Insert Special Character dialog.
 * Clicking a glyph inserts it at the cursor and keeps the picker open. */
export function SpecialCharDialog({ onInsert, onClose }: SpecialCharDialogProps): JSX.Element {
  const [catIdx, setCatIdx] = useState(0)
  const [last, setLast] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const glyphs = CATEGORIES[catIdx].chars.split(' ').filter(Boolean)

  useEffect(() => {
    modalRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = (g: string): void => { onInsert(g); setLast(g) }

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.modal} ref={modalRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Insert special character</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.cats}>
          {CATEGORIES.map((c, i) => (
            <button
              key={c.name}
              className={i === catIdx ? `${styles.cat} ${styles.catOn}` : styles.cat}
              onClick={() => setCatIdx(i)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className={styles.grid}>
          {glyphs.map((g, i) => (
            <button key={i} className={styles.glyph} title={`U+${g.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`} onClick={() => pick(g)}>
              {g}
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>
            {last ? <>Inserted <b className={styles.lastGlyph}>{last}</b> — pick more or close.</> : 'Click a character to insert it at the cursor.'}
          </span>
          <button className={styles.btnPrimary} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
