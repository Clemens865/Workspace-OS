#!/usr/bin/env node
/**
 * Libraries an app may ask for in app.json ("libraries": ["hairline"]),
 * bundled once into resources/apps-kit/libs/ as plain scripts (apps have no
 * network, so nothing can come from a CDN). Re-run after updating a library.
 *
 *   hairline  @lucasmarkes/hairline (MIT): isometric line figures → window.hairline
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve('resources/apps-kit/libs')
fs.mkdirSync(out, { recursive: true })
await build({
  entryPoints: ['node_modules/@lucasmarkes/hairline/dist/index.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'hairline',
  target: 'es2020',
  outfile: path.join(out, 'hairline.js'),
  banner: { js: '/* @lucasmarkes/hairline (MIT, Lucas Marques). Bundled for Workspace OS apps; see LICENSE-hairline.txt */' },
})
fs.copyFileSync('node_modules/@lucasmarkes/hairline/LICENSE', path.join(out, 'LICENSE-hairline.txt'))
console.log('hairline', fs.statSync(path.join(out, 'hairline.js')).size, 'bytes')
