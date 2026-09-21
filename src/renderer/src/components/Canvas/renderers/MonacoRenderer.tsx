import { useEffect, useState, useCallback, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { getMonacoLanguage } from './routeFile'
import { useTheme } from '../../../hooks/useTheme'
import { useFilePrint } from '../../../hooks/useFilePrint'
import { printTextDocument } from '../../../lib/printDocument'
import styles from './MonacoRenderer.module.css'

export type CodeEditor = Parameters<OnMount>[0]

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
      onMount={handleMount}
      theme={theme === 'dark' ? 'vs-dark' : 'light'}
      options={{
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
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
