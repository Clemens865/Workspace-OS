import { _electron as electron } from 'playwright'
import path from 'path'; import fs from 'fs'; import { execSync } from 'child_process'; import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APP = path.join(root, 'release/mac-arm64/Workspace OS.app/Contents/MacOS/Workspace OS')
const env = { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-test' }; delete env.WOS_LOK_INSTALL; delete env.WOS_LOK_FUND; delete env.WOS_LOK_HOST
const app = await electron.launch({ executablePath: APP, args: [], env })
const win = await app.firstWindow(); await win.waitForSelector('#root',{timeout:20000}); await win.waitForTimeout(1500)
async function openTypeCheck(file, text) {
  await win.getByText(file).first().click()
  for(let i=0;i<50;i++){const r=await win.evaluate(()=>{const c=document.querySelector('canvas');const ov=[...document.querySelectorAll('[class*=overlay]')].some(o=>/Rendering/.test(o.textContent));return {w:c?.width||0,r:ov}}).catch(()=>({w:0,r:true}));if(r.w>400&&!r.r)break;await win.waitForTimeout(400)}
  await win.locator('canvas').first().click({position:{x:150,y:120},force:true}); await win.waitForTimeout(300)
  await win.keyboard.type(text); await win.keyboard.press('Enter'); await win.waitForTimeout(400)
  const sv=win.getByTitle('Save (⌘S)'); if(await sv.isEnabled().catch(()=>false))await sv.click()
  for(let i=0;i<25;i++){if(await win.getByText('Saved').first().isVisible().catch(()=>false))break;await win.waitForTimeout(150)}
  await win.waitForTimeout(400)
  try { return new RegExp(text).test(execSync(`unzip -p /tmp/wos-test/${file} xl/sharedStrings.xml`,{encoding:'utf8'})) } catch { return false }
}
console.log('A) fresh file typeable:', await openTypeCheck('fresh.xlsx','FRESHTYPE'))
console.log('   lock created on fresh open:', fs.existsSync('/tmp/wos-test/.~lock.fresh.xlsx#'))
console.log('B) pre-locked file typeable:', await openTypeCheck('prelocked.xlsx','LOCKEDTYPE'))
await app.close()
