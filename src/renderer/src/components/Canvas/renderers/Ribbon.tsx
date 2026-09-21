import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlignCenter, AlignCenterHorizontal, AlignEndHorizontal, AlignHorizontalDistributeCenter, AlignJustify, AlignLeft, AlignRight, AlignStartHorizontal, AlignVerticalDistributeCenter, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, AreaChart, ArrowDown, ArrowDownAZ, ArrowDownToLine, ArrowRightToLine, ArrowUp, ArrowUpAZ, ArrowUpToLine, Asterisk, Ban, BarChart3, Baseline, Bold, BookMarked, BookOpenCheck, BringToFront, CalendarDays, Check, ChevronDown, ChevronUp, Circle, Clock, Columns3, Copy, Crop, DollarSign, Eraser, Eye, EyeOff, FileDown, FileText, Filter, FlipHorizontal, FlipVertical, Globe, Grid3x3, Group as Group2, Hash, Highlighter, History, Image as ImageIcon, IndentDecrease, IndentIncrease, Info, Italic, Layers, Layout as LayoutIcon, LayoutTemplate, LineChart, Link2, List, ListChecks, ListOrdered, Merge, MessageSquare, MessageSquarePlus, Minus, Move, MoveHorizontal, MoveUpRight, PaintBucket, Paintbrush, Palette, PanelBottom, PanelTop, PenTool, Percent, PieChart, Pilcrow, Plus, Presentation, Printer, RectangleHorizontal, RectangleVertical, Redo2, RefreshCw, RemoveFormatting, RotateCcw, RotateCw, Rows3, Save, Search, SendToBack, SeparatorHorizontal, SeparatorVertical, Sigma, SlidersHorizontal, Smile, Snowflake, Sparkles, SpellCheck, Spline, Split, Square, SquarePlus, SquareRoundCorner, StickyNote, Strikethrough, Subscript, Superscript, Table, Table2, Tag, Trash2, Type, Underline, Undo2, Ungroup, Wand2, WrapText, X, ZoomIn } from 'lucide-react'
import { perfBump } from './perfCount'
import { ANIMATION_PRESETS, NODE_TYPES, TRANSITIONS, TRANSITION_DURATIONS, transitionOf, type AnimEffect, type SlideTransition } from './animationModel'
import styles from './Ribbon.module.css'

/** Export formats offered per document type: [format, label]. */
const EXPORTS: Record<number, [string, string][]> = {
  0: [['pdf', 'PDF'], ['docx', 'Word (.docx)'], ['odt', 'OpenDocument (.odt)'], ['rtf', 'Rich Text (.rtf)'], ['txt', 'Plain Text (.txt)'], ['html', 'Web Page (.html)'], ['epub', 'EPUB (.epub)']],
  1: [['pdf', 'PDF'], ['xlsx', 'Excel (.xlsx)'], ['ods', 'OpenDocument (.ods)'], ['csv', 'CSV (.csv)'], ['html', 'Web Page (.html)']],
  2: [['pdf', 'PDF'], ['pptx', 'PowerPoint (.pptx)'], ['odp', 'OpenDocument (.odp)'], ['png', 'Image (.png)'], ['html', 'Web Page (.html)']],
}

/** Doc types from LOKit: 0=text, 1=spreadsheet, 2=presentation. */
const TABS: Record<number, string[]> = {
  0: ['Home', 'Insert', 'Layout', 'References', 'Review', 'View'],
  1: ['Home', 'Insert', 'Layout', 'Formulas', 'Data', 'Review', 'View'],
  2: ['Home', 'Insert', 'Design', 'Transitions', 'Animations', 'Review', 'View'],
}

const FONTS = ['Liberation Sans', 'Liberation Serif', 'Arial', 'Times New Roman', 'Courier New', 'Calibri', 'Georgia']
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 60, 72]
const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200]

/** PowerPoint gradient presets for the Design tab: [label, startDec, endDec]. */
const GRADIENTS: [string, number, number][] = [
  ['Blue', 5806300, 14543051], ['Teal', 1810836, 9234160], ['Sunset', 15564081, 12582912],
  ['Green', 3046194, 11854022], ['Purple', 7352480, 14403538],
]

/** One-click swatch palette (hex) for shape fill/outline in the Design tab. */
const SWATCHES = ['#1f4e79', '#2e75b6', '#5b9bd5', '#2e8b57', '#70ad47', '#ffc000', '#ed7d31', '#c00000', '#7030a0', '#000000', '#808080', '#ffffff']

/** Stroke width presets [label, 1/100 mm] and dash styles for the Design tab. */
const STROKE_WIDTHS: [string, number][] = [['Hairline', 1], ['Thin', 35], ['Medium', 100], ['Thick', 200], ['Heavy', 400]]
const DASHES: [string, string][] = [['Solid', 'solid'], ['Dashed', 'dashed'], ['Dotted', 'dotted'], ['Dash-dot', 'dashdot']]
/** Hatch pattern presets [label, style, angle(1/10°), distance(1/100mm)]. */
const PATTERNS: [string, string, number, number][] = [
  ['Diagonal', 'single', 450, 100], ['Back Diagonal', 'single', 1350, 100], ['Horizontal', 'single', 0, 100],
  ['Vertical', 'single', 900, 100], ['Cross-hatch', 'double', 450, 100], ['Grid', 'double', 0, 100],
]
const PATTERN_COLOR = 4210752 // 0x404040 hatch line color

/** Calc cell-style one-shots (Home ▸ Cell styles). */
const CELL_STYLES: [string, string][] = [
  ['Default', '.uno:StyleApply {"Style":{"type":"string","value":"Default"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Accent 1', '.uno:StyleApply {"Style":{"type":"string","value":"Accent 1"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Accent 2', '.uno:StyleApply {"Style":{"type":"string","value":"Accent 2"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Accent 3', '.uno:StyleApply {"Style":{"type":"string","value":"Accent 3"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Heading 1', '.uno:StyleApply {"Style":{"type":"string","value":"Heading 1"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Heading 2', '.uno:StyleApply {"Style":{"type":"string","value":"Heading 2"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Good', '.uno:StyleApply {"Style":{"type":"string","value":"Good"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Bad', '.uno:StyleApply {"Style":{"type":"string","value":"Bad"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Neutral', '.uno:StyleApply {"Style":{"type":"string","value":"Neutral"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Error', '.uno:StyleApply {"Style":{"type":"string","value":"Error"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Warning', '.uno:StyleApply {"Style":{"type":"string","value":"Warning"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Footnote', '.uno:StyleApply {"Style":{"type":"string","value":"Footnote"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
  ['Note', '.uno:StyleApply {"Style":{"type":"string","value":"Note"},"FamilyName":{"type":"string","value":"CellStyles"}}'],
]

/** Word Layout margin presets [label, 1/100 mm all-sides] for the Layout tab. */
const MARGIN_PRESETS: [string, number][] = [
  ['Normal', 2540], // 2.54 cm (1")
  ['Narrow', 1270], // 1.27 cm (0.5")
  ['Wide', 5080],   // 5.08 cm (2") left/right emphasis — applied to all sides here
]

/** Impress autolayout presets (LibreOffice AUTOLAYOUT enum) for the Design tab. */
const SLIDE_LAYOUTS: [number, string][] = [
  [0, 'Title Slide'],
  [1, 'Title, Content'],
  [3, 'Two Content'],
  [19, 'Title Only'],
  [20, 'Blank'],
]

/** What is selected on the canvas, for the contextual tabs. */
export type RibbonContext = 'shape' | 'picture' | 'table' | null

export interface RibbonProps {
  docType: number
  active: Record<string, string>
  /** A selected shape, picture or table adds (and switches to) its own tab. */
  context?: RibbonContext
  dirty: boolean
  saving: boolean
  zoom: number
  /** Open document's file name, shown inline in the tab row (the breadcrumb bar is hidden for office docs). */
  fileName?: string
  onUno: (command: string) => void
  onStyle: (styleName: string) => void
  onSave: () => void
  onZoom: (delta: number) => void
  onSetZoom: (zoom: number) => void
  onExport: (format: string) => void
  onProperties: () => void
  /** Routes an office.* action id (shapes/colors/background/effects) into the engine. */
  onDesign: (id: string) => void
  onSlideOp: (command: string) => void
  onInsertTable: () => void
  onFormatCells: () => void
  /** Format painter is a mode — the ribbon shows it armed until the next click. */
  painterArmed?: boolean
  onPaintbrush?: () => void
  onInsertSymbol: () => void
  onHyperlink: () => void
  onInsertImage: () => void
  onBorders: () => void
  /** Impress-only: whether the speaker-notes pane is shown. */
  notesOn?: boolean
  /** Impress-only: toggle the speaker-notes pane. */
  onToggleNotes?: () => void
  /** Impress: the current slide's transition (Transitions tab). */
  transition?: SlideTransition | null
  /** Impress: 'set:<id>' · 'duration:<s>' · 'advance:<click|auto>:<s>' · 'all'. */
  onTransition?: (cmd: string) => void
  /** Impress: the current slide's animation sequence (Animations tab). */
  effects?: AnimEffect[]
  /** Impress: 'add:<presetId>:<nodeType>' · 'pane'. */
  onAnimate?: (cmd: string) => void
  animPaneOpen?: boolean
  /** Ask the ribbon to show a tab (a menu or context-menu pick); `n` makes repeats distinct. */
  requestTab?: { tab: string; n: number } | null
  /** Writer: whether the ruler is shown (View ▸ Show ▸ Ruler). */
  rulerOn?: boolean
}

function Group({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className={styles.group}>
      <div className={styles.groupBody}>{children}</div>
      <div className={styles.groupLabel}>{label}</div>
    </div>
  )
}

/** #rrggbb → LibreOffice long color. */
function hexToUno(hex: string): number {
  return parseInt(hex.slice(1), 16)
}

// Memoized: LokRenderer re-renders on every caret/selection change; the ribbon
// only depends on doc type, toolbar state and stable callbacks.
export const Ribbon = memo(function Ribbon(props: RibbonProps): JSX.Element {
  perfBump('Ribbon.render') // dev-only; measures how often the memoized ribbon re-renders
  const { docType, active, dirty, saving, zoom, fileName, onUno, onStyle, onSave, onZoom, onSetZoom, onExport, onProperties, onDesign, onSlideOp, onInsertTable, onFormatCells, onInsertSymbol, onHyperlink, onInsertImage, onBorders, notesOn, onToggleNotes, painterArmed, onPaintbrush, transition, onTransition, effects, onAnimate, animPaneOpen, requestTab } = props
  const context = props.context ?? null
  const contextTab = context === 'table' ? 'Table' : context === 'picture' ? 'Picture' : context === 'shape' ? 'Shape' : null
  const tabs = [...(TABS[docType] ?? TABS[0]), ...(contextTab ? [contextTab] : [])]
  const [tab, setTab] = useState('Home')
  // A new selection opens its tab; losing it returns to Home.
  const prevContextTab = useRef<string | null>(null)
  useEffect(() => {
    if (contextTab && contextTab !== prevContextTab.current) setTab(contextTab)
    else if (!contextTab && prevContextTab.current && tab === prevContextTab.current) setTab('Home')
    prevContextTab.current = contextTab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTab])
  useEffect(() => { if (requestTab && tabs.includes(requestTab.tab)) setTab(requestTab.tab) // eslint-disable-line react-hooks/exhaustive-deps
  }, [requestTab])
  // Animations: the trigger the next added effect gets.
  const [animStart, setAnimStart] = useState(1)
  const [showExport, setShowExport] = useState(false)
  // Word Layout: header/footer text the user types before applying (colon-safe:
  // stripped so it can't collide with the office.* id delimiter).
  const [hdrText, setHdrText] = useState('')
  const [ftrText, setFtrText] = useState('')
  // Impress slide-table context: row height / column width the user types (cm) —
  // converted to 1/100 mm for the model API. Empty until edited.
  const [rowH, setRowH] = useState('')
  const [colW, setColW] = useState('')
  // Impress slide-table cell text size (pt) the user types for cell formatting.
  const [cellPt, setCellPt] = useState('')
  const cmToMm100 = (s: string) => Math.round((Number(s) || 0) * 1000)
  const safe = (s: string) => s.replace(/[:|]/g, ' ')
  const exports = EXPORTS[docType] ?? EXPORTS[0]
  const on = (cmd: string) => (active[cmd] === 'true' ? styles.btnActive : styles.btn)
  // The engine says `disabled` for a command that cannot run on the current
  // selection (Undo with nothing to undo, Paste with an empty clipboard, cell
  // ops outside a table). A greyed button beats one that silently does nothing.
  const dis = (cmd: string) => active[cmd] === 'disabled'

  const fontName = (name: string) =>
    onUno(`.uno:CharFontName {"CharFontName.FamilyName":{"type":"string","value":"${name}"}}`)
  const fontSize = (pt: number) =>
    onUno(`.uno:FontHeight {"FontHeight.Height":{"type":"float","value":${pt}}}`)
  const fontColor = (hex: string) =>
    onUno(`.uno:Color {"Color":{"type":"long","value":${hexToUno(hex)}}}`)
  const highlight = (hex: string) =>
    onUno(`.uno:CharBackColor {"CharBackColor":{"type":"long","value":${hexToUno(hex)}}}`)
  const cellFill = (hex: string) =>
    onUno(`.uno:BackgroundColor {"BackgroundColor":{"type":"long","value":${hexToUno(hex)}}}`)
  // PowerPoint design palette → office.* macro actions (selected shape / slide).
  const shapeFill = (hex: string) => onDesign(`office.shapefill:${hexToUno(hex)}`)
  const shapeLine = (hex: string) => onDesign(`office.shapeline:${hexToUno(hex)}`)
  const slideBgOne = (hex: string) => onDesign(`office.slidebg:one:${hexToUno(hex)}`)
  const slideBgAll = (hex: string) => onDesign(`office.slidebg:all:${hexToUno(hex)}`)
  // Slide-table CELL formatting → the WosSlideTableCellFmt macro (active cell(s)).
  const cellFmtFill = (hex: string) => onDesign(`office.slidetablefmt:fill:${hexToUno(hex)}`)

  return (
    <div className={styles.root}>
      <div className={styles.tabRow}>
        <div className={styles.tabs}>
          {tabs.map((t) => (
            <button key={t} className={`${t === tab ? styles.tabActive : styles.tab} ${t === contextTab ? styles.tabContextual : ''}`} data-testid={t === contextTab ? 'ribbon-context-tab' : undefined} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        {fileName && <span className={styles.docName} title={fileName}>{fileName}</span>}
        <div className={styles.right}>
          <span className={styles.live}>● Live</span>
          <button className={styles.iconBtnSm} title="Document properties" onClick={onProperties}>
            <Info size={15} strokeWidth={2} />
          </button>
          <div className={styles.exportWrap}>
            <button className={styles.export} onClick={() => setShowExport((v) => !v)} title="Export to another format">
              <FileDown size={13} strokeWidth={2} /> Export <ChevronDown size={12} strokeWidth={2.4} />
            </button>
            {showExport && (
              <>
                <div className={styles.exportBackdrop} onClick={() => setShowExport(false)} />
                <div className={styles.exportMenu}>
                  {exports.map(([fmt, label]) => (
                    <button key={fmt} onClick={() => { setShowExport(false); onExport(fmt) }}>{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className={styles.save} onClick={onSave} disabled={saving || !dirty} title="Save (⌘S)">
            <Save size={13} strokeWidth={2} /> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          <div className={styles.zoom}>
            <button onClick={() => onZoom(-0.2)}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => onZoom(0.2)}>+</button>
          </div>
        </div>
      </div>

      {tab === 'Home' && (
        <div className={styles.tabContent}>
          {docType === 0 && (
            <Group label="Styles">
              <select className={styles.styleSelect} title="Paragraph style" value="" onChange={(e) => e.target.value && onStyle(e.target.value)}>
                <option value="" disabled>Style…</option>
                <option value="Default Paragraph Style">Body text</option>
                <option value="Title">Title</option>
                <option value="Heading 1">Heading 1</option>
                <option value="Heading 2">Heading 2</option>
                <option value="Heading 3">Heading 3</option>
              </select>
            </Group>
          )}
          <Group label="Font">
            <select className={styles.fontSelect} title="Font" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) fontName(v) }}>
              <option value="" disabled>Font…</option>
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className={styles.sizeSelect} title="Font size" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) fontSize(Number(v)) }}>
              <option value="" disabled>Size</option>
              {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className={on('.uno:Bold')} disabled={dis('.uno:Bold')} title="Bold" onClick={() => onUno('.uno:Bold')}><Bold size={15} strokeWidth={2.4} /></button>
            <button className={on('.uno:Italic')} disabled={dis('.uno:Italic')} title="Italic" onClick={() => onUno('.uno:Italic')}><Italic size={15} strokeWidth={2.4} /></button>
            <button className={on('.uno:Underline')} disabled={dis('.uno:Underline')} title="Underline" onClick={() => onUno('.uno:Underline')}><Underline size={15} strokeWidth={2.4} /></button>
            <button className={on('.uno:Strikeout')} disabled={dis('.uno:Strikeout')} title="Strikethrough" onClick={() => onUno('.uno:Strikeout')}><Strikethrough size={15} strokeWidth={2.4} /></button>
            <button className={on('.uno:SubScript')} disabled={dis('.uno:SubScript')} title="Subscript" onClick={() => onUno('.uno:SubScript')}><Subscript size={15} strokeWidth={2.2} /></button>
            <button className={on('.uno:SuperScript')} disabled={dis('.uno:SuperScript')} title="Superscript" onClick={() => onUno('.uno:SuperScript')}><Superscript size={15} strokeWidth={2.2} /></button>
            <label className={styles.color} title="Font color"><Baseline size={15} strokeWidth={2.2} /><input type="color" defaultValue="#c00000" onChange={(e) => fontColor(e.target.value)} /></label>
            <label className={styles.color} title="Highlight"><Highlighter size={15} strokeWidth={2.2} /><input type="color" defaultValue="#ffff00" onChange={(e) => highlight(e.target.value)} /></label>
            <button className={styles.btn} title="Clear formatting" onClick={() => onUno('.uno:ResetAttributes')}><RemoveFormatting size={15} strokeWidth={2.2} /></button>
            <select className={styles.sizeSelect} title="Change case" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onUno(v) }}>
              <option value="" disabled>Aa</option>
              <option value=".uno:ChangeCaseToUpper">UPPERCASE</option>
              <option value=".uno:ChangeCaseToLower">lowercase</option>
              <option value=".uno:ChangeCaseToSentenceCase">Sentence case</option>
              <option value=".uno:ChangeCaseToTitleCase">Title Case</option>
            </select>
          </Group>
          {docType === 0 && (
            <Group label="Paragraph">
              <button className={on('.uno:LeftPara')} disabled={dis('.uno:LeftPara')} title="Align left" onClick={() => onUno('.uno:LeftPara')}><AlignLeft size={15} strokeWidth={2.2} /></button>
              <button className={on('.uno:CenterPara')} disabled={dis('.uno:CenterPara')} title="Center" onClick={() => onUno('.uno:CenterPara')}><AlignCenter size={15} strokeWidth={2.2} /></button>
              <button className={on('.uno:RightPara')} disabled={dis('.uno:RightPara')} title="Align right" onClick={() => onUno('.uno:RightPara')}><AlignRight size={15} strokeWidth={2.2} /></button>
              <button className={on('.uno:JustifyPara')} disabled={dis('.uno:JustifyPara')} title="Justify" onClick={() => onUno('.uno:JustifyPara')}><AlignJustify size={15} strokeWidth={2.2} /></button>
              <button className={on('.uno:DefaultBullet')} disabled={dis('.uno:DefaultBullet')} title="Bulleted list" onClick={() => onUno('.uno:DefaultBullet')}><List size={15} strokeWidth={2.2} /></button>
              <button className={on('.uno:DefaultNumbering')} disabled={dis('.uno:DefaultNumbering')} title="Numbered list" onClick={() => onUno('.uno:DefaultNumbering')}><ListOrdered size={15} strokeWidth={2.2} /></button>
              <button className={styles.btn} title="Decrease indent" onClick={() => onUno('.uno:DecrementIndent')}><IndentDecrease size={15} strokeWidth={2.2} /></button>
              <button className={styles.btn} title="Increase indent" onClick={() => onUno('.uno:IncrementIndent')}><IndentIncrease size={15} strokeWidth={2.2} /></button>
              <select className={styles.sizeSelect} title="Line spacing" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onUno(v) }}>
                <option value="" disabled>↕</option>
                <option value=".uno:SpacePara1">1.0</option>
                <option value=".uno:SpacePara15">1.5</option>
                <option value=".uno:SpacePara2">2.0</option>
              </select>
            </Group>
          )}
          {docType === 1 && (
            <>
              <Group label="Number">
                <button className={styles.btn} title="Currency" onClick={() => onUno('.uno:NumberFormatCurrency')}><DollarSign size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Percent" onClick={() => onUno('.uno:NumberFormatPercent')}><Percent size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Date" onClick={() => onUno('.uno:NumberFormatDate')}><CalendarDays size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Add decimal" onClick={() => onUno('.uno:NumberFormatIncDecimals')}>.0+</button>
                <button className={styles.btn} title="Remove decimal" onClick={() => onUno('.uno:NumberFormatDecDecimals')}>.0−</button>
                <button className={styles.btn} title="Format cells…" onClick={onFormatCells}><SlidersHorizontal size={15} strokeWidth={2.2} /></button>
              </Group>
              <Group label="Alignment">
                <button className={on('.uno:AlignLeft')} disabled={dis('.uno:AlignLeft')} title="Align left" onClick={() => onUno('.uno:AlignLeft')}><AlignLeft size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:AlignHorizontalCenter')} disabled={dis('.uno:AlignHorizontalCenter')} title="Center" onClick={() => onUno('.uno:AlignHorizontalCenter')}><AlignCenter size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:AlignRight')} disabled={dis('.uno:AlignRight')} title="Align right" onClick={() => onUno('.uno:AlignRight')}><AlignRight size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:ToggleMergeCells')} disabled={dis('.uno:ToggleMergeCells')} title="Merge cells" onClick={() => onUno('.uno:ToggleMergeCells')}><Merge size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:WrapText')} disabled={dis('.uno:WrapText')} title="Wrap text (Zeilenumbruch)" onClick={() => onUno('.uno:WrapText')}><WrapText size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:AlignTop')} disabled={dis('.uno:AlignTop')} title="Align top" onClick={() => onUno('.uno:AlignTop')}><AlignVerticalJustifyStart size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:AlignVCenter')} disabled={dis('.uno:AlignVCenter')} title="Align middle" onClick={() => onUno('.uno:AlignVCenter')}><AlignVerticalJustifyCenter size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:AlignBottom')} disabled={dis('.uno:AlignBottom')} title="Align bottom" onClick={() => onUno('.uno:AlignBottom')}><AlignVerticalJustifyEnd size={15} strokeWidth={2.2} /></button>
                {/* Format painter: a MODE — it stays armed until the next click
                    applies the copied style, which is why it reads as active. */}
                <button className={painterArmed ? styles.btnOn : styles.btn} title="Copy formatting (Pinsel) — then click a cell" onClick={onPaintbrush}><Paintbrush size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Clear formatting" onClick={() => onUno('.uno:ResetAttributes')}><Eraser size={15} strokeWidth={2.2} /></button>
                <label className={styles.color} title="Cell fill color"><PaintBucket size={15} strokeWidth={2.2} /><input type="color" defaultValue="#fff2a8" onChange={(e) => cellFill(e.target.value)} /></label>
                <button className={styles.btn} title="Borders" onClick={onBorders}><Grid3x3 size={15} strokeWidth={2.2} /></button>
              </Group>
              <Group label="Data">
                <button className={styles.btn} title="Sort… (multi-key)" onClick={() => onUno('.uno:DataSort')}><ArrowDownAZ size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Insert function…" onClick={() => onUno('.uno:FunctionDialog')}><Sigma size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Named range…" onClick={() => onUno('.uno:DefineName')}><Tag size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="PivotTable…" onClick={() => onUno('.uno:DataDataPilotRun')}><Table2 size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Define print area" onClick={() => onUno('.uno:DefinePrintArea')}><Printer size={15} strokeWidth={2.2} /></button>
              </Group>
              <Group label="Cells">
                <button className={styles.btn} title="Insert rows" onClick={() => onUno('.uno:InsertRows')}><Rows3 size={15} strokeWidth={2.2} /> <Plus size={10} /></button>
                <button className={styles.btn} title="Insert columns" onClick={() => onUno('.uno:InsertColumns')}><Columns3 size={15} strokeWidth={2.2} /> <Plus size={10} /></button>
                <button className={styles.btn} title="Delete rows" onClick={() => onUno('.uno:DeleteRows')}><Rows3 size={15} strokeWidth={2.2} /> −</button>
                <button className={styles.btn} title="Delete columns" onClick={() => onUno('.uno:DeleteColumns')}><Columns3 size={15} strokeWidth={2.2} /> −</button>
                <button className={styles.btn} title="Fill down (⌘D)" onClick={() => onUno('.uno:FillDown')}><ArrowDownToLine size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Fill right (⌘R)" onClick={() => onUno('.uno:FillRight')}><ArrowRightToLine size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Hide rows" onClick={() => onUno('.uno:HideRow')}><EyeOff size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Show rows" onClick={() => onUno('.uno:ShowRow')}><Eye size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Optimal column width" onClick={() => onUno('.uno:SetOptimalColumnWidth')}><MoveHorizontal size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Larger font" onClick={() => onUno('.uno:Grow')}><Plus size={13} strokeWidth={2.6} />A</button>
                <button className={styles.btn} title="Smaller font" onClick={() => onUno('.uno:Shrink')}>−A</button>
                <button className={styles.btn} title="AutoSum" onClick={() => onUno('.uno:AutoSum')}><Sigma size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Clear contents" onClick={() => onUno('.uno:ClearContents')}><Eraser size={15} strokeWidth={2.2} /></button>
              </Group>
              <Group label="Styles">
                <button className={styles.wideBtn} title="Conditional formatting — highlight cells in the selection by rule" onClick={() => onDesign('office.dialog:condformat')}><Palette size={15} strokeWidth={2} /> Conditional</button>
                <button className={styles.wideBtn} title="Data validation — restrict the selected cells to a dropdown list, a number range, or a text length" onClick={() => onDesign('office.dialog:datavalidation')}><ListChecks size={15} strokeWidth={2} /> Validation</button>
                <select className={styles.sizeSelect} data-testid="cell-styles" title="Cell styles" value="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) onUno(v) }}>
                  <option value="" disabled>Cell styles</option>
                  {CELL_STYLES.map(([label, cmd]) => <option key={cmd} value={cmd}>{label}</option>)}
                </select>
                <button className={styles.wideBtn} title="Format as table… (AutoFormat styles)" onClick={() => onUno('.uno:AutoFormat')}><Table2 size={15} strokeWidth={2} /> Format as table</button>
              </Group>
            </>
          )}
          {docType === 2 && (
            <>
              <Group label="Slides">
                <button className={styles.wideBtn} title="New slide" onClick={() => onSlideOp('.uno:InsertPage')}><SquarePlus size={14} strokeWidth={2} /> New</button>
                <button className={styles.btn} title="Duplicate slide" onClick={() => onSlideOp('.uno:DuplicatePage')}><Copy size={15} strokeWidth={2} /></button>
                <button className={styles.btn} title="Delete slide" onClick={() => onSlideOp('.uno:DeletePage')}><Trash2 size={15} strokeWidth={2} /></button>
              </Group>
              <Group label="Paragraph">
                <button className={on('.uno:LeftPara')} disabled={dis('.uno:LeftPara')} title="Align left" onClick={() => onUno('.uno:LeftPara')}><AlignLeft size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:CenterPara')} disabled={dis('.uno:CenterPara')} title="Center" onClick={() => onUno('.uno:CenterPara')}><AlignCenter size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:RightPara')} disabled={dis('.uno:RightPara')} title="Align right" onClick={() => onUno('.uno:RightPara')}><AlignRight size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:JustifyPara')} disabled={dis('.uno:JustifyPara')} title="Justify" onClick={() => onUno('.uno:JustifyPara')}><AlignJustify size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:DefaultBullet')} disabled={dis('.uno:DefaultBullet')} title="Bulleted list" onClick={() => onUno('.uno:DefaultBullet')}><List size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:DefaultNumbering')} disabled={dis('.uno:DefaultNumbering')} title="Numbered list" onClick={() => onUno('.uno:DefaultNumbering')}><ListOrdered size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Decrease indent" onClick={() => onUno('.uno:DecrementSubLevel')}><IndentDecrease size={15} strokeWidth={2.2} /></button>
                <button className={styles.btn} title="Increase indent" onClick={() => onUno('.uno:IncrementSubLevel')}><IndentIncrease size={15} strokeWidth={2.2} /></button>
              </Group>
            </>
          )}
          <Group label="Undo">
            <button className={styles.btn} title="Undo (⌘Z)" onClick={() => onUno('.uno:Undo')}><Undo2 size={15} strokeWidth={2.2} /></button>
            <button className={styles.btn} title="Redo (⇧⌘Z)" onClick={() => onUno('.uno:Redo')}><Redo2 size={15} strokeWidth={2.2} /></button>
          </Group>
        </div>
      )}

      {tab === 'Insert' && (
        <div className={styles.tabContent}>
          <Group label="Tables">
            <button className={styles.wideBtn} title="Insert table" onClick={onInsertTable}>
              <Table size={15} strokeWidth={2} /> Table
            </button>
          </Group>
          <Group label="Media">
            <button className={styles.wideBtn} title="Insert image" onClick={onInsertImage}>
              <ImageIcon size={15} strokeWidth={2} /> Image
            </button>
          </Group>
          <Group label="Symbols">
            <button className={styles.btn} title="Special character" onClick={onInsertSymbol}><Smile size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Hyperlink" onClick={onHyperlink}><Link2 size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Pages">
            <button className={styles.btn} title="Page break" onClick={() => onUno('.uno:InsertPagebreak')}><SeparatorHorizontal size={15} strokeWidth={2} /></button>
            {docType === 0 && (
              <button className={styles.btn} title="Page number" onClick={() => onUno('.uno:InsertPageNumberField')}><Hash size={15} strokeWidth={2} /></button>
            )}
          </Group>
          {docType === 0 && (
            <Group label="References">
              <button className={styles.btn} title="Insert footnote" onClick={() => onUno('.uno:InsertFootnote')}><Asterisk size={15} strokeWidth={2} /></button>
              <button className={styles.btn} title="Insert endnote" onClick={() => onUno('.uno:InsertEndnote')}><BookMarked size={15} strokeWidth={2} /></button>
              <button className={styles.btn} title="Update fields" onClick={() => onUno('.uno:UpdateAll')}><RefreshCw size={15} strokeWidth={2} /></button>
            </Group>
          )}
          {docType === 2 && (
            <>
              <Group label="Text">
                <button className={styles.wideBtn} title="Insert text box" onClick={() => onUno('.uno:InsertTextbox')}><Type size={15} strokeWidth={2} /> Text Box</button>
              </Group>
              <Group label="Fields">
                <button className={styles.wideBtn} title="Slide number" data-testid="slide-number" onClick={() => onUno('.uno:InsertPageField')}><Hash size={14} strokeWidth={2} /> Slide number</button>
                <select className={styles.sizeSelect} title="Insert a field" value="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) onUno(v) }}>
                  <option value="" disabled>Field</option>
                  <option value=".uno:InsertDateFieldFix">Date (fixed)</option>
                  <option value=".uno:InsertDateFieldVar">Date (variable)</option>
                  <option value=".uno:InsertTimeFieldFix">Time (fixed)</option>
                  <option value=".uno:InsertTimeFieldVar">Time (variable)</option>
                  <option value=".uno:InsertAuthorField">Author</option>
                  <option value=".uno:InsertSlideTitleField">Slide title</option>
                  <option value=".uno:InsertSlidesField">Slide count</option>
                  <option value=".uno:InsertFileField">File name</option>
                </select>
              </Group>
              <Group label="Header & Footer">
                <button className={styles.wideBtn} title="Header and footer… (date, footer text, slide number)" onClick={() => onUno('.uno:HeaderAndFooter')}><PanelBottom size={14} strokeWidth={2} /> Header & footer</button>
                <button className={styles.wideBtn} title="QR and barcode…" onClick={() => onUno('.uno:InsertQrCode')}><Grid3x3 size={14} strokeWidth={2} /> QR code</button>
              </Group>
            </>
          )}
          {docType === 1 && (
            <Group label="Date & Time">
              <button className={styles.wideBtn} title="Insert current date" onClick={() => onUno('.uno:InsertCurrentDate')}><CalendarDays size={14} strokeWidth={2} /> Today</button>
              <button className={styles.wideBtn} title="Insert current time" onClick={() => onUno('.uno:InsertCurrentTime')}><Clock size={14} strokeWidth={2} /> Now</button>
            </Group>
          )}
          {docType === 1 && (
            <Group label="Charts">
              <button className={styles.btn} title="Column chart (from selected range)" onClick={() => onDesign('office.chart:column')}><BarChart3 size={15} strokeWidth={2} /></button>
              <button className={styles.btn} title="Bar chart" onClick={() => onDesign('office.chart:bar')}><BarChart3 size={15} strokeWidth={2} style={{ transform: 'rotate(90deg)' }} /></button>
              <button className={styles.btn} title="Line chart" onClick={() => onDesign('office.chart:line')}><LineChart size={15} strokeWidth={2} /></button>
              <button className={styles.btn} title="Pie chart" onClick={() => onDesign('office.chart:pie')}><PieChart size={15} strokeWidth={2} /></button>
              <button className={styles.btn} title="Area chart" onClick={() => onDesign('office.chart:area')}><AreaChart size={15} strokeWidth={2} /></button>
            </Group>
          )}
        </div>
      )}

      {tab === 'Review' && (
        <div className={styles.tabContent}>
          <Group label="Comments">
            <button className={styles.wideBtn} title="Insert comment" onClick={() => onDesign('office.review:add')}>
              <MessageSquarePlus size={15} strokeWidth={2} /> Comment
            </button>
            <button className={styles.wideBtn} title="Show the review panel (comments and changes)" data-testid="ribbon-review-panel" onClick={() => onDesign('office.review')}>
              <MessageSquare size={15} strokeWidth={2} /> Panel
            </button>
          </Group>
          {docType === 0 && (
            <Group label="Tracking">
              <button className={on('.uno:TrackChanges')} disabled={dis('.uno:TrackChanges')} title="Record changes" onClick={() => onUno('.uno:TrackChanges')}>
                <History size={15} strokeWidth={2} />
              </button>
              <button className={on('.uno:ShowTrackedChanges')} disabled={dis('.uno:ShowTrackedChanges')} title="Show tracked changes" onClick={() => onUno('.uno:ShowTrackedChanges')}><Eye size={15} strokeWidth={2} /></button>
              <button className={styles.btn} disabled={dis('.uno:AcceptTrackedChange')} title="Accept change" onClick={() => onUno('.uno:AcceptTrackedChange')}><Check size={15} strokeWidth={2.2} /></button>
              <button className={styles.btn} disabled={dis('.uno:RejectTrackedChange')} title="Reject change" onClick={() => onUno('.uno:RejectTrackedChange')}><X size={15} strokeWidth={2.2} /></button>
              <button className={styles.btn} disabled={dis('.uno:PreviousTrackedChange')} title="Previous change" onClick={() => onUno('.uno:PreviousTrackedChange')}><ChevronUp size={15} strokeWidth={2.2} /></button>
              <button className={styles.btn} disabled={dis('.uno:NextTrackedChange')} title="Next change" onClick={() => onUno('.uno:NextTrackedChange')}><ChevronDown size={15} strokeWidth={2.2} /></button>
            </Group>
          )}
          <Group label="Spelling">
            <button className={on('.uno:SpellOnline')} title="Automatic spell checking" onClick={() => onUno('.uno:SpellOnline')}><SpellCheck size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Spelling…" onClick={() => onUno(docType === 0 ? '.uno:SpellingAndGrammarDialog' : '.uno:SpellDialog')}><BookOpenCheck size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Thesaurus…" onClick={() => onUno('.uno:ThesaurusDialog')}><BookMarked size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Find">
            <button className={styles.btn} title="Find & Replace" onClick={() => onUno('.uno:SearchDialog')}><Search size={15} strokeWidth={2} /></button>
          </Group>
        </div>
      )}

      {tab === 'Data' && (
        <div className={styles.tabContent}>
          <Group label="Outline">
            <button className={styles.wideBtn} title="Group the selected rows (or columns) — an outline bar with −/+ appears beside the headers" data-testid="outline-group" onClick={() => onDesign('office.outline:group')}><Group2 size={14} strokeWidth={2} /> Group</button>
            <button className={styles.wideBtn} title="Ungroup the selected rows (or columns)" data-testid="outline-ungroup" onClick={() => onDesign('office.outline:ungroup')}><Ungroup size={14} strokeWidth={2} /> Ungroup</button>
          </Group>
          <Group label="Sort & Filter">
            <button className={styles.btn} title="Sort ascending (A→Z) — asks to expand to the whole data block" data-testid="sort-asc" onClick={() => onDesign('office.sort:asc')}><ArrowDownAZ size={15} strokeWidth={2.2} /></button>
            <button className={styles.btn} title="Sort descending (Z→A) — asks to expand to the whole data block" data-testid="sort-desc" onClick={() => onDesign('office.sort:desc')}><ArrowUpAZ size={15} strokeWidth={2.2} /></button>
            <button className={on('.uno:DataFilterAutoFilter')} disabled={dis('.uno:DataFilterAutoFilter')} title="AutoFilter" onClick={() => onUno('.uno:DataFilterAutoFilter')}><Filter size={15} strokeWidth={2.2} /></button>
          </Group>
          <Group label="Data tools">
            <button className={styles.wideBtn} title="Text to columns…" data-testid="text-to-columns" onClick={() => onUno('.uno:TextToColumns')}><Columns3 size={14} strokeWidth={2} /> Text to columns</button>
            <button className={styles.wideBtn} title="Remove duplicates…" onClick={() => onUno('.uno:HandleDuplicateRecords')}><Eraser size={14} strokeWidth={2} /> Duplicates</button>
            <button className={styles.wideBtn} title="Consolidate…" onClick={() => onUno('.uno:DataConsolidate')}><Merge size={14} strokeWidth={2} /> Consolidate</button>
            <button className={styles.wideBtn} title="Define database range…" onClick={() => onUno('.uno:DefineDBName')}><Table size={14} strokeWidth={2} /> Define range</button>
          </Group>
          <Group label="What-if">
            <button className={styles.wideBtn} title="Goal seek…" onClick={() => onUno('.uno:GoalSeekDialog')}><MoveUpRight size={14} strokeWidth={2} /> Goal seek</button>
            <button className={styles.wideBtn} title="Solver…" onClick={() => onUno('.uno:SolverDialog')}><Wand2 size={14} strokeWidth={2} /> Solver</button>
            <button className={styles.wideBtn} title="Scenarios…" onClick={() => onUno('.uno:ScenarioManager')}><Layers size={14} strokeWidth={2} /> Scenarios</button>
          </Group>
          <Group label="Functions">
            <button className={styles.btn} title="AutoSum" onClick={() => onUno('.uno:AutoSum')}><Sigma size={15} strokeWidth={2.2} /></button>
          </Group>
          <Group label="Window">
            <button className={styles.wideBtn} title="Freeze panes" onClick={() => onUno('.uno:FreezePanes')}><Snowflake size={14} strokeWidth={2} /> Freeze</button>
          </Group>
        </div>
      )}

      {/* Layout (Word) — page setup (margins/orientation/header-footer/page numbers) + flow. */}
      {tab === 'Layout' && docType === 0 && (
        <div className={styles.tabContent}>
          <Group label="Margins">
            {MARGIN_PRESETS.map(([label, v]) => (
              <button key={label} className={styles.wideBtn} title={`${label} margins`} onClick={() => onDesign(`office.margins:all:${v}`)}>{label}</button>
            ))}
            <button className={styles.wideBtn} title="Custom margins…" onClick={() => onDesign('office.dialog:margins')}><SlidersHorizontal size={14} strokeWidth={2} /> Custom</button>
          </Group>
          <Group label="Orientation">
            <button className={styles.wideBtn} title="Portrait" onClick={() => onDesign('office.orient:portrait')}><RectangleVertical size={14} strokeWidth={2} /> Portrait</button>
            <button className={styles.wideBtn} title="Landscape" onClick={() => onDesign('office.orient:landscape')}><RectangleHorizontal size={14} strokeWidth={2} /> Landscape</button>
          </Group>
          <Group label="Header">
            <input className={styles.styleSelect} style={{ width: 120 }} placeholder="Header text…" value={hdrText} onChange={(e) => setHdrText(e.target.value)} title="Header text" />
            <button className={styles.btn} title="Add / update header" onClick={() => onDesign(`office.headerfooter:header:on:${safe(hdrText)}`)}><PanelTop size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Remove header" onClick={() => onDesign('office.headerfooter:header:off:')}><Ban size={14} strokeWidth={2} /></button>
          </Group>
          <Group label="Footer">
            <input className={styles.styleSelect} style={{ width: 120 }} placeholder="Footer text…" value={ftrText} onChange={(e) => setFtrText(e.target.value)} title="Footer text" />
            <button className={styles.btn} title="Add / update footer" onClick={() => onDesign(`office.headerfooter:footer:on:${safe(ftrText)}`)}><PanelBottom size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Remove footer" onClick={() => onDesign('office.headerfooter:footer:off:')}><Ban size={14} strokeWidth={2} /></button>
          </Group>
          <Group label="Text layout">
            <button className={styles.wideBtn} title="Columns… (section columns)" onClick={() => onUno('.uno:FormatColumns')}><Columns3 size={14} strokeWidth={2} /> Columns</button>
            <select className={styles.sizeSelect} data-testid="watermark" title="Watermark" value="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v === 'custom') onUno('.uno:Watermark'); else if (v) onDesign(v) }}>
              <option value="" disabled>Watermark</option>
              <option value="office.watermark:DRAFT">Draft</option>
              <option value="office.watermark:CONFIDENTIAL">Confidential</option>
              <option value="office.watermark:SAMPLE">Sample</option>
              <option value="office.watermark:">Remove</option>
              <option value="custom">Custom…</option>
            </select>
            <button className={styles.wideBtn} title="Line numbering…" onClick={() => onUno('.uno:LineNumberingDialog')}><ListOrdered size={14} strokeWidth={2} /> Line numbers</button>
          </Group>
          <Group label="Page Numbers">
            <button className={styles.wideBtn} title="Page number in header" onClick={() => onDesign('office.pagenum:header')}><Hash size={14} strokeWidth={2} /> Header</button>
            <button className={styles.wideBtn} title="Page number in footer" onClick={() => onDesign('office.pagenum:footer')}><Hash size={14} strokeWidth={2} /> Footer</button>
            <button className={styles.btn} title="Remove page numbers" onClick={() => onDesign('office.pagenum:off')}><Ban size={14} strokeWidth={2} /></button>
          </Group>
          <Group label="Breaks">
            <button className={styles.wideBtn} title="Insert page break" onClick={() => onUno('.uno:InsertPagebreak')}><SeparatorHorizontal size={14} strokeWidth={2} /> Page</button>
            <button className={styles.wideBtn} title="Insert column break" onClick={() => onUno('.uno:InsertColumnBreak')}><SeparatorVertical size={14} strokeWidth={2} /> Column</button>
          </Group>
          <Group label="Indent">
            <button className={styles.btn} title="Decrease indent" onClick={() => onUno('.uno:DecrementIndent')}><IndentDecrease size={15} strokeWidth={2.2} /></button>
            <button className={styles.btn} title="Increase indent" onClick={() => onUno('.uno:IncrementIndent')}><IndentIncrease size={15} strokeWidth={2.2} /></button>
          </Group>
          <Group label="Spacing">
            <select className={styles.sizeSelect} title="Line spacing" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onUno(v) }}>
              <option value="" disabled>↕</option>
              <option value=".uno:SpacePara1">Single</option>
              <option value=".uno:SpacePara15">1.5 lines</option>
              <option value=".uno:SpacePara2">Double</option>
            </select>
          </Group>
          <Group label="Arrange">
            <button className={on('.uno:Hyphenate')} disabled={dis('.uno:Hyphenate')} title="Automatic hyphenation" onClick={() => onUno('.uno:Hyphenate')}><Spline size={15} strokeWidth={2} /></button>
          </Group>
        </div>
      )}

      {/* Design (PowerPoint) — shapes, colors, effects, slide background, layout. */}
      {(tab === 'Design' || tab === 'Table') && docType === 2 && (
        <div className={styles.tabContent}>
          <Group label="Insert">
            <button className={styles.btn} title="Rectangle" onClick={() => onDesign('office.shape:rect')}><Square size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Rounded rectangle" onClick={() => onDesign('office.shape:roundrect')}><SquareRoundCorner size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Ellipse" onClick={() => onDesign('office.shape:ellipse')}><Circle size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Line" onClick={() => onDesign('office.shape:line')}><Minus size={15} strokeWidth={2.4} /></button>
            <button className={styles.btn} title="Arrow" onClick={() => onDesign('office.shape:arrow')}><MoveUpRight size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Text box" onClick={() => onDesign('office.shape:text')}><Type size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Pen — draw a custom polygon (click points, Enter to finish)" onClick={() => onDesign('office.pen')}><PenTool size={15} strokeWidth={2} /></button>
            <button className={styles.wideBtn} title="Insert image" onClick={() => onDesign('office.image')}><ImageIcon size={14} strokeWidth={2} /> Image</button>
            <button className={styles.wideBtn} title="Vectorize an image — trace a PNG/JPG into an editable, scalable SVG" onClick={() => onDesign('office.vectorize')}><Wand2 size={14} strokeWidth={2} /> Vectorize</button>
          </Group>
          <Group label="Shape Fill">
            <div className={styles.swatches}>
              {SWATCHES.map((hex) => (
                <button key={hex} className={styles.swatch} style={{ background: hex }} title={`Fill ${hex}`} aria-label={`Fill ${hex}`} onClick={() => shapeFill(hex)} />
              ))}
            </div>
            <label className={styles.color} title="Custom fill color"><PaintBucket size={15} strokeWidth={2.2} /><input type="color" defaultValue="#5b9bd5" onChange={(e) => shapeFill(e.target.value)} /></label>
            <button className={styles.btn} title="No fill" onClick={() => onDesign('office.shapefill:-1')}><Ban size={14} strokeWidth={2} /></button>
          </Group>
          <Group label="Shape Outline">
            <div className={styles.swatches}>
              {SWATCHES.map((hex) => (
                <button key={hex} className={styles.swatch} style={{ background: hex }} title={`Outline ${hex}`} aria-label={`Outline ${hex}`} onClick={() => shapeLine(hex)} />
              ))}
            </div>
            <label className={styles.color} title="Custom outline color"><Square size={15} strokeWidth={2.2} /><input type="color" defaultValue="#1f4e79" onChange={(e) => shapeLine(e.target.value)} /></label>
            <button className={styles.btn} title="No outline" onClick={() => onDesign('office.shapeline:-1')}><Ban size={14} strokeWidth={2} /></button>
          </Group>
          <Group label="Effects">
            <button className={styles.btn} title="Toggle shadow (selected shape)" onClick={() => onDesign('office.shapeeffect:shadow:')}><Layers size={15} strokeWidth={2} /></button>
            <select className={styles.sizeSelect} title="Gradient fill (selected shape)" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onDesign(v) }}>
              <option value="" disabled>▦ Gradient</option>
              {GRADIENTS.map(([n, a, b]) => <option key={n} value={`office.shapeeffect:gradient:${a}:${b}`}>{n}</option>)}
            </select>
            <select className={styles.sizeSelect} title="Pattern fill (selected shape)" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onDesign(v) }}>
              <option value="" disabled>▥ Pattern</option>
              {PATTERNS.map(([n, s, a, d]) => <option key={n} value={`office.pattern:${s}:${a}:${d}:${PATTERN_COLOR}`}>{n}</option>)}
            </select>
          </Group>
          <Group label="Stroke">
            <select className={styles.sizeSelect} title="Line width (selected shape)" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onDesign(v) }}>
              <option value="" disabled>Width</option>
              {STROKE_WIDTHS.map(([n, v]) => <option key={n} value={`office.stroke:width:${v}`}>{n}</option>)}
            </select>
            <select className={styles.sizeSelect} title="Line style (selected shape)" value="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v) onDesign(v) }}>
              <option value="" disabled>Dash</option>
              {DASHES.map(([n, v]) => <option key={n} value={`office.stroke:dash:${v}`}>{n}</option>)}
            </select>
          </Group>
          <Group label="Order">
            <button className={styles.btn} title="Bring to front" onClick={() => onDesign('office.arrange:front')}><BringToFront size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Send to back" onClick={() => onDesign('office.arrange:back')}><SendToBack size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Bring forward" onClick={() => onDesign('office.arrange:forward')}><ArrowUp size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Send backward" onClick={() => onDesign('office.arrange:backward')}><ArrowDown size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Align">
            <button className={styles.btn} title="Align left" onClick={() => onDesign('office.arrange:left')}><AlignLeft size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Center horizontally" onClick={() => onDesign('office.arrange:hcenter')}><AlignCenter size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Align right" onClick={() => onDesign('office.arrange:right')}><AlignRight size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Align top" onClick={() => onDesign('office.arrange:top')}><AlignStartHorizontal size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Center vertically" onClick={() => onDesign('office.arrange:vmiddle')}><AlignCenterHorizontal size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Align bottom" onClick={() => onDesign('office.arrange:bottom')}><AlignEndHorizontal size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Distribute horizontally" onClick={() => onDesign('office.arrange:disth')}><Columns3 size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Distribute vertically" onClick={() => onDesign('office.arrange:distv')}><Rows3 size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Delete shape" onClick={() => onDesign('office.arrange:delete')}><Trash2 size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Slide Background">
            <label className={styles.color} title="Background color (this slide)"><Sparkles size={15} strokeWidth={2.2} /><input type="color" defaultValue="#ffffff" onChange={(e) => slideBgOne(e.target.value)} /></label>
            <label className={styles.color} title="Background color (all slides)"><Layers size={15} strokeWidth={2.2} /><input type="color" defaultValue="#ffffff" onChange={(e) => slideBgAll(e.target.value)} /></label>
            <button className={styles.btn} title="No background (this slide)" onClick={() => onDesign('office.slidebg:one:-1')}><Ban size={14} strokeWidth={2} /></button>
          </Group>
          <Group label="Slide Layout">
            <select className={styles.styleSelect} title="Apply a layout to the current slide" value="" onChange={(e) => e.target.value !== '' && onDesign(`office.slidelayout:${e.target.value}`)}>
              <option value="" disabled>Layout…</option>
              {SLIDE_LAYOUTS.map(([n, label]) => <option key={n} value={n}>{label}</option>)}
            </select>
          </Group>
          {/* Table — structural edit of the selected slide table (rows/cols/size).
              Acts on the current selection, like Shape Fill / Order / Align above;
              the macro no-ops when the selection isn't a table. */}
          <Group label="Table">
            <button className={styles.btn} title="Insert row above" onClick={() => onDesign('office.slidetable:rowbefore')}><Rows3 size={15} strokeWidth={2.2} /> <ArrowUp size={10} /></button>
            <button className={styles.btn} title="Insert row below" onClick={() => onDesign('office.slidetable:rowafter')}><Rows3 size={15} strokeWidth={2.2} /> <ArrowDown size={10} /></button>
            <button className={styles.btn} title="Insert column left" onClick={() => onDesign('office.slidetable:colbefore')}><Columns3 size={15} strokeWidth={2.2} /> <Plus size={10} /></button>
            <button className={styles.btn} title="Insert column right" onClick={() => onDesign('office.slidetable:colafter')}><Columns3 size={15} strokeWidth={2.2} /> <Plus size={10} /></button>
            <button className={styles.btn} title="Delete row" onClick={() => onDesign('office.slidetable:delrow')}><Rows3 size={15} strokeWidth={2.2} /> −</button>
            <button className={styles.btn} title="Delete column" onClick={() => onDesign('office.slidetable:delcol')}><Columns3 size={15} strokeWidth={2.2} /> −</button>
            <input className={styles.sizeSelect} style={{ width: 56 }} placeholder="Row cm" value={rowH} onChange={(e) => setRowH(e.target.value)} title="Row height (cm) — applies to the last row" />
            <button className={styles.btn} title="Apply row height" onClick={() => { const v = cmToMm100(rowH); if (v > 0) onDesign(`office.slidetable:rowheight:${v}`) }}><Rows3 size={15} strokeWidth={2.2} /></button>
            <input className={styles.sizeSelect} style={{ width: 56 }} placeholder="Col cm" value={colW} onChange={(e) => setColW(e.target.value)} title="Column width (cm) — applies to the last column" />
            <button className={styles.btn} title="Apply column width" onClick={() => { const v = cmToMm100(colW); if (v > 0) onDesign(`office.slidetable:colwidth:${v}`) }}><Columns3 size={15} strokeWidth={2.2} /></button>
          </Group>
          {/* Cell formatting — fill + text bold / size / align on the active cell(s)
              of the selected table. The macro no-ops when the selection isn't a
              table, so these are safe when nothing is selected (fail-safe). */}
          <Group label="Cell">
            <label className={styles.color} title="Cell fill color (active cell)"><PaintBucket size={15} strokeWidth={2.2} /><input type="color" defaultValue="#dbeafe" onChange={(e) => cellFmtFill(e.target.value)} /></label>
            <button className={styles.btn} title="Bold cell text" onClick={() => onDesign('office.slidetablefmt:bold:1')}><Bold size={15} strokeWidth={2.4} /></button>
            <button className={styles.btn} title="Un-bold cell text" onClick={() => onDesign('office.slidetablefmt:bold:0')}><Bold size={15} strokeWidth={1.2} /></button>
            <input className={styles.sizeSelect} style={{ width: 48 }} placeholder="pt" value={cellPt} onChange={(e) => setCellPt(e.target.value)} title="Cell text size (pt)" />
            <button className={styles.btn} title="Apply text size" onClick={() => { const v = Number(cellPt) || 0; if (v > 0) onDesign(`office.slidetablefmt:size:${v}`) }}><Hash size={15} strokeWidth={2.2} /></button>
            <button className={styles.btn} title="Align cell text left" onClick={() => onDesign('office.slidetablefmt:align:left')}><AlignLeft size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Align cell text center" onClick={() => onDesign('office.slidetablefmt:align:center')}><AlignCenter size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Align cell text right" onClick={() => onDesign('office.slidetablefmt:align:right')}><AlignRight size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Slides">
            <button className={styles.wideBtn} title="New slide" onClick={() => onSlideOp('.uno:InsertPage')}><SquarePlus size={14} strokeWidth={2} /> New</button>
            <button className={styles.btn} title="Duplicate slide" onClick={() => onSlideOp('.uno:DuplicatePage')}><Copy size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Delete slide" onClick={() => onSlideOp('.uno:DeletePage')}><Trash2 size={15} strokeWidth={2} /></button>
          </Group>
        </div>
      )}

      {/* Shape / Picture — contextual, for the selected object (all apps). */}
      {(tab === 'Shape' || tab === 'Picture') && (
        <div className={styles.tabContent} data-testid="ribbon-shape-tab">
          <Group label="Fill & outline">
            <label className={styles.color} title="Fill colour"><PaintBucket size={15} strokeWidth={2.2} /><input type="color" defaultValue="#5b9bd5" onChange={(e) => shapeFill(e.target.value)} /></label>
            <button className={styles.btn} title="No fill" onClick={() => onDesign('office.shapefill:-1')}><Ban size={15} strokeWidth={2} /></button>
            <label className={styles.color} title="Outline colour"><Baseline size={15} strokeWidth={2.2} /><input type="color" defaultValue="#1f3864" onChange={(e) => shapeLine(e.target.value)} /></label>
            <button className={styles.btn} title="No outline" onClick={() => onDesign('office.shapeline:-1')}><Ban size={15} strokeWidth={2} /></button>
          </Group>
          {tab === 'Picture' && (
            <Group label="Picture">
              <button className={on('.uno:Crop')} title="Crop" onClick={() => onUno('.uno:Crop')}><Crop size={15} strokeWidth={2} /></button>
              <button className={styles.btn} title="Compress…" onClick={() => onUno('.uno:CompressGraphic')}><FileDown size={15} strokeWidth={2} /></button>
            </Group>
          )}
          {docType === 0 && (
            <>
              <Group label="Wrap">
                <button className={on('.uno:WrapOff')} title="Wrap off" onClick={() => onUno('.uno:WrapOff')}><Square size={15} strokeWidth={2} /></button>
                <button className={on('.uno:WrapOn')} title="Page wrap" onClick={() => onUno('.uno:WrapOn')}><WrapText size={15} strokeWidth={2} /></button>
                <button className={on('.uno:WrapIdeal')} title="Optimal wrap" onClick={() => onUno('.uno:WrapIdeal')}><AlignHorizontalDistributeCenter size={15} strokeWidth={2} /></button>
                <button className={on('.uno:WrapLeft')} title="Wrap before (left)" onClick={() => onUno('.uno:WrapLeft')}><AlignLeft size={15} strokeWidth={2} /></button>
                <button className={on('.uno:WrapRight')} title="Wrap after (right)" onClick={() => onUno('.uno:WrapRight')}><AlignRight size={15} strokeWidth={2} /></button>
                <button className={on('.uno:WrapThrough')} title="Wrap through" onClick={() => onUno('.uno:WrapThrough')}><Layers size={15} strokeWidth={2} /></button>
              </Group>
              <Group label="Anchor">
                <button className={on('.uno:SetAnchorToPage')} title="Anchor to page" onClick={() => onUno('.uno:SetAnchorToPage')}><FileText size={15} strokeWidth={2} /></button>
                <button className={on('.uno:SetAnchorToPara')} title="Anchor to paragraph" onClick={() => onUno('.uno:SetAnchorToPara')}><Pilcrow size={15} strokeWidth={2} /></button>
                <button className={on('.uno:SetAnchorToChar')} title="Anchor to character" onClick={() => onUno('.uno:SetAnchorToChar')}><Type size={15} strokeWidth={2} /></button>
                <button className={on('.uno:SetAnchorAtChar')} title="Anchor as character" onClick={() => onUno('.uno:SetAnchorAtChar')}><Baseline size={15} strokeWidth={2} /></button>
              </Group>
            </>
          )}
          <Group label="Arrange">
            <button className={styles.btn} title="Bring to front" onClick={() => docType === 2 ? onDesign('office.arrange:front') : onUno('.uno:BringToFront')}><ArrowUpToLine size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Bring forward" onClick={() => docType === 2 ? onDesign('office.arrange:forward') : onUno('.uno:ObjectForwardOne')}><ArrowUp size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Send backward" onClick={() => docType === 2 ? onDesign('office.arrange:backward') : onUno('.uno:ObjectBackOne')}><ArrowDown size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Send to back" onClick={() => docType === 2 ? onDesign('office.arrange:back') : onUno('.uno:SendToBack')}><ArrowDownToLine size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Rotate & flip">
            <button className={styles.btn} title="Flip horizontally" onClick={() => onUno(docType === 0 ? '.uno:FlipHorizontal' : docType === 1 ? '.uno:ObjectMirrorHorizontal' : '.uno:MirrorHorz')}><FlipHorizontal size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Flip vertically" onClick={() => onUno(docType === 0 ? '.uno:FlipVertical' : docType === 1 ? '.uno:ObjectMirrorVertical' : '.uno:MirrorVert')}><FlipVertical size={15} strokeWidth={2} /></button>
            {docType === 0 && <button className={styles.btn} title="Rotate 90° left" onClick={() => onUno('.uno:RotateLeft')}><RotateCcw size={15} strokeWidth={2} /></button>}
            {docType === 0 && <button className={styles.btn} title="Rotate 90° right" onClick={() => onUno('.uno:RotateRight')}><RotateCw size={15} strokeWidth={2} /></button>}
          </Group>
          <Group label="Group">
            <button className={styles.btn} disabled={dis('.uno:FormatGroup')} title="Group" onClick={() => onUno('.uno:FormatGroup')}><Group2 size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Ungroup" onClick={() => onUno('.uno:FormatUngroup')}><Ungroup size={15} strokeWidth={2} /></button>
          </Group>
          {docType === 0 && (
            <Group label="Wrap & anchor">
              <select className={styles.sizeSelect} defaultValue="" title="Text wrap" onChange={(e) => { if (e.target.value) onUno(e.target.value); e.target.value = '' }}>
                <option value="" disabled>Wrap…</option>
                <option value=".uno:WrapOff">None</option><option value=".uno:WrapOn">Parallel</option><option value=".uno:WrapIdeal">Optimal</option>
                <option value=".uno:WrapLeft">Before</option><option value=".uno:WrapRight">After</option><option value=".uno:WrapThrough">Through</option>
              </select>
              <select className={styles.sizeSelect} defaultValue="" title="Anchor" onChange={(e) => { if (e.target.value) onUno(e.target.value); e.target.value = '' }}>
                <option value="" disabled>Anchor…</option>
                <option value=".uno:SetAnchorToPage">To page</option><option value=".uno:SetAnchorToPara">To paragraph</option>
                <option value=".uno:SetAnchorToChar">To character</option><option value=".uno:SetAnchorAtChar">As character</option>
              </select>
            </Group>
          )}
          <Group label="More">
            {docType === 2 && <button className={styles.wideBtn} title="Duplicate… (copies with an offset)" data-testid="shape-duplicate" onClick={() => onUno('.uno:CopyObjects')}><Copy size={14} strokeWidth={2} /> Duplicate</button>}
            <button className={styles.wideBtn} title="Position and size…" onClick={() => onUno('.uno:TransformDialog')}><Move size={14} strokeWidth={2} /> Position…</button>
            <button className={styles.wideBtn} title="Alt text…" onClick={() => onUno('.uno:ObjectTitleDescription')}><Info size={14} strokeWidth={2} /> Alt text</button>
            <button className={styles.btn} title="Delete" onClick={() => docType === 2 ? onDesign('office.arrange:delete') : onUno('.uno:Delete')}><Trash2 size={15} strokeWidth={2} /></button>
          </Group>
        </div>
      )}

      {/* Table — contextual, for the table under the cursor (Writer) or the selected slide table (Impress). */}
      {tab === 'Table' && docType === 0 && (
        <div className={styles.tabContent} data-testid="ribbon-table-tab">
          <Group label="Rows & columns">
            <button className={styles.btn} title="Insert row above" onClick={() => onUno('.uno:InsertRowsBefore')}><Rows3 size={15} strokeWidth={2.2} /> <ArrowUp size={10} /></button>
            <button className={styles.btn} title="Insert row below" data-testid="table-row-below" onClick={() => onUno('.uno:InsertRowsAfter')}><Rows3 size={15} strokeWidth={2.2} /> <ArrowDown size={10} /></button>
            <button className={styles.btn} title="Insert column before" onClick={() => onUno('.uno:InsertColumnsBefore')}><Columns3 size={15} strokeWidth={2.2} /> <Plus size={10} /></button>
            <button className={styles.btn} title="Insert column after" onClick={() => onUno('.uno:InsertColumnsAfter')}><Columns3 size={15} strokeWidth={2.2} /> <Plus size={10} /></button>
            <button className={styles.btn} title="Delete row" onClick={() => onUno('.uno:DeleteRows')}><Rows3 size={15} strokeWidth={2.2} /> −</button>
            <button className={styles.btn} title="Delete column" onClick={() => onUno('.uno:DeleteColumns')}><Columns3 size={15} strokeWidth={2.2} /> −</button>
            <button className={styles.btn} title="Delete table" onClick={() => onUno('.uno:DeleteTable')}><Trash2 size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Cells">
            <button className={styles.btn} title="Merge cells" disabled={dis('.uno:MergeCells')} onClick={() => onUno('.uno:MergeCells')}><Merge size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Split cells…" onClick={() => onUno('.uno:SplitCell')}><Split size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Optimal row height" onClick={() => onUno('.uno:SetOptimalRowHeight')}><Rows3 size={15} strokeWidth={2.2} /></button>
            <button className={styles.btn} title="Optimal column width" onClick={() => onUno('.uno:SetOptimalColumnWidth')}><Columns3 size={15} strokeWidth={2.2} /></button>
            <button className={styles.btn} title="Distribute rows evenly" onClick={() => onUno('.uno:DistributeRows')}><AlignVerticalDistributeCenter size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Distribute columns evenly" onClick={() => onUno('.uno:DistributeColumns')}><AlignHorizontalDistributeCenter size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Style">
            <select className={styles.sizeSelect} defaultValue="" title="Table style" onChange={(e) => { if (e.target.value) onUno(`.uno:StyleApply {"Style":{"type":"string","value":"${e.target.value}"},"FamilyName":{"type":"string","value":"TableStyles"}}`); e.target.value = '' }}>
              <option value="" disabled>Style…</option>
              {['Default Style', 'Academic', 'Elegant', 'Financial', 'Box List Blue', 'Box List Green', 'Box List Red', 'Box List Yellow'].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className={on('.uno:HeadingRowsRepeat')} title="Repeat header rows across pages" onClick={() => onUno('.uno:HeadingRowsRepeat')}><Rows3 size={15} strokeWidth={2.2} /></button>
            <button className={styles.wideBtn} title="Table properties…" onClick={() => onUno('.uno:TableDialog')}><Table2 size={14} strokeWidth={2} /> Properties…</button>
          </Group>
        </div>
      )}

      {/* View — zoom (all types) plus doc-specific display toggles. */}
      {tab === 'Transitions' && docType === 2 && (
        <div className={styles.tabContent} data-testid="ribbon-transitions-tab">
          <Group label="Transition to this slide">
            {TRANSITIONS.map((t) => {
              const cur = transitionOf(transition)?.id === t.id
              return <button key={t.id} className={cur ? styles.wideBtnActive : styles.wideBtn} data-testid={`transition-${t.id}`} title={t.label} onClick={() => onTransition?.(`set:${t.id}`)}>{t.label}</button>
            })}
          </Group>
          <Group label="Timing">
            <select className={styles.sizeSelect} title="Duration" value={String(transition?.duration ?? 1)} onChange={(e) => onTransition?.(`duration:${e.target.value}`)}>
              {[...new Set([...TRANSITION_DURATIONS, transition?.duration ?? 1])].sort((a, b) => a - b).map((d) => <option key={d} value={String(d)}>{d} s</option>)}
            </select>
            <label className={styles.check} title="Advance on click">
              <input type="checkbox" checked={(transition?.change ?? 0) !== 1} onChange={(e) => onTransition?.(`advance:${e.target.checked ? 'click' : 'auto'}:${transition?.advance || 5}`)} /> On click
            </label>
            <label className={styles.check} title="Advance automatically after this many seconds">
              <input type="checkbox" data-testid="transition-auto" checked={(transition?.change ?? 0) === 1} onChange={(e) => onTransition?.(`advance:${e.target.checked ? 'auto' : 'click'}:${transition?.advance || 5}`)} /> After
              <input className={styles.num} type="number" min={0} max={3600} step={0.5} data-testid="transition-advance" key={`adv${transition?.advance ?? 0}`} defaultValue={transition?.advance ?? 5}
                onBlur={(e) => { const v = Number(e.target.value); if (v >= 0 && v !== (transition?.advance ?? 0)) onTransition?.(`advance:${(transition?.change ?? 0) === 1 ? 'auto' : 'click'}:${v}`) }} /> s
            </label>
            <button className={styles.wideBtn} title="Apply this transition and timing to every slide" data-testid="transition-all" onClick={() => onTransition?.('all')}><Copy size={14} strokeWidth={2} /> Apply to all</button>
          </Group>
        </div>
      )}
      {tab === 'Animations' && docType === 2 && (
        <div className={styles.tabContent} data-testid="ribbon-animations-tab">
          {(['entrance', 'emphasis', 'exit'] as const).map((cls) => (
            <Group key={cls} label={cls === 'entrance' ? 'Entrance' : cls === 'emphasis' ? 'Emphasis' : 'Exit'}>
              {ANIMATION_PRESETS.filter((p) => p.cls === cls).map((p) => (
                <button key={p.id} className={styles.wideBtn} data-testid={`anim-${p.id}`} title={`${p.label} (${cls})`} onClick={() => onAnimate?.(`add:${p.id}:${animStart}`)}>{p.label}</button>
              ))}
            </Group>
          ))}
          <Group label="Start">
            <select className={styles.sizeSelect} title="When the next effect starts" value={animStart} onChange={(e) => setAnimStart(Number(e.target.value))}>
              {NODE_TYPES.map(([n, label]) => <option key={n} value={n}>{label}</option>)}
            </select>
          </Group>
          <Group label="Sequence">
            <button className={animPaneOpen ? styles.wideBtnActive : styles.wideBtn} title="Show the animation pane" data-testid="anim-pane" onClick={() => onAnimate?.('pane')}><Sparkles size={14} strokeWidth={2} /> Animation pane{effects && effects.length > 0 ? ` (${effects.length})` : ''}</button>
          </Group>
        </div>
      )}
      {tab === 'Layout' && docType === 1 && (
        <div className={styles.tabContent} data-testid="ribbon-calc-layout-tab">
          <Group label="Margins">
            {MARGIN_PRESETS.map(([label, v]) => (
              <button key={label} className={styles.wideBtn} title={`${label} margins`} onClick={() => onDesign(`office.margins:all:${v}`)}><LayoutIcon size={14} strokeWidth={2} /> {label}</button>
            ))}
          </Group>
          <Group label="Orientation">
            <button className={styles.wideBtn} title="Portrait" onClick={() => onDesign('office.orient:portrait')}><RectangleVertical size={14} strokeWidth={2} /> Portrait</button>
            <button className={styles.wideBtn} title="Landscape" onClick={() => onDesign('office.orient:landscape')}><RectangleHorizontal size={14} strokeWidth={2} /> Landscape</button>
          </Group>
          <Group label="Page">
            <button className={styles.wideBtn} title="Headers and footers…" onClick={() => onUno('.uno:EditHeaderAndFooter')}><PanelTop size={14} strokeWidth={2} /> Header & footer</button>
            <button className={styles.wideBtn} title="Page style… (size, scaling, sheet options)" onClick={() => onUno('.uno:PageFormatDialog')}><FileText size={14} strokeWidth={2} /> Page style</button>
          </Group>
          <Group label="Breaks">
            <button className={styles.wideBtn} title="Insert row break above the cursor" onClick={() => onUno('.uno:InsertRowBreak')}><SeparatorHorizontal size={14} strokeWidth={2} /> Row break</button>
            <button className={styles.wideBtn} title="Insert column break left of the cursor" onClick={() => onUno('.uno:InsertColumnBreak')}><SeparatorVertical size={14} strokeWidth={2} /> Column break</button>
            <button className={styles.btn} title="Remove row break" onClick={() => onUno('.uno:DeleteRowbreak')}><X size={15} strokeWidth={2} /></button>
            <button className={styles.btn} title="Remove column break" onClick={() => onUno('.uno:DeleteColumnbreak')}><X size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Print area">
            <button className={styles.wideBtn} title="Define print area from the selection" onClick={() => onUno('.uno:DefinePrintArea')}><Printer size={14} strokeWidth={2} /> Define</button>
            <button className={styles.btn} title="Clear print area" onClick={() => onUno('.uno:DeletePrintArea')}><Ban size={15} strokeWidth={2} /></button>
          </Group>
        </div>
      )}
      {tab === 'Formulas' && docType === 1 && (
        <div className={styles.tabContent} data-testid="ribbon-formulas-tab">
          <Group label="Function">
            <button className={styles.btn} title="AutoSum" onClick={() => onUno('.uno:AutoSum')}><Sigma size={15} strokeWidth={2.2} /></button>
            <button className={styles.wideBtn} title="Function wizard…" onClick={() => onUno('.uno:FunctionDialog')}><Sigma size={14} strokeWidth={2} /> Insert function</button>
          </Group>
          <Group label="Calculation">
            <button className={styles.wideBtn} title="Recalculate (F9)" onClick={() => onUno('.uno:Calculate')}><RefreshCw size={14} strokeWidth={2} /> Recalculate</button>
            <button className={styles.wideBtn} title="Recalculate hard (⇧⌘F9)" onClick={() => onUno('.uno:CalculateHard')}><RefreshCw size={14} strokeWidth={2} /> Hard</button>
            <button className={on('.uno:AutomaticCalculation')} title="AutoCalculate" onClick={() => onUno('.uno:AutomaticCalculation')}><Sparkles size={15} strokeWidth={2} /></button>
            <button className={styles.wideBtn} title="Formula to value" onClick={() => onUno('.uno:ConvertFormulaToValue')}><Hash size={14} strokeWidth={2} /> To value</button>
            <button className={on('.uno:ToggleFormula')} data-testid="show-formulas" title="Show formulas instead of results" onClick={() => onUno('.uno:ToggleFormula')}><Eye size={15} strokeWidth={2} /></button>
          </Group>
          <Group label="Auditing">
            <button className={styles.wideBtn} title="Trace precedents" onClick={() => onUno('.uno:ShowPrecedents')}><MoveUpRight size={14} strokeWidth={2} /> Precedents</button>
            <button className={styles.wideBtn} title="Trace dependents" onClick={() => onUno('.uno:ShowDependents')}><MoveUpRight size={14} strokeWidth={2} style={{ transform: 'scaleX(-1)' }} /> Dependents</button>
            <button className={styles.wideBtn} title="Trace errors" onClick={() => onUno('.uno:ShowErrors')}><Ban size={14} strokeWidth={2} /> Errors</button>
            <button className={styles.wideBtn} title="Mark invalid data" onClick={() => onUno('.uno:ShowInvalid')}><Highlighter size={14} strokeWidth={2} /> Invalid</button>
            <button className={styles.btn} title="Remove all traces" onClick={() => onUno('.uno:ClearArrows')}><X size={15} strokeWidth={2} /></button>
          </Group>
        </div>
      )}
      {tab === 'References' && docType === 0 && (
        <div className={styles.tabContent} data-testid="ribbon-references-tab">
          <Group label="Table of Contents">
            <button className={styles.wideBtn} title="Insert a table of contents from the headings (Heading 1–10)" data-testid="toc-insert" onClick={() => onDesign('office.toc:insert')}><List size={14} strokeWidth={2} /> Table of contents</button>
            <button className={styles.wideBtn} title="Table of contents, index or bibliography… (custom)" onClick={() => onUno('.uno:InsertMultiIndex')}><SlidersHorizontal size={14} strokeWidth={2} /> Custom…</button>
            <button className={styles.wideBtn} title="Update every index and table of contents" onClick={() => onDesign('office.toc:update')}><RefreshCw size={14} strokeWidth={2} /> Update</button>
          </Group>
          <Group label="Footnotes">
            <button className={styles.wideBtn} title="Insert footnote" onClick={() => onUno('.uno:InsertFootnote')}><Asterisk size={14} strokeWidth={2} /> Footnote</button>
            <button className={styles.wideBtn} title="Insert endnote" onClick={() => onUno('.uno:InsertEndnote')}><BookMarked size={14} strokeWidth={2} /> Endnote</button>
          </Group>
          <Group label="Captions & Links">
            <button className={styles.wideBtn} title="Caption… (for the selected image or table)" onClick={() => onUno('.uno:InsertCaptionDialog')}><Tag size={14} strokeWidth={2} /> Caption</button>
            <button className={styles.wideBtn} title="Bookmark…" onClick={() => onUno('.uno:InsertBookmark')}><BookMarked size={14} strokeWidth={2} /> Bookmark</button>
            <button className={styles.wideBtn} title="Cross-reference…" onClick={() => onUno('.uno:InsertReferenceField')}><Link2 size={14} strokeWidth={2} /> Cross-reference</button>
          </Group>
          <Group label="Fields">
            <button className={styles.wideBtn} title="Update all fields" onClick={() => onUno('.uno:UpdateAll')}><RefreshCw size={14} strokeWidth={2} /> Update fields</button>
            <button className={styles.wideBtn} title="Fields…" onClick={() => onUno('.uno:FieldDialog')}><Hash size={14} strokeWidth={2} /> Fields…</button>
          </Group>
        </div>
      )}
      {tab === 'View' && (
        <div className={styles.tabContent}>
          <Group label="Mode">
            {docType === 0 && (<>
              <button className={styles.wideBtn} title="Normal (print layout)" data-testid="mode-normal" onClick={() => onUno('.uno:PrintLayout')}><FileText size={14} strokeWidth={2} /> Normal</button>
              <button className={styles.wideBtn} title="Web layout" data-testid="mode-web" onClick={() => onUno('.uno:BrowseView')}><Globe size={14} strokeWidth={2} /> Web</button>
              <button className={styles.wideBtn} title="Print preview — every page side by side" data-testid="mode-preview" onClick={() => onDesign('office.view:preview')}><Printer size={14} strokeWidth={2} /> Print preview</button>
            </>)}
            {docType === 1 && (<>
              <button className={styles.wideBtn} title="Normal" data-testid="mode-normal" onClick={() => onUno('.uno:NormalViewMode')}><Grid3x3 size={14} strokeWidth={2} /> Normal</button>
              <button className={styles.wideBtn} title="Page break preview" data-testid="mode-pagebreak" onClick={() => onUno('.uno:PagebreakMode')}><FileText size={14} strokeWidth={2} /> Page break</button>
            </>)}
            {docType === 2 && (<>
              <button className={`${styles.wideBtn} ${active['.uno:NormalMultiPaneGUI'] === 'true' ? styles.btnActive : ''}`} title="Normal" data-testid="mode-normal" onClick={() => onUno('.uno:NormalMultiPaneGUI')}><Presentation size={14} strokeWidth={2} /> Normal</button>
              <button className={`${styles.wideBtn} ${active['.uno:NotesMode'] === 'true' ? styles.btnActive : ''}`} title="Notes page" data-testid="mode-notes" onClick={() => onUno('.uno:NotesMode')}><StickyNote size={14} strokeWidth={2} /> Notes</button>
              <button className={`${styles.wideBtn} ${active['.uno:SlideMasterPage'] === 'true' ? styles.btnActive : ''}`} title="Master slide" data-testid="mode-master" onClick={() => onUno('.uno:SlideMasterPage')}><LayoutTemplate size={14} strokeWidth={2} /> Master</button>
              <button className={styles.wideBtn} title="Slide sorter — every slide as a grid, drag to reorder" data-testid="mode-sorter" onClick={() => onDesign('office.view:sorter')}><Grid3x3 size={14} strokeWidth={2} /> Sorter</button>
              <button className={styles.wideBtn} title="Outline — every slide's title and text" data-testid="mode-outline" onClick={() => onDesign('office.view:outline')}><List size={14} strokeWidth={2} /> Outline</button>
            </>)}
          </Group>
          <Group label="Zoom">
            {ZOOM_PRESETS.map((p) => (
              <button key={p} className={Math.round(zoom * 100) === p ? styles.btnActive : styles.btn} title={`Zoom to ${p}%`} onClick={() => onSetZoom(p / 100)}>{p}%</button>
            ))}
            <button className={styles.btn} title="Reset to 100%" onClick={() => onSetZoom(1)}><ZoomIn size={15} strokeWidth={2} /></button>
          </Group>
          {docType === 0 && (
            <Group label="Show">
              <button className={on('.uno:ControlCodes')} disabled={dis('.uno:ControlCodes')} title="Formatting marks" onClick={() => onUno('.uno:ControlCodes')}><Pilcrow size={15} strokeWidth={2.2} /></button>
              <button className={props.rulerOn ? styles.btnActive : styles.btn} title="Ruler" data-testid="view-ruler" onClick={() => onDesign('office.ruler')}><MoveHorizontal size={15} strokeWidth={2.2} /></button>
            </Group>
          )}
          {docType === 1 && (
            <>
              <Group label="Show">
                <button className={on('.uno:ToggleSheetGrid')} disabled={dis('.uno:ToggleSheetGrid')} title="Gridlines" onClick={() => onUno('.uno:ToggleSheetGrid')}><Grid3x3 size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:ViewRowColumnHeaders')} disabled={dis('.uno:ViewRowColumnHeaders')} title="Headings (A·B·C / 1·2·3)" onClick={() => onUno('.uno:ViewRowColumnHeaders')}><LayoutIcon size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:ViewValueHighlighting')} title="Value highlighting (numbers blue, formulas green)" onClick={() => onUno('.uno:ViewValueHighlighting')}><Highlighter size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:ToggleFormula')} title="Show formulas" onClick={() => onUno('.uno:ToggleFormula')}><Sigma size={15} strokeWidth={2.2} /></button>
                <button className={on('.uno:ViewColumnRowHighlighting')} title="Highlight the active row and column" onClick={() => onUno('.uno:ViewColumnRowHighlighting')}><Rows3 size={15} strokeWidth={2.2} /></button>
              </Group>
              <Group label="Window">
                <button className={on('.uno:FreezePanes')} disabled={dis('.uno:FreezePanes')} title="Freeze panes" onClick={() => onUno('.uno:FreezePanes')}><Snowflake size={15} strokeWidth={2} /></button>
              </Group>
            </>
          )}
          {docType === 2 && (
            <Group label="Show">
              <button className={on('.uno:GridVisible')} disabled={dis('.uno:GridVisible')} title="Display grid" onClick={() => onUno('.uno:GridVisible')}><Grid3x3 size={15} strokeWidth={2.2} /></button>
              <button
                className={notesOn ? styles.btnActive : styles.btn}
                title="Speaker notes — per-slide presenter notes"
                onClick={() => onToggleNotes?.()}
              >
                <StickyNote size={15} strokeWidth={2.2} /> Notes
              </button>
            </Group>
          )}
        </div>
      )}

      {/* Fallback for any tab without dedicated content (should be none). */}
      {!['Home', 'Insert', 'Review', 'Data', 'View', 'Shape', 'Picture', 'Table'].includes(tab) &&
        !(tab === 'Layout' && docType === 0) &&
        !(tab === 'Layout' && docType === 1) &&
        !(tab === 'References' && docType === 0) &&
        !(tab === 'Formulas' && docType === 1) &&
        !(tab === 'Design' && docType === 2) &&
        !(tab === 'Transitions' && docType === 2) &&
        !(tab === 'Animations' && docType === 2) && (
        <div className={styles.tabContent}>
          <div className={styles.placeholder}>{tab} — coming soon (see the function roadmap)</div>
        </div>
      )}
    </div>
  )
})
