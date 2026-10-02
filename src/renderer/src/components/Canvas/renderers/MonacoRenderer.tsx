import { useEffect, useState, useCallback, useRef } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import { getMonacoLanguage } from './routeFile'
import { useTheme } from '../../../hooks/useTheme'
import { useFilePrint } from '../../../hooks/useFilePrint'
import { printTextDocument } from '../../../lib/printDocument'
import styles from './MonacoRenderer.module.css'

export type CodeEditor = Parameters<OnMount>[0]

/** The landscape's light editor theme: paper ground, ink text, quiet chrome. */
export const LANDSCAPE_THEME = 'wl'

/** …and its night: the landscape's dark paper, moonlight ink. */
export const LANDSCAPE_DARK_THEME = 'wl-dark'

const defineLandscapeTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(LANDSCAPE_DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#182129',
      'editor.foreground': '#e6ecf0',
      'editorLineNumber.foreground': '#5f6d78',
      'editorLineNumber.activeForeground': '#b9c5cd',
      'editor.lineHighlightBackground': '#e6ecf00a',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#e6ecf026',
      'editor.inactiveSelectionBackground': '#e6ecf014',
      'editorCursor.foreground': '#e6ecf0',
      'editorGutter.background': '#182129',
      'editorIndentGuide.background1': '#e6ecf014',
      'editorWidget.background': '#182129',
      'editorWidget.border': '#e6ecf01a',
      'scrollbarSlider.background': '#e6ecf01f',
      'scrollbarSlider.hoverBackground': '#e6ecf033',
      'scrollbarSlider.activeBackground': '#e6ecf047',
    },
  })
  monaco.editor.defineTheme(LANDSCAPE_THEME, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#fbfcfd',
      'editor.foreground': '#1b2730',
      'editorLineNumber.foreground': '#a9b4bc',
      'editorLineNumber.activeForeground': '#3b4a55',
      'editor.lineHighlightBackground': '#1b27300a',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#1b27301a',
      'editor.inactiveSelectionBackground': '#1b273012',
      'editorCursor.foreground': '#1b2730',
      'editorGutter.background': '#fbfcfd',
      'editorIndentGuide.background1': '#1b273014',
      'editorWidget.background': '#fbfcfd',
      'editorWidget.border': '#1b273017',
      'scrollbarSlider.background': '#1b27301f',
      'scrollbarSlider.hoverBackground': '#1b273033',
      'scrollbarSlider.activeBackground': '#1b273047',
    },
  })
}

interface MonacoRendererProps {
  filePath: string
  onDirty: (dirty: boolean) => void
  onEditorMount?: (editor: CodeEditor | null) => void
  /** Registers a save callback with the parent (for a toolbar Save button). */
  onSaveRegister?: (save: (() => void) | null) => void
}

export function MonacoRenderer({ filePath, onDirty, onEditorMount, onSaveRegister }: MonacoRendererProps): JSX.Element {
  const { theme } = useTheme()
  const [content, setContent] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<CodeEditor | null>(null)

  useFilePrint(filePath, async () => {
    if (content === null || error) throw new Error(error || 'The document is still loading')
    await printTextDocument(filePath, editorRef.current?.getValue() ?? content)
  })

  const handleMount = useCallback<OnMount>((editor) => {
    editorRef.current = editor
    onEditorMount?.(editor)
  }, [onEditorMount])

  // Release the editor reference when this renderer unmounts.
  useEffect(() => () => onEditorMount?.(null), [onEditorMount])

  useEffect(() => {
    setContent(null)
    setError(null)
    window.workspace.fs.readFile(filePath)
      .then((text: string) => {
        setContent(text)
        setSavedContent(text)
        onDirty(false)
      })
      .catch((e: Error) => setError(e.message))
  }, [filePath, onDirty])

  const handleChange = useCallback((value: string | undefined) => {
    const v = value ?? ''
    setContent(v)
    onDirty(v !== savedContent)
  }, [savedContent, onDirty])

  const handleSave = useCallback(async () => {
    if (content === null) return
    await window.workspace.fs.writeFile(filePath, content)
    setSavedContent(content)
    onDirty(false)
  }, [filePath, content, onDirty])

  // Cmd+S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleSave])

  // Expose save to the toolbar's Save button. Register a stable wrapper that
  // always calls the latest handleSave (which closes over current content).
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    onSaveRegister?.(() => void saveRef.current())
    return () => onSaveRegister?.(null)
  }, [onSaveRegister])

  if (error) return <div className={styles.error}>Cannot open file: {error}</div>
  if (content === null) return <div className={styles.loading}>Loading…</div>

  return (
    <Editor
      height="100%"
      language={getMonacoLanguage(filePath)}
      value={content}
      onChange={handleChange}
      beforeMount={defineLandscapeTheme}
      onMount={handleMount}
      theme={theme === 'dark' ? LANDSCAPE_DARK_THEME : LANDSCAPE_THEME}
      options={{
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineNumbers: 'on',
        renderWhitespace: 'none',
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 12 },
      }}
    />
  )
}
