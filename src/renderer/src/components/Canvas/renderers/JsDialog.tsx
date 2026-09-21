import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { cleanText, isMessageBox, isPopup, responseIds, type JsDialogState, type JsWidget } from './jsdialogModel'
import styles from './JsDialog.module.css'

export interface JsDialogEvent {
  control: string
  cmd: string
  type: string
  data?: string
}

interface Props {
  state: JsDialogState
  onEvent: (ev: JsDialogEvent) => void
  onClose: () => void
  /** Where a popup opens (client px) — the point the user clicked, e.g. the AutoFilter arrow. */
  anchor?: { x: number; y: number } | null
}

/**
 * Renders one engine dialog from its JSDialog tree with our own widgets.
 *
 * Every LibreOffice dialog that reaches us this way — Sort, Format Cells,
 * Page Style, Validity, Paragraph, Character, Table Properties, … — is a tree
 * of a few dozen widget kinds. Each kind maps to a native control here and
 * reports back with the event the engine's executor expects (see
 * vcl/jsdialog/executor.cxx): buttons `click`, checkboxes/radios `change`,
 * lists `selected` with `index;text`, entries `change`, spin fields `value`,
 * tabs `selecttab`. The engine answers with `update` / `action` messages that
 * the owner folds into `state`, so what we show is always what it holds.
 */
export function JsDialog({ state, onEvent, onClose, anchor }: Props): JSX.Element {
  const responses = responseIds(state)
  const ref = useRef<HTMLDivElement>(null)
  const popup = isPopup(state)
  const messageBox = isMessageBox(state)

  // Escape closes; the engine's own close (Cancel) comes back as a `close` message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        if (isPopup(state)) { onEvent({ control: '__POPUPS__', cmd: 'closeall', type: 'popup' }); return }
        onEvent({ control: '__DIALOG__', cmd: 'close', type: 'dialog' }); onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onEvent, onClose])

  useEffect(() => {
    if (!state.initFocus) return
    const el = ref.current?.querySelector<HTMLElement>(`[data-wid="${CSS.escape(state.initFocus)}"]`)
    el?.focus()
  }, [state.initFocus, state.id])

  // A message box ignores JSON response events; its window takes Enter (the
  // default: Yes / OK) or Escape (No / Cancel) instead. Buttons map to those.
  const send = (ev: JsDialogEvent): void => {
    if (messageBox && ev.type === 'responsebutton') {
      const yes = /^(yes|ok|save|retry)$/i.test(ev.control)
      onEvent({ control: '__KEY__', cmd: yes ? 'enter' : 'escape', type: 'messagebox' })
      onClose()
      return
    }
    onEvent(ev)
  }

  const popupStyle = popup && anchor ? { left: Math.max(4, Math.min(anchor.x, window.innerWidth - 380)), top: Math.max(4, Math.min(anchor.y, window.innerHeight - 320)) } : undefined
  const body = (
    <div
      ref={ref}
      className={`${styles.dialog} ${popup ? styles.popup : ''}`}
      style={popupStyle}
      data-testid="jsdialog"
      data-dialogid={state.dialogid ?? ''}
      role="dialog"
      aria-label={state.title}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!popup && (
        <div className={styles.titlebar}>
          <span className={styles.title}>{state.title}</span>
          <button className={styles.close} title="Close" onClick={() => { send({ control: '__DIALOG__', cmd: 'close', type: 'dialog' }); onClose() }}><X size={14} /></button>
        </div>
      )}
      <div className={styles.body}>
        {(state.root.children ?? []).map((c, i) => <Widget key={c.id || i} w={c} send={send} responses={responses} />)}
      </div>
    </div>
  )
  if (popup) {
    // Click outside closes the popup (the engine's cancellable flag).
    return (
      <div className={styles.popupBackdrop} onMouseDown={() => onEvent({ control: '__POPUPS__', cmd: 'closeall', type: 'popup' })}>
        {body}
      </div>
    )
  }
  return <div className={styles.backdrop}>{body}</div>
}

interface WProps {
  w: JsWidget
  send: (ev: JsDialogEvent) => void
  responses: Set<string>
}

function gridPlacement(w: JsWidget): CSSProperties | undefined {
  const left = Number(w.left), top = Number(w.top)
  if (!Number.isFinite(left) || !Number.isFinite(top) || w.left === undefined) return undefined
  const width = Math.max(1, Number(w.width) || 1), height = Math.max(1, Number(w.height) || 1)
  return { gridColumn: `${left + 1} / span ${width}`, gridRow: `${top + 1} / span ${height}` }
}

function Children({ w, send, responses }: WProps): JSX.Element {
  return <>{(w.children ?? []).map((c, i) => <Widget key={c.id || i} w={c} send={send} responses={responses} />)}</>
}

/** One widget → one control (or a layout box) — see the file header for the event contract. */
export function Widget({ w, send, responses }: WProps): JSX.Element | null {
  if (w.visible === false) return null
  const disabled = w.enabled === false
  const place = gridPlacement(w)
  const wid = w.id

  switch (w.type) {
    case 'dialog':
    case 'container':
    case 'tabpage':
    case 'window':
    case 'dockingwindow':
    case 'borderwindow':
    case 'control':
    case 'expander':
    case 'scrollbarbox':
      return <div className={w.vertical === true || w.vertical === 'true' ? styles.vbox : styles.hbox} style={place}><Children w={w} send={send} responses={responses} /></div>
    case 'scrollwindow':
    case 'scrolledwindow':
      return <div className={styles.scroll} style={place}><Children w={w} send={send} responses={responses} /></div>
    case 'scrollbar':
    case 'toolbox':
    case 'headerbar':
      return null
    case 'messagebox':
    case 'modalpopup':
      return <div className={styles.vbox} style={place}><Children w={w} send={send} responses={responses} /></div>
    case 'grid':
      return <div className={styles.grid} style={place}><Children w={w} send={send} responses={responses} /></div>
    case 'frame': {
      const kids = w.children ?? []
      const legend = kids[0]?.type === 'fixedtext' ? cleanText(kids[0].text) : ''
      const rest = legend ? kids.slice(1) : kids
      return (
        <fieldset className={styles.frame} style={place}>
          {legend && <legend className={styles.legend}>{legend}</legend>}
          {rest.map((c, i) => <Widget key={c.id || i} w={c} send={send} responses={responses} />)}
        </fieldset>
      )
    }
    case 'separator':
      return <hr className={styles.sep} style={place} />
    case 'fixedtext':
      return <label className={styles.label} style={place} htmlFor={typeof w.labelFor === 'string' ? `jsd-${w.labelFor}` : undefined}>{cleanText(w.text)}</label>
    case 'tabcontrol':
      return <TabControl w={w} send={send} responses={responses} place={place} />
    case 'buttonbox':
      return <div className={styles.buttonbox} style={place}><Children w={w} send={send} responses={responses} /></div>
    case 'pushbutton':
    case 'menubutton':
    case 'linkbutton': {
      // Inside list widgets the engine emits a decorative spin button — skip it.
      if (typeof w.symbol === 'string' && !w.text) return null
      const isResponse = responses.has(wid)
      const primary = w.has_default === true || w.has_default === 'true' || wid === 'ok'
      return (
        <button
          className={`${styles.button} ${primary ? styles.primary : ''}`}
          style={place}
          disabled={disabled}
          data-wid={wid}
          onClick={() => send({ control: wid, cmd: 'click', type: isResponse ? 'responsebutton' : w.type === 'linkbutton' ? 'linkbutton' : 'pushbutton' })}
        >
          {cleanText(w.text) || cleanText(String(w.symbol ?? ''))}
        </button>
      )
    }
    case 'checkbox':
      return (
        <label className={styles.check} style={place}>
          <input type="checkbox" data-wid={wid} id={`jsd-${wid}`} disabled={disabled} checked={!!w.checked}
            onChange={(e) => send({ control: wid, cmd: 'change', type: 'checkbox', data: e.target.checked ? 'true' : 'false' })} />
          <span>{cleanText(w.text)}</span>
        </label>
      )
    case 'radiobutton':
      return (
        <label className={styles.check} style={place}>
          <input type="radio" data-wid={wid} id={`jsd-${wid}`} name={String(w.group ?? wid)} disabled={disabled} checked={!!w.checked}
            onChange={() => send({ control: wid, cmd: 'change', type: 'radiobutton', data: 'true' })} />
          <span>{cleanText(w.text)}</span>
        </label>
      )
    case 'edit':
      return <TextEntry w={w} send={send} place={place} multiline={false} />
    case 'multilineedit':
      return <TextEntry w={w} send={send} place={place} multiline />
    case 'spinfield':
    case 'formattedfield':
      return <SpinField w={w} send={send} place={place} />
    case 'listbox':
      return <ListBox w={w} send={send} place={place} />
    case 'combobox':
      return <ComboBox w={w} send={send} place={place} />
    case 'treelistbox':
    case 'treeview':
      return <TreeView w={w} send={send} place={place} />
    case 'iconview':
      return <IconView w={w} send={send} place={place} />
    case 'image':
    case 'drawingarea': {
      const src = typeof w.image === 'string' ? w.image : ''
      if (!src) return <div className={styles.drawing} style={place} data-wid={wid} />
      return (
        <img className={styles.drawing} style={place} data-wid={wid} src={src.startsWith('data:') ? src : `data:image/png;base64,${src}`} alt=""
          onClick={(e) => {
            const r = (e.target as HTMLImageElement).getBoundingClientRect()
            send({ control: wid, cmd: 'click', type: 'drawingarea', data: `${Math.round(e.clientX - r.left)};${Math.round(e.clientY - r.top)}` })
          }} />
      )
    }
    default:
      return w.children ? <div className={styles.vbox} style={place}><Children w={w} send={send} responses={responses} /></div> : null
  }
}

function TabControl({ w, send, responses, place }: WProps & { place?: CSSProperties }): JSX.Element {
  const tabs = Array.isArray(w.tabs) ? (w.tabs as { text?: string; id?: string }[]) : []
  const engineSel = Number(w.selected) || 0
  const [sel, setSel] = useState(engineSel)
  useEffect(() => setSel(engineSel), [engineSel])
  const pages = w.children ?? []
  return (
    <div className={styles.tabs} style={place}>
      <div className={styles.tabstrip} role="tablist">
        {tabs.map((t, i) => (
          <button key={t.id ?? i} role="tab" aria-selected={sel === i} className={`${styles.tab} ${sel === i ? styles.tabOn : ''}`}
            onClick={() => { setSel(i); send({ control: w.id, cmd: 'selecttab', type: 'tabcontrol', data: String(i) }) }}>
            {cleanText(t.text)}
          </button>
        ))}
      </div>
      <div className={styles.tabpage}>
        {/* Inactive pages arrive with visible:false and a tab switch only updates
            the widgets inside them — the selected page is shown regardless. */}
        {pages[sel] && <Widget w={{ ...pages[sel], visible: true }} send={send} responses={responses} />}
      </div>
    </div>
  )
}

function TextEntry({ w, send, place, multiline }: { w: JsWidget; send: (e: JsDialogEvent) => void; place?: CSSProperties; multiline: boolean }): JSX.Element {
  const engineText = typeof w.text === 'string' ? w.text : ''
  const [text, setText] = useState(engineText)
  useEffect(() => setText(engineText), [engineText])
  const commit = (): void => { if (text !== engineText) send({ control: w.id, cmd: 'change', type: 'edit', data: text }) }
  const common = {
    'data-wid': w.id, id: `jsd-${w.id}`, disabled: w.enabled === false, value: text, style: place,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: commit,
  }
  if (multiline) return <textarea className={styles.textarea} rows={4} {...common} />
  return <input className={styles.input} type="text" {...common} onKeyDown={(e) => { if (e.key === 'Enter') { commit(); send({ control: w.id, cmd: 'activate', type: 'edit' }) } }} />
}

function SpinField({ w, send, place }: { w: JsWidget; send: (e: JsDialogEvent) => void; place?: CSSProperties }): JSX.Element {
  const engineText = typeof w.text === 'string' ? w.text : String(w.value ?? '')
  const [text, setText] = useState(engineText)
  useEffect(() => setText(engineText), [engineText])
  const commit = (): void => {
    if (text === engineText) return
    if (w.type === 'formattedfield') send({ control: w.id, cmd: 'change', type: 'formattedfield', data: text })
    else send({ control: w.id, cmd: 'value', type: 'spinfield', data: text })
  }
  const step = (d: number): void => send({ control: w.id, cmd: d > 0 ? 'plus' : 'minus', type: 'spinfield' })
  return (
    <div className={styles.spin} style={place}>
      <input className={styles.input} data-wid={w.id} id={`jsd-${w.id}`} disabled={w.enabled === false} value={text}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'ArrowUp') { e.preventDefault(); step(1) } else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1) } }} />
      <button className={styles.spinBtn} tabIndex={-1} disabled={w.enabled === false} onClick={() => step(1)} title="Increase">▲</button>
      <button className={styles.spinBtn} tabIndex={-1} disabled={w.enabled === false} onClick={() => step(-1)} title="Decrease">▼</button>
    </div>
  )
}

function entriesOf(w: JsWidget): string[] {
  if (!Array.isArray(w.entries)) return []
  return (w.entries as unknown[]).map((e) => (typeof e === 'string' ? e : typeof e === 'object' && e ? String((e as Record<string, unknown>).text ?? '') : String(e)))
}

function ListBox({ w, send, place }: { w: JsWidget; send: (e: JsDialogEvent) => void; place?: CSSProperties }): JSX.Element {
  const entries = entriesOf(w)
  const sel = Array.isArray(w.selectedEntries) && w.selectedEntries.length ? Number((w.selectedEntries as unknown[])[0]) : -1
  return (
    <select className={styles.select} style={place} data-wid={w.id} id={`jsd-${w.id}`} disabled={w.enabled === false} value={sel >= 0 ? String(sel) : ''}
      onChange={(e) => { const i = Number(e.target.value); send({ control: w.id, cmd: 'selected', type: 'combobox', data: `${i};${entries[i] ?? ''}` }) }}>
      {sel < 0 && <option value="" />}
      {entries.map((t, i) => <option key={i} value={String(i)}>{cleanText(t)}</option>)}
    </select>
  )
}

function ComboBox({ w, send, place }: { w: JsWidget; send: (e: JsDialogEvent) => void; place?: CSSProperties }): JSX.Element {
  const entries = entriesOf(w)
  const engineText = typeof w.text === 'string' ? w.text : ''
  const [text, setText] = useState(engineText)
  useEffect(() => setText(engineText), [engineText])
  const listId = `jsd-list-${w.id}`
  return (
    <div className={styles.combo} style={place}>
      <input className={styles.input} list={listId} data-wid={w.id} id={`jsd-${w.id}`} disabled={w.enabled === false} value={text}
        onChange={(e) => {
          setText(e.target.value)
          const i = entries.indexOf(e.target.value)
          if (i >= 0) send({ control: w.id, cmd: 'selected', type: 'combobox', data: `${i};${e.target.value}` })
        }}
        onBlur={() => { if (text !== engineText && !entries.includes(text)) send({ control: w.id, cmd: 'change', type: 'combobox', data: text }) }} />
      <datalist id={listId}>{entries.map((t, i) => <option key={i} value={t} />)}</datalist>
    </div>
  )
}

interface TreeEntry { row?: number | string; text?: string; columns?: { text?: string }[]; children?: TreeEntry[]; selected?: boolean | string; state?: boolean | string }

function TreeView({ w, send, place }: { w: JsWidget; send: (e: JsDialogEvent) => void; place?: CSSProperties }): JSX.Element {
  const entries = (Array.isArray(w.entries) ? w.entries : []) as TreeEntry[]
  const rows: { depth: number; e: TreeEntry }[] = []
  const walk = (list: TreeEntry[], depth: number): void => { for (const e of list) { rows.push({ depth, e }); if (e.children) walk(e.children, depth + 1) } }
  walk(entries, 0)
  const label = (e: TreeEntry): string => cleanText(e.text ?? e.columns?.map((c) => c.text ?? '').join('  ') ?? '')
  return (
    <div className={styles.tree} style={place} data-wid={w.id} role="listbox">
      {rows.map(({ depth, e }, i) => {
        const row = e.row !== undefined ? String(e.row) : String(i)
        const on = e.selected === true || e.selected === 'true'
        return (
          <div key={row + ':' + i} role="option" aria-selected={on} className={`${styles.treeRow} ${on ? styles.treeOn : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => send({ control: w.id, cmd: 'select', type: 'treeview', data: row })}
            onDoubleClick={() => send({ control: w.id, cmd: 'activate', type: 'treeview', data: row })}>
            {e.state !== undefined && <input type="checkbox" readOnly checked={e.state === true || e.state === 'true'} className={styles.treeCheck}
              onClick={(ev) => { ev.stopPropagation(); send({ control: w.id, cmd: 'change', type: 'treeview', data: `${row};${e.state === true || e.state === 'true' ? 'false' : 'true'}` }) }} />}
            {label(e)}
          </div>
        )
      })}
    </div>
  )
}

function IconView({ w, send, place }: { w: JsWidget; send: (e: JsDialogEvent) => void; place?: CSSProperties }): JSX.Element {
  const entries = (Array.isArray(w.entries) ? w.entries : []) as { row?: number | string; text?: string; image?: string; selected?: boolean | string; tooltip?: string }[]
  return (
    <div className={styles.icons} style={place} data-wid={w.id}>
      {entries.map((e, i) => {
        const row = e.row !== undefined ? String(e.row) : String(i)
        const on = e.selected === true || e.selected === 'true'
        return (
          <button key={row} className={`${styles.icon} ${on ? styles.iconOn : ''}`} title={e.tooltip ?? e.text}
            onClick={() => send({ control: w.id, cmd: 'select', type: 'iconview', data: row })}
            onDoubleClick={() => send({ control: w.id, cmd: 'activate', type: 'iconview', data: row })}>
            {e.image && <img src={e.image.startsWith('data:') ? e.image : `data:image/png;base64,${e.image}`} alt="" />}
            {e.text && <span>{cleanText(e.text)}</span>}
          </button>
        )
      })}
    </div>
  )
}
