import { useEffect, useState, type CSSProperties } from 'react'

interface Question {
  runId: string; requestId: string; method: string
  params: { mode?: string; url?: string; serverName?: string; cwd?: string; grantRoot?: string; requestedSchema?: { properties?: Record<string, { type?: string; title?: string; description?: string; enum?: string[]; items?: { type?: string } }>; required?: string[] }; command?: string; reason?: string; message?: string; permissions?: unknown; changes?: unknown; questions?: { id: string; header?: string; question: string; options?: { label: string; description?: string }[] }[] }
}

const buttonStyle: CSSProperties = { padding: '7px 12px', marginRight: 8, marginTop: 8, borderRadius: 7, border: '1px solid #8886', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }
const inputStyle: CSSProperties = { display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 8, padding: '8px 10px', borderRadius: 7, border: '1px solid #8886', background: 'transparent', color: 'inherit', font: 'inherit' }

/** Codex requests are structured and scoped to a live run; Claude's HITL stays separate. */
export function CodexRequests(): JSX.Element | null {
  const [pending, setPending] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  useEffect(() => window.workspace.codex?.onQuestion((q) => {
    setPending((old) => q.resolved ? old.filter((r) => r.runId !== q.runId || r.requestId !== q.requestId) : [...old.filter((r) => r.runId !== q.runId || r.requestId !== q.requestId), q])
  }), [])
  const q = pending[0]
  useEffect(() => { setAnswers({}); setError('') }, [q?.runId, q?.requestId])
  if (!q) return null
  const input = q.method === 'item/tool/requestUserInput'
  const elicitation = q.method === 'mcpServer/elicitation/request'
  const fields = Object.entries(q.params.requestedSchema?.properties ?? {})
  const unsupported = elicitation && q.params.mode !== 'url' && fields.some(([, f]) => !['string', 'number', 'integer', 'boolean'].includes(f.type ?? 'string'))
  const send = async (allow: boolean): Promise<void> => {
    try {
      const result = await window.workspace.codex.respond(q.runId, q.requestId, {
        allow,
        ...(elicitation && q.params.mode !== 'url' ? { content: Object.fromEntries(fields.filter(([key]) => answers[key] !== undefined).map(([key, field]) => [key, field.type === 'boolean' ? answers[key] === 'true' : ['number', 'integer'].includes(field.type ?? '') ? Number(answers[key]) : answers[key]])) } : {}),
        ...(input ? { answers: Object.fromEntries((q.params.questions ?? []).map((item) => [item.id, { answers: [answers[item.id] ?? ''] }])) } : {}),
      })
      if (!result) setError('This request has already ended.')
      setPending((old) => old.filter((r) => r.runId !== q.runId || r.requestId !== q.requestId))
    } catch (err) { setError((err as Error).message) }
  }
  return (
    <div role="dialog" aria-label="Codex request" data-testid="codex-request" style={{ position: 'fixed', zIndex: 10000, bottom: 24, right: 24, width: 440, maxWidth: '90vw', maxHeight: '75vh', overflow: 'auto', padding: 24, borderRadius: 12, background: 'var(--wos-bg, #fff)', color: 'var(--wos-ink, #222)', boxShadow: '0 8px 40px #0004', border: '1px solid #8886' }}>
      <strong>{input ? 'Codex needs your input' : 'Codex requests permission'}</strong>
      <p>{q.params.reason ?? q.params.message ?? 'Review this request before proceeding.'}</p>
      {q.params.command && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{q.params.command}</pre>}
      {q.params.permissions != null && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(q.params.permissions, null, 2)}</pre>}
      {q.params.changes != null && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(q.params.changes, null, 2)}</pre>}
      {input && q.params.questions?.map((item) => <div role="group" aria-label={item.question} key={item.id} style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', marginTop: 12 }}>{item.question}</span>
        {item.options?.map((option) => <button style={buttonStyle} key={option.label} title={option.description} onClick={() => setAnswers((old) => ({ ...old, [item.id]: option.label }))}>{option.label}</button>)}
        <input aria-label={item.question} value={answers[item.id] ?? ''} onChange={(e) => setAnswers((old) => ({ ...old, [item.id]: e.target.value }))} style={inputStyle} />
      </div>)}
      {q.params.cwd && <p>Working folder: {q.params.cwd}</p>}
      {q.params.grantRoot && <p>Requested folder: {q.params.grantRoot}</p>}
      {elicitation && q.params.mode === 'url' && <p>Complete the connector request at <button style={buttonStyle} onClick={() => void window.workspace.codex.openRequest(q.runId, q.requestId).catch((e) => setError(e.message))}>{q.params.url}</button>, then confirm below.</p>}
      {elicitation && q.params.mode !== 'url' && fields.map(([key, field]) => <label key={key} style={{ display: 'block', marginBottom: 12 }}>
        {field.title ?? key}{q.params.requestedSchema?.required?.includes(key) ? ' *' : ''}
        {field.description && <small style={{ display: 'block' }}>{field.description}</small>}
        {field.enum || field.type === 'boolean'
          ? <select style={inputStyle} aria-label={field.title ?? key} value={answers[key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [key]: e.target.value }))}><option value="">Choose…</option>{(field.enum ?? ['true', 'false']).map((v) => <option key={v} value={v}>{v}</option>)}</select>
          : <input style={inputStyle} aria-label={field.title ?? key} type={['number', 'integer'].includes(field.type ?? '') ? 'number' : 'text'} value={answers[key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [key]: e.target.value }))} />}
      </label>)}
      {unsupported && <p>This connector requested a form type Workspace cannot display yet. Decline it and complete the operation in the connector.</p>}
      {error && <p role="alert">{error}</p>}
      {<button style={buttonStyle} onClick={() => void send(true)} disabled={unsupported || (input && q.params.questions?.some((item) => !answers[item.id]?.trim())) || (elicitation && q.params.mode !== 'url' && q.params.requestedSchema?.required?.some((key) => !answers[key]?.trim()))}>{input ? 'Send answer' : elicitation ? 'Confirm' : 'Allow once'}</button>}
      {!input && <button style={buttonStyle} onClick={() => void send(false)}>Decline</button>}
      {input && <button style={buttonStyle} onClick={() => void window.workspace.agent.cancel(q.runId)}>Stop run</button>}
    </div>
  )
}
