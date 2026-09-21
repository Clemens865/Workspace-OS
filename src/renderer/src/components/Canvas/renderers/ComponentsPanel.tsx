import { memo, useState } from 'react'
import type { Component } from '../../../types/workspace-api'
import { ComponentPreview } from './ComponentPreview'
import styles from './ComponentsPanel.module.css'

export interface SelectedInstance {
  comp: Component
  fill: number
  text: string
  w: number
  h: number
}

interface Props {
  components: Component[]
  selected: SelectedInstance | null
  onInsert: (c: Component) => void
  onSave: (c: Partial<Component>) => void
  onDelete: (id: string) => void
  onUpdateInstance: (fields: { fill?: number; text?: string; w?: number; h?: number }) => void
  onCapture: () => Promise<{ w: number; h: number; elements: string[] } | null>
  onRefresh: () => void
  onClose: () => void
}

const decToHex = (v: number): string => '#' + Math.max(0, v).toString(16).padStart(6, '0').slice(-6)
const hexToDec = (h: string): number => parseInt(h.slice(1), 16)
const BASES: Component['base'][] = ['rect', 'roundrect', 'ellipse', 'text']
const TYPES: [Component['type'], string][] = [['shape', 'Shape'], ['card', 'Card (bg + title)'], ['media', 'Media (image + caption)'], ['block', 'Word block (text)'], ['range', 'Excel range (cells)']]
const BLOCK_KINDS: [Component['blockKind'], string][] = [['heading', 'Heading + body'], ['callout', 'Callout box'], ['quote', 'Quote'], ['signature', 'Signature']]
const RANGE_KINDS: [Component['rangeKind'], string][] = [['kpi', 'KPI card'], ['header', 'Header row'], ['table', 'Mini-table']]
const FILLKINDS: Component['fillKind'][] = ['solid', 'gradient', 'pattern']
const DASHES: Component['dash'][] = ['solid', 'dashed', 'dotted', 'dashdot']
const WIDTHS: [string, number][] = [['None', 0], ['Thin', 35], ['Medium', 100], ['Thick', 200]]
const DEFAULT_DRAFT: Partial<Component> = {
  name: 'Component', type: 'shape', blockKind: 'heading', rangeKind: 'kpi', variants: [], base: 'rect', fill: 5806300, fillKind: 'solid', gradTo: 14543051,
  line: 2050940, lineWidth: 0, dash: 'solid', fontColor: 0, text: '', body: '', image: '', w: 7000, h: 4500,
}

/** Framer-style component library + per-instance variable editor (Impress). */
// Memoized: the library panel only depends on the component list + selection.
export const ComponentsPanel = memo(function ComponentsPanel({ components, selected, onInsert, onSave, onDelete, onUpdateInstance, onCapture, onRefresh, onClose }: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Partial<Component>>(DEFAULT_DRAFT)
  const set = (f: Partial<Component>): void => setDraft((d) => ({ ...d, ...f }))
  const isShape = (draft.type ?? 'shape') === 'shape'
  const isCaptured = draft.type === 'captured'
  const isBlock = draft.type === 'block'
  const isRange = draft.type === 'range'
  const hasVariantUI = !isBlock && !isRange && !isCaptured // shape/card/media support variants

  const captureToForm = async (): Promise<void> => {
    const cap = await onCapture()
    if (!cap || cap.elements.length === 0) { window.alert('Select one or more shapes on the slide first.'); return }
    setDraft({ name: `Captured (${cap.elements.length})`, type: 'captured', elements: cap.elements, w: cap.w, h: cap.h })
    setCreating(true)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span>Components</span>
        <span>
          <button className={styles.x} onClick={onRefresh} title="Refresh (pick up agent-created components)">⟳</button>
          <button className={styles.x} onClick={onClose} title="Close">×</button>
        </span>
      </div>
      <div className={styles.hint}>Tip: in the shell/agent, “make a 3-step timeline component” generates one here.</div>

      {/* Selected instance — exposed variables */}
      {selected && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Instance · {selected.comp.name}</div>
          <label className={styles.row}><span>Fill</span>
            <input type="color" value={decToHex(selected.fill < 0 ? 0 : selected.fill)} onChange={(e) => onUpdateInstance({ fill: hexToDec(e.target.value) })} />
          </label>
          <label className={styles.row}><span>Text</span>
            <input type="text" value={selected.text} onChange={(e) => onUpdateInstance({ text: e.target.value })} />
          </label>
          <label className={styles.row}><span>Width</span>
            <input type="number" value={Math.round(selected.w / 100)} onChange={(e) => onUpdateInstance({ w: Math.max(1, Number(e.target.value)) * 100 })} /><span className={styles.unit}>mm</span>
          </label>
          <label className={styles.row}><span>Height</span>
            <input type="number" value={Math.round(selected.h / 100)} onChange={(e) => onUpdateInstance({ h: Math.max(1, Number(e.target.value)) * 100 })} /><span className={styles.unit}>mm</span>
          </label>
          {(selected.comp.variants?.length ?? 0) > 0 && (
            <div className={styles.row}>
              <span>Variant</span>
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {selected.comp.variants.map((v) => (
                  <button key={v.name} className={styles.ins} title={v.name} onClick={() => onUpdateInstance({ fill: v.fill })} style={{ background: decToHex(v.fill), color: '#fff', border: '1px solid var(--color-border)' }}>{v.name}</button>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Library */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Library</div>
        {components.length === 0 && <div className={styles.empty}>No components yet.</div>}
        {components.map((c) => (
          <div key={c.id} className={styles.libItem}>
            <div className={styles.thumb}><ComponentPreview comp={c} width={40} height={28} /></div>
            <span className={styles.libName} title={`${c.type} · ${Math.round(c.w / 100)}×${Math.round(c.h / 100)}mm`}>{c.name}</span>
            <button className={styles.ins} onClick={() => onInsert(c)} title="Insert instance">Insert</button>
            <button className={styles.del} onClick={() => { setDraft(c); setCreating(true) }} title="Edit master (pushes to instances on save)">✎</button>
            <button className={styles.del} onClick={() => onDelete(c.id)} title="Delete component">×</button>
          </div>
        ))}
      </div>

      {/* New component */}
      <div className={styles.section}>
        {!creating ? (
          <>
            <button className={styles.newBtn} onClick={() => { setDraft(DEFAULT_DRAFT); setCreating(true) }}>＋ New component</button>
            <button className={styles.newBtn} style={{ marginTop: 6 }} onClick={() => void captureToForm()}>⊞ Create from selection</button>
          </>
        ) : (
          <div className={styles.form}>
            <div className={styles.preview}><ComponentPreview comp={draft} /></div>
            <label className={styles.row}><span>Name</span>
              <input type="text" value={draft.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
            </label>
            {isCaptured && <div className={styles.empty}>Captured {draft.elements?.length ?? 0} element(s) — name it and save.</div>}
            {!isCaptured && (
            <>
            <label className={styles.row}><span>Type</span>
              <select value={draft.type} onChange={(e) => set({ type: e.target.value as Component['type'] })}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            {isBlock && (
              <>
                <div className={styles.empty}>Inserts into a Word document at the cursor.</div>
                <label className={styles.row}><span>Block</span>
                  <select value={draft.blockKind} onChange={(e) => set({ blockKind: e.target.value as Component['blockKind'] })}>
                    {BLOCK_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className={styles.row}><span>{draft.blockKind === 'quote' ? 'Author' : draft.blockKind === 'signature' ? 'Name' : 'Title'}</span>
                  <input type="text" value={draft.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
                </label>
                <label className={styles.row}><span>Body</span>
                  <input type="text" value={draft.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
                </label>
                {draft.blockKind === 'callout' && (
                  <label className={styles.row}><span>Fill</span>
                    <input type="color" value={decToHex(draft.fill ?? 15658734)} onChange={(e) => set({ fill: hexToDec(e.target.value) })} />
                  </label>
                )}
              </>
            )}
            {isRange && (
              <>
                <div className={styles.empty}>Stamps formatted cells into Excel at the selected cell.</div>
                <label className={styles.row}><span>Kind</span>
                  <select value={draft.rangeKind} onChange={(e) => set({ rangeKind: e.target.value as Component['rangeKind'] })}>
                    {RANGE_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className={styles.row}><span>{draft.rangeKind === 'kpi' ? 'Label' : 'Title'}</span>
                  <input type="text" value={draft.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
                </label>
                <label className={styles.row}><span>{draft.rangeKind === 'kpi' ? 'Value' : 'Cell 2'}</span>
                  <input type="text" value={draft.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
                </label>
                <label className={styles.row}><span>Fill</span>
                  <input type="color" value={decToHex(draft.fill ?? 1810836)} onChange={(e) => set({ fill: hexToDec(e.target.value) })} />
                </label>
              </>
            )}
            {!isBlock && !isRange && (
            <>
            {isShape && (
              <label className={styles.row}><span>Base</span>
                <select value={draft.base} onChange={(e) => set({ base: e.target.value as Component['base'] })}>
                  {BASES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            )}
            <label className={styles.row}><span>Fill</span>
              <input type="color" value={decToHex(draft.fill ?? 5806300)} onChange={(e) => set({ fill: hexToDec(e.target.value) })} />
              {isShape && (
                <select value={draft.fillKind} onChange={(e) => set({ fillKind: e.target.value as Component['fillKind'] })}>
                  {FILLKINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
            </label>
            {isShape && draft.fillKind === 'gradient' && (
              <label className={styles.row}><span>Grad→</span>
                <input type="color" value={decToHex(draft.gradTo ?? 14543051)} onChange={(e) => set({ gradTo: hexToDec(e.target.value) })} />
              </label>
            )}
            {isShape && (
              <label className={styles.row}><span>Outline</span>
                <input type="color" value={decToHex(draft.line ?? 2050940)} onChange={(e) => set({ line: hexToDec(e.target.value) })} />
                <select value={draft.lineWidth} onChange={(e) => set({ lineWidth: Number(e.target.value) })}>
                  {WIDTHS.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
                </select>
                <select value={draft.dash} onChange={(e) => set({ dash: e.target.value as Component['dash'] })}>
                  {DASHES.map((dd) => <option key={dd} value={dd}>{dd}</option>)}
                </select>
              </label>
            )}
            <label className={styles.row}><span>{draft.type === 'media' ? 'Caption' : 'Text'}</span>
              <input type="text" value={draft.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
            </label>
            <label className={styles.row}><span>Font</span>
              <input type="color" value={decToHex(draft.fontColor ?? 0)} onChange={(e) => set({ fontColor: hexToDec(e.target.value) })} />
            </label>
            {draft.type === 'media' && (
              <label className={styles.row}><span>Image</span>
                <button className={styles.cancel} onClick={async () => { const p = await window.workspace.lok.pickImage(); if (p) set({ image: p }) }}>{draft.image ? '✓ chosen' : 'Choose…'}</button>
              </label>
            )}
            <label className={styles.row}><span>W</span>
              <input type="number" value={Math.round((draft.w ?? 7000) / 100)} onChange={(e) => set({ w: Math.max(1, Number(e.target.value)) * 100 })} /><span className={styles.unit}>mm</span>
            </label>
            <label className={styles.row}><span>H</span>
              <input type="number" value={Math.round((draft.h ?? 4500) / 100)} onChange={(e) => set({ h: Math.max(1, Number(e.target.value)) * 100 })} /><span className={styles.unit}>mm</span>
            </label>
            {hasVariantUI && (
              <div className={styles.section} style={{ padding: '6px 0', borderBottom: 'none' }}>
                <div className={styles.sectionTitle}>Variants (instance states)</div>
                {(draft.variants ?? []).map((v, i) => (
                  <div key={i} className={styles.row}>
                    <input type="text" value={v.name} onChange={(e) => set({ variants: (draft.variants ?? []).map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                    <input type="color" value={decToHex(v.fill)} onChange={(e) => set({ variants: (draft.variants ?? []).map((x, j) => j === i ? { ...x, fill: hexToDec(e.target.value) } : x) })} />
                    <button className={styles.del} title="Remove" onClick={() => set({ variants: (draft.variants ?? []).filter((_, j) => j !== i) })}>×</button>
                  </div>
                ))}
                <button className={styles.newBtn} onClick={() => set({ variants: [...(draft.variants ?? []), { name: `State ${(draft.variants ?? []).length + 1}`, fill: draft.fill ?? 5806300, fontColor: draft.fontColor ?? 0 }] })}>＋ Add variant</button>
              </div>
            )}
            </>
            )}
            </>
            )}
            <div className={styles.formBtns}>
              <button className={styles.save} onClick={() => { onSave(draft); setCreating(false); setDraft(DEFAULT_DRAFT) }}>Save</button>
              <button className={styles.cancel} onClick={() => { setCreating(false); setDraft(DEFAULT_DRAFT) }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
