// Renders the brand SVG to PNG at real fidelity.
//
// ImageMagick's built-in SVG renderer ignores <use>, gradient references and
// clip-paths — it silently produces a flat silhouette. Chromium renders the same
// SVG the browser (and therefore the app) will, so the icon we ship is the icon
// we designed. Electron is already a dependency, so this costs nothing extra.
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'

const [, , svgPath, outPath, sizeArg] = process.argv
const size = Number(sizeArg || 1024)

app.disableHardwareAcceleration()
await app.whenReady()

const svg = fs.readFileSync(svgPath, 'utf8')
const win = new BrowserWindow({
  width: size, height: size, show: false,
  webPreferences: { offscreen: true },
})
// transparent background so the squircle's corners stay see-through in the icon
const html = `<html><body style="margin:0;background:transparent">
  <div style="width:${size}px;height:${size}px">${svg.replace(/width="\d+"\s+height="\d+"/, `width="${size}" height="${size}"`)}</div>
</body></html>`
await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
await new Promise((r) => setTimeout(r, 400))
const img = await win.webContents.capturePage()
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, img.toPNG())
console.log('rendered', outPath, `${size}x${size}`)
app.quit()
