import { sendToWindow } from './main-window'
import { APP_CODE, entriesFor, menusFor, stateKeyFor, type Entry } from './office-menu-table'

export type MI = Electron.MenuItemConstructorOptions

/** What the engine reports for the commands the menu bar shows state for. */
export interface OfficeMenuState {
  checked: Record<string, boolean>
  disabled: string[]
}
const NO_STATE: OfficeMenuState = { checked: {}, disabled: [] }

/**
 * The office menus, built from the data table in office-menu-table.ts.
 *
 * Clicks send `office.*` / `edit.*` / `go.*` ids the renderer routes (the LOK
 * canvas for `office.*`). Toggles show the engine's own check mark and any
 * item the engine reports as unavailable is greyed. `viewExtras` (panel
 * toggles owned by menu.ts) lead the View menu; the Impress design submenus
 * (shape fill/outline/effects/arrange, macro-backed) follow the table's Format
 * items so the one place that already knew them keeps working.
 */
export function officeMenus(
  type: number,
  isDev: boolean,
  viewExtras: MI[],
  state: OfficeMenuState = NO_STATE,
): { edit: MI; format: MI; insert: MI; view: MI; extra: MI[] } {
  const send = (id: string): void => sendToWindow('menu:run-action', id)
  const code = APP_CODE[type] ?? 'w'

  const toMI = (e: Entry): MI => {
    if (e.sep) return { type: 'separator' }
    if (e.sub) return { label: e.label, submenu: e.sub.map(toMI) }
    const key = stateKeyFor(e)
    const id = e.action ?? (e.uno ? 'office.uno:' + e.uno : '')
    const enabled = key ? !state.disabled.includes(key) : true
    const mi: MI = { label: e.label, accelerator: e.accel, enabled, click: () => send(id) }
    if (e.toggle && key) { mi.type = 'checkbox'; mi.checked = state.checked[key] ?? false }
    return mi
  }
  const menuFor = (label: string): MI[] => {
    const mn = menusFor(code).find((x) => x.label === label)
    return mn ? mn.items.map(toMI) : []
  }

  const edit: MI = { label: 'Edit', submenu: menuFor('Edit') }
  const insert: MI = { label: 'Insert', submenu: menuFor('Insert') }
  const format: MI = { label: 'Format', submenu: [...menuFor('Format'), ...(type === 2 ? impressDesignMenus(send) : [])] }
  const view: MI = {
    label: 'View',
    submenu: [
      ...viewExtras,
      ...menuFor('View'),
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'reload' },
      ...(isDev ? [{ role: 'toggleDevTools' as const }] : []),
    ],
  }
  // Styles · Table / Sheet / Slide · Data / Slide Show · Tools — whichever the app has.
  const extra: MI[] = menusFor(code)
    .filter((mn) => !['Edit', 'View', 'Insert', 'Format'].includes(mn.label))
    .map((mn) => ({ label: mn.label, submenu: entriesFor(mn.items, code).map(toMI) }))
  return { edit, format, insert, view, extra }
}

/** Impress shape design: colours, effects, stroke, pattern, arrange — macro-backed `office.*` ids. */
function impressDesignMenus(send: (id: string) => void): MI[] {
  const FONTS = ['Liberation Sans', 'Arial', 'Calibri', 'Times New Roman', 'Courier New', 'Georgia']
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]
  const SHAPE_COLORS: [string, number][] = [
    ['None', -1], ['Black', 0], ['White', 16777215], ['Gray', 8421504],
    ['Blue', 5806300], ['Dark Blue', 2050940], ['Teal', 1810836], ['Green', 3046194],
    ['Yellow', 16760832], ['Orange', 15564081], ['Red', 12582912], ['Purple', 7352480],
  ]
  const GRADIENTS: [string, number, number][] = [
    ['Blue', 5806300, 14543051], ['Teal', 1810836, 9234160], ['Sunset', 15564081, 12582912],
    ['Green', 3046194, 11854022], ['Purple', 7352480, 14403538],
  ]
  const shapeColorMenu = (which: 'fill' | 'line'): MI[] =>
    SHAPE_COLORS.map(([n, v]): MI => ({ label: n, click: () => send(`office.shape${which}:${v}`) }))
  const slideBgMenu = (scope: 'one' | 'all'): MI[] =>
    SHAPE_COLORS.map(([n, v]): MI => ({ label: n, click: () => send(`office.slidebg:${scope}:${v}`) }))
  return [
    { type: 'separator' },
    { label: 'Shape Fill', submenu: shapeColorMenu('fill') },
    { label: 'Shape Outline', submenu: shapeColorMenu('line') },
    { label: 'Slide Background', submenu: slideBgMenu('one') },
    { label: 'Background — All Slides', submenu: slideBgMenu('all') },
    {
      label: 'Shape Text',
      submenu: [
        { label: 'Bold', click: () => send('office.shapetext:bold:') },
        { label: 'Italic', click: () => send('office.shapetext:italic:') },
        { type: 'separator' as const },
        { label: 'Font', submenu: FONTS.map((n): MI => ({ label: n, click: () => send(`office.shapetext:font:${n}`) })) },
        { label: 'Size', submenu: SIZES.map((s): MI => ({ label: String(s), click: () => send(`office.shapetext:size:${s}`) })) },
        { label: 'Color', submenu: SHAPE_COLORS.filter(([n]) => n !== 'None').map(([n, v]): MI => ({ label: n, click: () => send(`office.shapetext:color:${v}`) })) },
        { label: 'Align', submenu: [
          { label: 'Left', click: () => send('office.shapetext:align:left') },
          { label: 'Center', click: () => send('office.shapetext:align:center') },
          { label: 'Right', click: () => send('office.shapetext:align:right') },
        ] },
      ],
    },
    {
      label: 'Shape Effects',
      submenu: [
        { label: 'Shadow (toggle)', click: () => send('office.shapeeffect:shadow:') },
        { label: 'Gradient', submenu: GRADIENTS.map(([n, a, b]): MI => ({ label: n, click: () => send(`office.shapeeffect:gradient:${a}:${b}`) })) },
      ],
    },
    {
      label: 'Shape Stroke',
      submenu: [
        { label: 'Width', submenu: [
          { label: 'Hairline', click: () => send('office.stroke:width:1') },
          { label: 'Thin', click: () => send('office.stroke:width:35') },
          { label: 'Medium', click: () => send('office.stroke:width:100') },
          { label: 'Thick', click: () => send('office.stroke:width:200') },
          { label: 'Heavy', click: () => send('office.stroke:width:400') },
        ] },
        { label: 'Style', submenu: [
          { label: 'Solid', click: () => send('office.stroke:dash:solid') },
          { label: 'Dashed', click: () => send('office.stroke:dash:dashed') },
          { label: 'Dotted', click: () => send('office.stroke:dash:dotted') },
          { label: 'Dash-dot', click: () => send('office.stroke:dash:dashdot') },
        ] },
      ],
    },
    {
      label: 'Shape Pattern',
      submenu: [
        { label: 'Diagonal', click: () => send('office.pattern:single:450:100:4210752') },
        { label: 'Back Diagonal', click: () => send('office.pattern:single:1350:100:4210752') },
        { label: 'Horizontal', click: () => send('office.pattern:single:0:100:4210752') },
        { label: 'Vertical', click: () => send('office.pattern:single:900:100:4210752') },
        { label: 'Cross-hatch', click: () => send('office.pattern:double:450:100:4210752') },
        { label: 'Grid', click: () => send('office.pattern:double:0:100:4210752') },
      ],
    },
    {
      label: 'Arrange Shape',
      submenu: [
        { label: 'Bring to Front', click: () => send('office.arrange:front') },
        { label: 'Send to Back', click: () => send('office.arrange:back') },
        { label: 'Bring Forward', click: () => send('office.arrange:forward') },
        { label: 'Send Backward', click: () => send('office.arrange:backward') },
        { type: 'separator' as const },
        { label: 'Align Left', click: () => send('office.arrange:left') },
        { label: 'Align Center', click: () => send('office.arrange:hcenter') },
        { label: 'Align Right', click: () => send('office.arrange:right') },
        { label: 'Align Top', click: () => send('office.arrange:top') },
        { label: 'Align Middle', click: () => send('office.arrange:vmiddle') },
        { label: 'Align Bottom', click: () => send('office.arrange:bottom') },
        { type: 'separator' as const },
        { label: 'Delete Shape', click: () => send('office.arrange:delete') },
      ],
    },
  ]
}
