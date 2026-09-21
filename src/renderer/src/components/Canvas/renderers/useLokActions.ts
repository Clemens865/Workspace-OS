import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Component } from '../../../types/workspace-api'
import type { SelectedInstance } from './ComponentsPanel'

type Rect = { x: number; y: number; w: number; h: number }
type Parts = { names: string[]; cur: number; type: number }

interface UseLokActionsArgs {
  paint: () => Promise<void>
  scheduleRepaint: () => void
  docRef: MutableRefObject<{ w: number; h: number } | null>
  /** Current part, kept imperative — these actions paint BEFORE React re-renders. */
  partRef?: MutableRefObject<number>
  graphicSelTwRef: MutableRefObject<Rect | null>
  setDirty: Dispatch<SetStateAction<boolean>>
  setParts: Dispatch<SetStateAction<Parts>>
  setThumbsKey: Dispatch<SetStateAction<number>>
  /** Per-part visibility (hidden sheets / hidden slides), refreshed after part ops. */
  setPartsVisible?: Dispatch<SetStateAction<boolean[]>>
  /** Twips → px at the current zoom (for overlays computed from model bounds). */
  pxPerTwipRef?: MutableRefObject<number>
  setCaret: Dispatch<SetStateAction<{ x: number; y: number; h: number } | null>>
  setGraphicSel: Dispatch<SetStateAction<Rect | null>>
  components: Component[]
  setComponents: Dispatch<SetStateAction<Component[]>>
  selectedInstance: SelectedInstance | null
  setSelectedInstance: Dispatch<SetStateAction<SelectedInstance | null>>
  isCalc: boolean
  isImpress: boolean
  refreshGeometry: () => Promise<void>
  partsCur: number
}

/**
 * Engine document/shape/component actions for the LOK renderer: slide & sheet
 * structural ops, Impress shape macros, chart insertion, the Framer-style
 * component library ops, part navigation and Calc header resize. Extracted
 * verbatim from LokRenderer — each callback keeps its original dependency
 * cadence (values like `components`/`selectedInstance`/`partsCur` are passed
 * in and appear in the same deps arrays as before).
 */
export function useLokActions({
  paint,
  scheduleRepaint,
  docRef,
  partRef,
  graphicSelTwRef,
  setDirty,
  setParts,
  setThumbsKey,
  setPartsVisible,
  pxPerTwipRef,
  setCaret,
  setGraphicSel,
  components,
  setComponents,
  selectedInstance,
  setSelectedInstance,
  isCalc,
  isImpress,
  refreshGeometry,
  partsCur,
}: UseLokActionsArgs) {
  // Slide/sheet structural op (insert/duplicate/delete) — run it, then re-query
  // the part list and repaint the now-current part.
  const doSlideOp = useCallback((command: string) => {
    void window.workspace.lok.uno(command)
    setDirty(true)
    setTimeout(async () => {
      const r = await window.workspace.lok.parts()
      setParts((p) => ({ ...p, cur: r.cur, names: r.names }))
      const sz = await window.workspace.lok.setPart(r.cur)
      if (sz.ok) docRef.current = { w: sz.w, h: sz.h }
      if (partRef) partRef.current = r.cur
      await paint()
      setThumbsKey((k) => k + 1)
    }, 280)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Drag-reorder a slide from one position to another (Impress).
  const reorderSlide = useCallback(async (from: number, to: number) => {
    if (from === to) return
    await window.workspace.lok.setPart(from)
    const cmd = to > from ? '.uno:MovePageDown' : '.uno:MovePageUp'
    for (let i = 0; i < Math.abs(to - from); i++) {
      await window.workspace.lok.uno(cmd)
      await new Promise((r) => setTimeout(r, 90))
    }
    setDirty(true)
    const r = await window.workspace.lok.parts()
    const sz = await window.workspace.lok.setPart(to)
    if (sz.ok) docRef.current = { w: sz.w, h: sz.h }
    if (partRef) partRef.current = to
    setParts((p) => ({ ...p, cur: to, names: r.names }))
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Calc sheet management (insert/delete/rename/move) via the model-API macro,
  // then re-query the sheet list and repaint the now-current sheet.
  const sheetOp = useCallback(async (op: string, arg?: string) => {
    await window.workspace.lok.macro('WosSheetOp', arg ? `${op}|${arg}` : op)
    setDirty(true)
    const r = await window.workspace.lok.parts()
    const sz = await window.workspace.lok.setPart(r.cur)
    if (sz.ok) docRef.current = { w: sz.w, h: sz.h }
    if (partRef) partRef.current = r.cur
    setParts((p) => ({ ...p, cur: r.cur, names: r.names }))
    await paint()
    if (isCalc) void refreshGeometry()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, isCalc, refreshGeometry])

  /** Re-read which sheets/slides are hidden (the model, not LOK parts). */
  const refreshPartInfo = useCallback(async () => {
    if (!setPartsVisible) return
    try {
      const r = await window.workspace.lok.partInfo()
      setPartsVisible(r.visible)
    } catch { /* leave as is */ }
  }, [setPartsVisible])

  /** Sheet operation on a SPECIFIC tab (the one right-clicked): activate it first. */
  const sheetOpAt = useCallback(async (op: string, index: number, arg?: string) => {
    const r = await window.workspace.lok.parts()
    if (index !== r.cur) await window.workspace.lok.setPart(index)
    await sheetOp(op, arg)
    await refreshPartInfo()
  }, [sheetOp, refreshPartInfo])

  /**
   * Slide operation on a SPECIFIC thumbnail: new · duplicate · delete · rename
   * · hide · show · layout · moveto. Structural ones go through the engine
   * (InsertPage/DuplicatePage/DeletePage act on the current slide, so it is
   * selected first); the rest through WosSlideOp / AssignLayout by index.
   */
  const slideOp = useCallback(async (op: string, index: number, arg?: string) => {
    const uno = async (cmd: string): Promise<void> => { await window.workspace.lok.uno(cmd) }
    if (op === 'moveto') { await reorderSlide(index, Number(arg)); await refreshPartInfo(); return }
    await window.workspace.lok.setPart(index)
    if (op === 'new') await uno('.uno:InsertPage')
    else if (op === 'duplicate') await uno('.uno:DuplicatePage')
    else if (op === 'delete') await uno('.uno:DeletePage')
    else if (op === 'layout') await uno(`.uno:AssignLayout {"WhatLayout":{"type":"long","value":${Number(arg) || 0}}}`)
    else if (op === 'rename') await window.workspace.lok.macro('WosSlideOp', `rename|${index}|${(arg ?? '').replace(/[|\n]/g, ' ')}`)
    else if (op === 'hide' || op === 'show') await window.workspace.lok.macro('WosSlideOp', `${op}|${index}`)
    setDirty(true)
    await new Promise((r) => setTimeout(r, 200))
    const r = await window.workspace.lok.parts()
    const sz = await window.workspace.lok.setPart(r.cur)
    if (sz.ok) docRef.current = { w: sz.w, h: sz.h }
    if (partRef) partRef.current = r.cur
    setParts((p) => ({ ...p, cur: r.cur, names: r.names }))
    await paint()
    setThumbsKey((k) => k + 1)
    await refreshPartInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, reorderSlide, refreshPartInfo])

  // Writer table editing at the cursor (insert/delete row/column) via the macro.
  // The op acts on whichever table cell currently holds the view cursor.
  const tableOp = useCallback(async (op: string) => {
    await window.workspace.lok.macro('WosTableOp', op)
    setDirty(true)
    scheduleRepaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRepaint])

  // Impress: STRUCTURAL edit of the selected slide TABLE (add/remove rows &
  // columns, set row height / column width) via the model-API macro. Rows/cols
  // reshape the whole table so this is a full paint + thumbnail refresh (mirrors
  // slideLayout, not the cursor-band scheduleRepaint the Writer tableOp uses).
  // `arg` is a size in 1/100 mm for rowheight/colwidth.
  const slideTableOp = useCallback(async (op: string, arg?: number, cell?: { row: number; col: number } | null) => {
    // op|arg|row|col — an explicit cell (from the table edges + the click point)
    // beats the macro's own guess, which falls back to the last row/column.
    const a = arg !== undefined ? String(arg) : ''
    const args = cell ? `${op}|${a}|${cell.row}|${cell.col}` : (arg !== undefined ? `${op}|${arg}` : op)
    await window.workspace.lok.macro('WosSlideTableOp', args)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: CELL FORMATTING of the selected slide TABLE — fill color + text
  // bold / size / align on the active cell(s). Mirrors slideTableOp (full paint +
  // thumbnail refresh) since a cell's fill/text changes the rendered slide. `prop`
  // = fill|bold|size|align; `value` carries the UNO color / 1|0 / pt / alignment.
  // The macro no-ops when the selection isn't a table, so this is a safe click.
  const slideTableCellFmt = useCallback(async (prop: string, value: string) => {
    await window.workspace.lok.macro('WosSlideTableCellFmt', `${prop}|${value}`)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Word Layout (Writer page-style model API): margins / orientation / header &
  // footer / page number. Each runs the matching Wos* macro on the doc's page
  // style; the change persists to the .docx sectPr / header1.xml / footer1.xml on
  // save. Writer reflows the page, so a full repaint is scheduled after.
  const layoutOp = useCallback(async (macro: string, args: string) => {
    await window.workspace.lok.macro(macro, args)
    setDirty(true)
    scheduleRepaint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleRepaint])

  // Impress: assign an auto-layout (Title Slide / Title+Content / Two Content /
  // Title Only / Blank) to the CURRENT slide via the model-API macro. Adding or
  // removing placeholders reshapes the whole slide, so this is a full paint +
  // thumbnail refresh (not the cursor-band scheduleRepaint the Writer layoutOp
  // uses). `n` is a LibreOffice AUTOLAYOUT id.
  const slideLayout = useCallback(async (n: number) => {
    await window.workspace.lok.macro('WosSetLayout', String(n))
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: insert a shape (rect/ellipse/line/arrow/text) on the current slide,
  // then repaint the canvas + refresh the thumbnail rail.
  const shapeInsert = useCallback(async (kind: string) => {
    await window.workspace.lok.macro('WosShapeInsert', kind)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // The macro selected the new shape in the engine, but a selection made
    // inside a macro never reaches the renderer (callbacks are muted). Take the
    // shape's bounds and show the selection overlay from them.
    try {
      const b = await window.workspace.lok.lastShape()
      if (b && pxPerTwipRef) {
        const tw = (v: number): number => Math.round((v * 1440) / 2540)
        const r = { x: tw(b.x), y: tw(b.y), w: Math.max(60, tw(b.w)), h: Math.max(60, tw(b.h)) }
        graphicSelTwRef.current = r
        const p = pxPerTwipRef.current
        setGraphicSel({ x: r.x * p, y: r.y * p, w: r.w * p, h: r.h * p })
      }
    } catch { /* selection overlay is a convenience */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: recolor the selected shape(s). which = fill|line; -1 clears it.
  const shapeColor = useCallback(async (which: 'fill' | 'line', color: number) => {
    await window.workspace.lok.macro('WosShapeColor', `${which}|${color}`)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: set the slide background (scope = one|all; -1 clears it). Backed by
  // a full-slide, locked, back-most rectangle since the engine's slide Background
  // property is non-functional.
  const slideBg = useCallback(async (scope: 'one' | 'all', color: number) => {
    await window.workspace.lok.macro('WosSlideBg', `${scope}|${color}`)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: style the text of the selected shape(s). prop = color|size|font|
  // bold|italic|align; value carries the font name / size / color / alignment.
  const shapeText = useCallback(async (prop: string, value: string) => {
    await window.workspace.lok.macro('WosShapeText', value ? `${prop}|${value}` : prop)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: fill/effect on the selected shape(s) — gradient or shadow toggle.
  const shapeEffect = useCallback(async (args: string) => {
    await window.workspace.lok.macro('WosShapeEffect', args)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: arrange the selected shape(s) — z-order, align (slide for one,
  // selection bbox for several, PowerPoint-style), distribute, or delete.
  const arrange = useCallback(async (op: string) => {
    if (op === 'delete') { graphicSelTwRef.current = null; setGraphicSel(null) }
    await window.workspace.lok.macro('WosArrange', op)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: hatch/pattern fill on the selected shape(s). args = "style|angle|dist|color".
  const shapePattern = useCallback(async (args: string) => {
    await window.workspace.lok.macro('WosShapePattern', args)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Impress: stroke options on the selected shape(s). args = "width|N" or "dash|style".
  const shapeStroke = useCallback(async (args: string) => {
    await window.workspace.lok.macro('WosShapeStroke', args)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Excel: apply/clear a conditional-formatting rule on the selected range via
  // the model-API macro. args = "op|value1|value2|fillColor" (op = gt/lt/geq/leq/
  // eq/between/clear). The rule persists as <conditionalFormatting>+<cfRule> in
  // the saved .xlsx, with the fill carried by a WosCF_* cell style (its dxf).
  const condFormat = useCallback(async (args: string) => {
    await window.workspace.lok.macro('WosCondFormat', args)
    setDirty(true)
    await paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Excel: apply/clear a data-validation rule on the selected range via the
  // model-API macro. args = "kind|arg1|arg2" (kind = list/whole/decimal/textlen/
  // clear). The rule persists as <dataValidations><dataValidation type="…"> in
  // the saved .xlsx — a LIST as type="list" with the values in <formula1>, a
  // whole/decimal range as a BETWEEN with min/max formulas, textlen as a max.
  const dataValidation = useCallback(async (args: string) => {
    await window.workspace.lok.macro('WosDataValidation', args)
    setDirty(true)
    await paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Insert a persistent native chart. type = column|bar|line|pie|area. Branches
  // by doc kind: Impress (parts.type === 2) → WosInsertSlideChart drops a native
  // embedded chart on the current slide with inline sample data (round-trips as
  // ppt/charts/chartN.xml + a bound <c:ser>). Calc → WosInsertChart binds to the
  // live multi-cell selection, else the used area (round-trips as xl/charts/…).
  // Both persist as REAL chart XML, not an image.
  const chartInsert = useCallback(async (ctype: string) => {
    if (isImpress) await window.workspace.lok.macro('WosInsertSlideChart', ctype)
    else await window.workspace.lok.macro('WosInsertChart', ctype)
    setDirty(true)
    await paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, isImpress])

  // Components: (re)load the library when an Impress doc is active or the panel
  // opens — so components the agent writes via `wos-component` show up.
  const reloadComponents = useCallback(() => {
    void window.workspace.components.list().then(setComponents).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Components: insert an instance — a tagged shape (or grouped composite) built
  // from the asset's defaults, including fill style / outline / stroke.
  const insertComponent = useCallback(async (c: Component) => {
    const M = window.workspace.lok.macro
    const w = Math.round(c.w), h = Math.round(c.h)
    const title = c.text.replace(/\|/g, ' ')
    if (c.type === 'block') {
      // Word text block: flows into the document at the cursor (not a shape).
      const t = (c.text || '').replace(/\|/g, ' '), b = (c.body || '').replace(/\|/g, ' ')
      await M('WosInsertBlock', `${c.blockKind || 'heading'}|${t}|${b}|${c.fill}`)
      setDirty(true)
      await paint()
      setThumbsKey((k) => k + 1)
      return
    }
    if (c.type === 'range') {
      // Excel cell template: stamps formatted cells at the selection (not a shape).
      const t = (c.text || '').replace(/\|/g, ' '), b = (c.body || '').replace(/\|/g, ' ')
      await M('WosStampRange', `${c.rangeKind || 'kpi'}|${t}|${b}|${c.fill}`)
      setDirty(true)
      await paint()
      return
    }
    if (c.type === 'captured') {
      await window.workspace.lok.buildCaptured(c.elements ?? [])
    } else if (c.type === 'card') {
      await M('WosInsertCard', `${c.fill}|${c.fontColor}|${w}|${h}|${title}`)
    } else if (c.type === 'media') {
      await M('WosInsertMedia', `${c.fill}|${c.fontColor}|${w}|${h}|${title}|${c.image}`)
    } else {
      await M('WosShapeInsert', c.base)
      if (c.fillKind === 'gradient') await M('WosShapeEffect', `gradient|${c.fill}|${c.gradTo}`)
      else if (c.fillKind === 'pattern') { await M('WosShapeColor', `fill|${c.fill}`); await M('WosShapePattern', `single|450|100|${c.line}`) }
      else await M('WosShapeColor', `fill|${c.fill}`)
      await M('WosShapeColor', `line|${c.line}`)
      if (c.lineWidth > 0) await M('WosShapeStroke', `width|${c.lineWidth}`)
      if (c.dash !== 'solid') await M('WosShapeStroke', `dash|${c.dash}`)
      if (title) await M('WosShapeText', `settext|${title}`)
      if (c.fontColor) await M('WosShapeText', `color|${c.fontColor}`)
      await M('WosShapeSize', `${w}|${h}`)
    }
    await M('WosTagShape', `WosA_${c.id}`)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  // Components: edit the selected instance's exposed variables. Composites edit
  // their named children (bg / title|caption) via the group setter.
  const updateInstance = useCallback(async (fields: { fill?: number; text?: string; w?: number; h?: number }) => {
    const M = window.workspace.lok.macro
    const isGroup = selectedInstance ? selectedInstance.comp.type !== 'shape' : false
    const textRole = selectedInstance?.comp.type === 'media' ? 'caption' : 'title'
    // Editing a variable marks it overridden (stored in the shape) so a later
    // master push leaves it alone.
    if (fields.fill !== undefined) { await (isGroup ? M('WosGroupSet', `bg|fill|${fields.fill}`) : M('WosShapeColor', `fill|${fields.fill}`)); await M('WosSetOverride', 'fill') }
    if (fields.text !== undefined) {
      const t = fields.text.replace(/\|/g, ' ')
      await (isGroup ? M('WosGroupSet', `${textRole}|text|${t}`) : M('WosShapeText', `settext|${t}`))
      await M('WosSetOverride', 'text')
    }
    if (fields.w !== undefined || fields.h !== undefined) {
      const w = Math.round(fields.w ?? selectedInstance?.w ?? 0)
      const h = Math.round(fields.h ?? selectedInstance?.h ?? 0)
      await M('WosShapeSize', `${w}|${h}`)
      await M('WosSetOverride', 'size')
    }
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    setSelectedInstance((prev) => (prev ? { ...prev, ...fields } : prev))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, selectedInstance])

  // Push a master's props to every instance on the slides (skips overrides).
  const propagate = useCallback(async (c: Component) => {
    const args = [c.id, c.type, c.fill, c.fillKind, c.gradTo, c.line, c.lineWidth, c.dash, c.fontColor, (c.text || '').replace(/\|/g, ' '), Math.round(c.w), Math.round(c.h)].join('|')
    await window.workspace.lok.macro('WosPropagate', args)
    setDirty(true)
    await paint()
    setThumbsKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint])

  const saveComponent = useCallback(async (c: Partial<Component>) => {
    const existed = !!c.id && components.some((x) => x.id === c.id)
    const saved = await window.workspace.components.save(c)
    setComponents(await window.workspace.components.list())
    if (existed) await propagate(saved) // editing a master pushes to its instances
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components, propagate])
  const deleteComponent = useCallback(async (id: string) => {
    await window.workspace.components.delete(id)
    setComponents(await window.workspace.components.list())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Capture the current selection into a reusable 'captured' component.
  const captureSelection = useCallback(() => window.workspace.lok.capture(), [])

  const goToPart = useCallback(async (n: number) => {
    const r = await window.workspace.lok.setPart(n)
    if (!r.ok) return
    docRef.current = { w: r.w, h: r.h }
    if (partRef) partRef.current = r.cur
    setParts((p) => ({ ...p, cur: r.cur }))
    setCaret(null)
    await paint()
    if (isCalc) void refreshGeometry()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, isCalc, refreshGeometry])

  // Resize a column/row (drag on a header boundary) via the model-API bridge,
  // then repaint and re-read geometry so the strips + grid reflow.
  const resizeHeader = useCallback(async (kind: 'col' | 'row', index: number, sizeMm100: number) => {
    const ok = await window.workspace.lok.setSize(kind, index, sizeMm100)
    if (ok) {
      setDirty(true)
      const sz = await window.workspace.lok.setPart(partsCur).catch(() => null)
      if (sz?.ok) docRef.current = { w: sz.w, h: sz.h }
      await paint()
      void refreshGeometry()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paint, refreshGeometry, partsCur])

  return {
    doSlideOp,
    reorderSlide,
    sheetOp,
    sheetOpAt,
    slideOp,
    refreshPartInfo,
    tableOp,
    slideTableOp,
    slideTableCellFmt,
    layoutOp,
    slideLayout,
    shapeInsert,
    shapeColor,
    slideBg,
    shapeText,
    shapeEffect,
    arrange,
    shapePattern,
    shapeStroke,
    chartInsert,
    condFormat,
    dataValidation,
    reloadComponents,
    insertComponent,
    updateInstance,
    propagate,
    saveComponent,
    deleteComponent,
    captureSelection,
    goToPart,
    resizeHeader,
  }
}
