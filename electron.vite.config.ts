import { resolve, isAbsolute } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Externalize every node_modules / builtin import in main & preload. Only our
 * own relative source gets bundled. This is the robust pattern: native modules
 * (node-pty, better-sqlite3) and `electron` must resolve from node_modules /
 * the runtime builtin at runtime — bundling them breaks native .node loading
 * and pulls in electron's npm installer.
 */
const externalizeNodeModules = (id: string): boolean =>
  !id.startsWith('.') && !isAbsolute(id) && !id.startsWith('\0')

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: externalizeNodeModules,
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Search-index extraction worker — run via worker_threads so heavy
          // PDF/docx/xlsx parsing never stalls the main process.
          extractWorker: resolve(__dirname, 'src/main/search/extract-worker.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: externalizeNodeModules,
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preloads must be CommonJS. package.json has "type":"module",
        // so emit `.cjs` to force CJS regardless of the package type.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        // Node's `path` module is not available in the renderer sandbox — use browser shim
        path: 'path-browserify',
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
