// Proves editing an EXISTING .xlsx: open → write values → formula → format →
// save → reopen-verify, with a screenshot.
import * as H from './_harness.mjs'
import fs from 'fs'
import { execSync } from 'child_process'

const r = H.makeReporter('Excel — edit an existing .xlsx')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

// throwaway copy of the existing fixture
const FILE = '/tmp/wos-test/xlsx-live.xlsx'
fs.copyFileSync('/tmp/wos-test/test-sheet.xlsx', FILE)

const { app, win } = await H.launch()
await H.openDoc(win, 'xlsx-live.xlsx')
r.ok(await win.getByText('● Live').first().isVisible().catch(() => false), 'existing .xlsx opens in the live editor')

// Move to an empty area (down a few rows from the data), enter a small table.
await H.focusDoc(win)
for (let i = 0; i < 12; i++) await win.keyboard.press('ArrowDown')
await win.keyboard.type('Q1'); await win.keyboard.press('Enter')
await win.keyboard.type('1250'); await win.keyboard.press('Enter')
await win.keyboard.type('980'); await win.keyboard.press('Enter')
await win.keyboard.type('1430'); await win.keyboard.press('Enter')
await win.waitForTimeout(300)
// AutoSum the three numbers
await win.getByRole('button', { name: 'Data', exact: true }).click()
await win.getByTitle('AutoSum').first().click()
await H.focusDoc(win); await win.keyboard.press('Enter')
await win.waitForTimeout(300)
// format the sum as currency
await win.keyboard.press('ArrowUp')
await win.getByRole('button', { name: 'Home', exact: true }).click()
await win.getByTitle('Currency').click()
await win.waitForTimeout(400)
await H.shot(win, 'xlsx-existing')
await H.save(win)
await app.close()

// verify persisted
const sheet = (() => { try { return execSync(`unzip -p '${FILE}' xl/worksheets/sheet1.xml`, { encoding: 'utf8' }) } catch { return '' } })()
const styles = (() => { try { return execSync(`unzip -p '${FILE}' xl/styles.xml`, { encoding: 'utf8' }) } catch { return '' } })()
r.ok(sheet.includes('>1250<') && sheet.includes('>980<') && sheet.includes('>1430<'), 'entered values persisted (1250/980/1430)')
r.ok(/SUM/i.test(sheet) && /<f[ >]/.test(sheet), 'AutoSum formula persisted')
r.ok(sheet.includes('>3660<'), 'SUM computed to 3660')
r.ok(/\$/.test(styles), 'currency format applied to the total')

process.exit(r.done() ? 0 : 1)
