import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/**
 * Configures Monaco to load from the bundled local copy instead of its default
 * CDN. The CDN is blocked by our CSP (and violates the offline/sovereignty
 * principle), so without this the editor silently never loads — breaking every
 * text/code/markdown/JSON file. Workers run as blob URLs (allowed by CSP
 * `worker-src 'self' blob:`).
 */
type WorkerLabel = string

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: WorkerLabel) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  },
}

loader.config({ monaco })
