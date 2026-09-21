/**
 * The engine's own right-click menu, made ours.
 *
 * In LibreOfficeKit mode a right-click that reaches the engine makes it emit
 * LOK_CALLBACK_CONTEXT_MENU: the popup menu for whatever is under the pointer
 * — text, a table cell, an image, a shape, a slide, a spreadsheet cell — with
 * every item's command, enabled state and check state. That is exactly the
 * target detection a context menu needs, and it is always right, because the
 * engine computed it from the real selection.
 *
 * What this module adds is curation: strip the mnemonics, drop what cannot run
 * (disabled entries, file pickers that cannot open headless), route the dialogs
 * we have rebuilt in React to those dialogs, and attach the shortcuts people
 * expect to see. Pure, so the rules are unit-tested against real payloads
 * (see e2e/office/AJ-context-menu.mjs for the live proof).
 */
import type { MenuAction, MenuItem } from './calcMenu'

export interface EngineMenuItem {
  type: 'command' | 'separator' | 'menu'
  text?: string
  command?: string
  enabled: boolean
  checked?: boolean
  menu?: EngineMenuItem[]
}

/** boost::property_tree writes every value as a string — normalise here, once. */
function bool(v: unknown, dflt: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return dflt
}

function parseItems(raw: unknown): EngineMenuItem[] {
  if (!Array.isArray(raw)) return []
  const out: EngineMenuItem[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const type = o.type === 'separator' ? 'separator' : o.type === 'menu' ? 'menu' : 'command'
    const item: EngineMenuItem = { type, enabled: bool(o.enabled, true) }
    if (typeof o.text === 'string') item.text = o.text
    if (typeof o.command === 'string') item.command = o.command
    if (o.checktype !== undefined) item.checked = bool(o.checked, false)
    if (type === 'menu') item.menu = parseItems(o.menu)
    out.push(item)
  }
  return out
}

/** Parse the CONTEXT_MENU payload. Malformed input yields an empty menu, never a throw. */
export function parseEngineMenu(payload: string): EngineMenuItem[] {
  try {
    const root = JSON.parse(payload) as { menu?: unknown }
    return parseItems(root?.menu)
  } catch {
    return []
  }
}

/** `~Paste ~Special...` → `Paste Special…` (the mnemonic marker is a desktop-toolkit artefact). */
export function cleanLabel(text: string): string {
  return text.replace(/~/g, '').replace(/\.\.\.$/, '…').trim()
}

/**
 * Entries that cannot work in this app. File pickers cannot open from a
 * headless engine; ruler/snap-guide chrome does not exist here; macros are
 * the agents' job.
 */
const HIDE = new Set<string>([
  '.uno:NoBreak',
  '.uno:OpenLocalURL',
  '.uno:ShowRuler',
  '.uno:SnapLinesMenu',
  '.uno:CapturePoint',
  '.uno:AssignMacro',
  '.uno:ExternalEdit',
  '.uno:SaveGraphic',
  '.uno:ChangePicture',
  '.uno:ImportSlideFromFile',
  '.uno:InsertSheetFromFile',
  '.uno:ExecuteAnimationEffect',
  '.uno:EditBarcode',
  '.uno:SignSignatureLine',
  '.uno:EditSignatureLine',
])

/** Engine dialogs we have rebuilt as our own — routed there instead of the bitmap tunnel. */
const ACTION_FOR: Record<string, MenuAction> = {
  '.uno:FormatCellDialog': 'formatCells',
  '.uno:HyperlinkDialog': 'hyperlink',
  '.uno:InsertHyperlink': 'hyperlink',
  '.uno:EditHyperlink': 'hyperlink',
  '.uno:InsertTable': 'table',
  '.uno:CurrentConditionalFormatDialog': 'condformat',
  '.uno:ConditionalFormatDialog': 'condformat',
  '.uno:CurrentValidation': 'datavalidation',
  '.uno:Validation': 'datavalidation',
  '.uno:SearchDialog': 'find',
  '.uno:InsertSymbol': 'symbol',
  '.uno:InsertGraphic': 'image',
}

const SHORTCUT: Record<string, string> = {
  '.uno:Cut': '⌘X',
  '.uno:Copy': '⌘C',
  '.uno:Paste': '⌘V',
  '.uno:PasteUnformatted': '⇧⌥⌘V',
  '.uno:Undo': '⌘Z',
  '.uno:Redo': '⇧⌘Z',
  '.uno:SelectAll': '⌘A',
  '.uno:Bold': '⌘B',
  '.uno:Italic': '⌘I',
  '.uno:Underline': '⌘U',
  '.uno:FillDown': '⌘D',
  '.uno:FillRight': '⌘R',
  '.uno:InsertAnnotation': '⌥⌘C',
}

/**
 * Menu aliases. LibreOffice's menus carry commands such as
 * `.uno:Heading1ParaStyle` that exist only in the UI configuration: a
 * TargetURL there maps them to the real dispatchable URL. postUnoCommand knows
 * nothing of the alias, so dispatching it is a silent no-op (proven in
 * e2e/office/AJ-context-menu.mjs). Extracted from officecfg/…/UI/*Commands.xcu.
 */
const ALIAS: Record<string, string> = {
  '.uno:Accent1CellStyles': '.uno:StyleApply?Style:string=Accent 1&FamilyName:string=CellStyles',
  '.uno:Accent2CellStyles': '.uno:StyleApply?Style:string=Accent 2&FamilyName:string=CellStyles',
  '.uno:Accent3CellStyles': '.uno:StyleApply?Style:string=Accent 3&FamilyName:string=CellStyles',
  '.uno:AcceptTrackedChanges-more': '.uno:AcceptTrackedChanges',
  '.uno:AccessibilityCheck': '.uno:SidebarDeck.A11yCheckDeck',
  '.uno:AlignOnSlide': '.uno:AlignOnPage',
  '.uno:AlphaListStyle': '.uno:StyleApply?Style:string=Numbering ABC&FamilyName:string=NumberingStyles',
  '.uno:AlphaLowListStyle': '.uno:StyleApply?Style:string=Numbering abc&FamilyName:string=NumberingStyles',
  '.uno:BadCellStyles': '.uno:StyleApply?Style:string=Bad&FamilyName:string=CellStyles',
  '.uno:BorderDialog-more': '.uno:BorderDialog',
  '.uno:BulletListStyle': '.uno:StyleApply?Style:string=List 1&FamilyName:string=NumberingStyles',
  '.uno:DefaultCellStyles': '.uno:StyleApply?Style:string=Default&FamilyName:string=CellStyles',
  '.uno:DefaultCharStyle': '.uno:StyleApply?Style:string=Standard&FamilyName:string=CharacterStyles',
  '.uno:DefaultParaStyle': '.uno:StyleApply?Style:string=Standard&FamilyName:string=ParagraphStyles',
  '.uno:DeleteSlide': '.uno:DeletePage',
  '.uno:DrawingLayout': '.uno:PresentationLayout',
  '.uno:DuplicateSlide': '.uno:DuplicatePage',
  '.uno:EmphasisCharStyle': '.uno:StyleApply?Style:string=Emphasis&FamilyName:string=CharacterStyles',
  '.uno:EndnoteDialog': '.uno:FootnoteDialog',
  '.uno:ErrorCellStyles': '.uno:StyleApply?Style:string=Error&FamilyName:string=CellStyles',
  '.uno:FirstSlide': '.uno:FirstPage',
  '.uno:FontDialog-more': '.uno:FontDialog',
  '.uno:FootnoteCellStyles': '.uno:StyleApply?Style:string=Footnote&FamilyName:string=CellStyles',
  '.uno:FormatArea-more': '.uno:FormatArea',
  '.uno:FormatLine-more': '.uno:FormatLine',
  '.uno:FrameDialog-more': '.uno:FrameDialog',
  '.uno:GlueDeletePoint': '.uno:Delete',
  '.uno:GoodCellStyles': '.uno:StyleApply?Style:string=Good&FamilyName:string=CellStyles',
  '.uno:GotoSlide': '.uno:GotoPage',
  '.uno:GraphicDialog-more': '.uno:GraphicDialog',
  '.uno:Heading1CellStyles': '.uno:StyleApply?Style:string=Heading 1&FamilyName:string=CellStyles',
  '.uno:Heading1ParaStyle': '.uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles',
  '.uno:Heading2CellStyles': '.uno:StyleApply?Style:string=Heading 2&FamilyName:string=CellStyles',
  '.uno:Heading2ParaStyle': '.uno:StyleApply?Style:string=Heading 2&FamilyName:string=ParagraphStyles',
  '.uno:Heading3ParaStyle': '.uno:StyleApply?Style:string=Heading 3&FamilyName:string=ParagraphStyles',
  '.uno:Heading4ParaStyle': '.uno:StyleApply?Style:string=Heading 4&FamilyName:string=ParagraphStyles',
  '.uno:Heading5ParaStyle': '.uno:StyleApply?Style:string=Heading 5&FamilyName:string=ParagraphStyles',
  '.uno:Heading6ParaStyle': '.uno:StyleApply?Style:string=Heading 6&FamilyName:string=ParagraphStyles',
  '.uno:HorizontalLine': '.uno:StyleApply?Style:string=Horizontal Line&FamilyName:string=ParagraphStyles',
  '.uno:ImportSlideFromFile': '.uno:ImportFromFile',
  '.uno:InsertAnchor': '.uno:InsertBookmark',
  '.uno:InsertHyperlinkDlg': '.uno:HyperlinkDialog',
  '.uno:InsertPivotTable': '.uno:DataDataPilotRun',
  '.uno:InsertPivotTableNBLabel': '.uno:DataDataPilotRun',
  '.uno:InsertSlide': '.uno:InsertPage',
  '.uno:InsertSlideField': '.uno:InsertPageField',
  '.uno:InsertSlideNumber': '.uno:InsertPageNumber',
  '.uno:InsertSlideTitleField': '.uno:InsertPageTitleField',
  '.uno:InsertSlidesField': '.uno:InsertPagesField',
  '.uno:LastSlide': '.uno:LastPage',
  '.uno:MoveSlideDown': '.uno:MovePageDown',
  '.uno:MoveSlideFirst': '.uno:MovePageFirst',
  '.uno:MoveSlideLast': '.uno:MovePageLast',
  '.uno:MoveSlideUp': '.uno:MovePageUp',
  '.uno:NeutralCellStyles': '.uno:StyleApply?Style:string=Neutral&FamilyName:string=CellStyles',
  '.uno:NextSlide': '.uno:NextPage',
  '.uno:NoteCellStyles': '.uno:StyleApply?Style:string=Note&FamilyName:string=CellStyles',
  '.uno:NumberFormatCurrencySimple': '.uno:NumberFormatCurrency',
  '.uno:NumberListStyle': '.uno:StyleApply?Style:string=Numbering 123&FamilyName:string=NumberingStyles',
  '.uno:ObjectDialog-more': '.uno:FrameDialog',
  '.uno:ObjectTitleDescription-Drawingobjects': '.uno:ObjectTitleDescription',
  '.uno:ObjectTitleDescription-Frames': '.uno:ObjectTitleDescription',
  '.uno:ObjectTitleDescription-Images': '.uno:ObjectTitleDescription',
  '.uno:ObjectTitleDescription-OLEobjects': '.uno:ObjectTitleDescription',
  '.uno:ParagraphDialog-more': '.uno:ParagraphDialog',
  '.uno:PreformattedParaStyle': '.uno:StyleApply?Style:string=Preformatted Text&FamilyName:string=ParagraphStyles',
  '.uno:PreviousSlide': '.uno:PreviousPage',
  '.uno:QuoteCharStyle': '.uno:StyleApply?Style:string=Citation&FamilyName:string=CharacterStyles',
  '.uno:QuoteParaStyle': '.uno:StyleApply?Style:string=Quotations&FamilyName:string=ParagraphStyles',
  '.uno:RedactedExportBlack': '.uno:ExportDirectToPDF?IsRedactMode:bool=true&RedactionStyle:string=Black',
  '.uno:RedactedExportWhite': '.uno:ExportDirectToPDF?IsRedactMode:bool=true&RedactionStyle:string=White',
  '.uno:RedactionPreviewExport': '.uno:ExportDirectToPDF',
  '.uno:RenameSlide': '.uno:RenamePage',
  '.uno:RomanListStyle': '.uno:StyleApply?Style:string=Numbering IVX&FamilyName:string=NumberingStyles',
  '.uno:RomanLowListStyle': '.uno:StyleApply?Style:string=Numbering ivx&FamilyName:string=NumberingStyles',
  '.uno:SaveSimple': '.uno:Save',
  '.uno:SheetInsertName': '.uno:InsertName',
  '.uno:SlideSetup': '.uno:PageSetup',
  '.uno:SourceCharStyle': '.uno:StyleApply?Style:string=Source Text&FamilyName:string=CharacterStyles',
  '.uno:StrongEmphasisCharStyle': '.uno:StyleApply?Style:string=Strong Emphasis&FamilyName:string=CharacterStyles',
  '.uno:SubtitleParaStyle': '.uno:StyleApply?Style:string=Subtitle&FamilyName:string=ParagraphStyles',
  '.uno:TableDialog-more': '.uno:TableDialog',
  '.uno:TableTransformDialog': '.uno:TransformDialog',
  '.uno:TextBodyParaStyle': '.uno:StyleApply?Style:string=Text body&FamilyName:string=ParagraphStyles',
  '.uno:TextWrap-more': '.uno:TextWrap',
  '.uno:TitleParaStyle': '.uno:StyleApply?Style:string=Title&FamilyName:string=ParagraphStyles',
  '.uno:ToggleAnchorType': '.uno:AnchorMenu',
  '.uno:TransformDialog-more': '.uno:TransformDialog',
  '.uno:UnderlineSimple': '.uno:Underline',
  '.uno:ViewSidebarStyles': '.uno:DesignerDialog',
  '.uno:ViewTrackChanges': '.uno:ShowTrackedChanges',
  '.uno:WarningCellStyles': '.uno:StyleApply?Style:string=Warning&FamilyName:string=CellStyles',
  '.uno:Zoom-more': '.uno:Zoom',
  '.uno:ZoomIn': '.uno:ZoomPlus',
  '.uno:ZoomOut': '.uno:ZoomMinus',
}

const ARG_TYPES: Record<string, string> = { string: 'string', long: 'long', short: 'short', int: 'long', bool: 'boolean', boolean: 'boolean', float: 'float', double: 'float' }

/**
 * `.uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles`
 * → `.uno:StyleApply {"Style":{"type":"string","value":"Heading 1"},…}`.
 *
 * The engine's menus hand out query-form URLs; postUnoCommand wants JSON args.
 * The host splits the command at its first space, so a query value with a
 * space would even be parsed as (broken) JSON — this conversion is what makes
 * a menu pick safe to send.
 */
export function unoQueryToJson(command: string): string {
  const q = command.indexOf('?')
  if (q < 0) return command
  const base = command.slice(0, q)
  const args: Record<string, { type: string; value: string | number | boolean }> = {}
  for (const part of command.slice(q + 1).split('&')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq)
    let raw = part.slice(eq + 1)
    try { raw = decodeURIComponent(raw) } catch { /* keep as is */ }
    const colon = key.indexOf(':')
    const name = colon < 0 ? key : key.slice(0, colon)
    const type = ARG_TYPES[colon < 0 ? 'string' : key.slice(colon + 1)] ?? 'string'
    if (!name) continue
    let value: string | number | boolean = raw
    if (type === 'long' || type === 'short' || type === 'float') { const n = Number(raw); if (!Number.isNaN(n)) value = n }
    else if (type === 'boolean') value = raw === 'true' || raw === '1'
    args[name] = { type, value }
  }
  return Object.keys(args).length ? `${base} ${JSON.stringify(args)}` : base
}

/** Alias → real URL, query args → JSON args. Idempotent. */
export function resolveCommand(command: string): string {
  const q = command.indexOf('?')
  const head = q < 0 ? command : command.slice(0, q)
  const target = ALIAS[head]
  if (target) {
    // An alias's target may itself carry query args (the style aliases do).
    return unoQueryToJson(q < 0 ? target : target + (target.includes('?') ? '&' : '?') + command.slice(q + 1))
  }
  return unoQueryToJson(command)
}

/** The format painter arms a mode; the next click applies it. */
const MODES = new Set(['.uno:FormatPaintbrush'])

/** Strip the `.uno:` prefix and any `?args` for a stable, readable id. */
function idFor(command: string, path: number[]): string {
  const base = command.replace(/^\.uno:/, '').replace(/\?.*$/, '')
  return `${base.toLowerCase()}-${path.join('.')}`
}

/**
 * Turn the engine's menu into ours: labels cleaned, disabled entries gone,
 * empty submenus and dangling separators collapsed, our dialogs routed.
 *
 * Disabled items are dropped rather than greyed: the engine menus carry dozens
 * of them (every index/field/track-change entry on plain text), and a menu
 * that is two-thirds grey reads as broken. What is left is what can run now.
 */
export function curateMenu(items: EngineMenuItem[], path: number[] = []): MenuItem[] {
  const out: MenuItem[] = []
  let pendingSep = false
  items.forEach((it, i) => {
    if (it.type === 'separator') { pendingSep = out.length > 0; return }
    if (it.command && HIDE.has(it.command)) return
    if (!it.enabled) return
    const label = cleanLabel(it.text ?? '')
    if (!label) return
    const here = [...path, i]
    if (it.type === 'menu') {
      const children = curateMenu(it.menu ?? [], here)
      if (children.length === 0) return
      if (pendingSep) { out.push({ id: `sep-${here.join('.')}`, label: '', separator: true }); pendingSep = false }
      out.push({ id: idFor(it.command ?? 'menu', here), label, children })
      return
    }
    if (!it.command) return
    if (pendingSep) { out.push({ id: `sep-${here.join('.')}`, label: '', separator: true }); pendingSep = false }
    const item: MenuItem = { id: idFor(it.command, here), label }
    const action = ACTION_FOR[it.command]
    if (action) item.action = action
    else item.uno = resolveCommand(it.command)
    if (MODES.has(it.command)) item.mode = true
    if (it.checked !== undefined && !MODES.has(it.command)) item.checked = it.checked
    const sc = SHORTCUT[it.command]
    if (sc) item.shortcut = sc
    out.push(item)
  })
  return out
}

/** The whole pipeline: payload in, renderable menu out. */
export function menuFromEngine(payload: string): MenuItem[] {
  return curateMenu(parseEngineMenu(payload))
}
