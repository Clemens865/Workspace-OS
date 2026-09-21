import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import styles from './SettingsPanel.module.css'

/**
 * "Connectors & Keys" — lists Wave-1 MCP connectors, lets the user toggle each
 * on/off and store the required key(s) in the encrypted vault. A stored secret
 * value is NEVER displayed back; the field only ever writes. Warns when secure
 * storage is unavailable (e.g. Linux basic_text) so the user knows keys can't
 * be stored safely.
 */

type Connector = {
  id: string
  displayName: string
  description: string
  kind: 'stdio-apikey' | 'remote-oauth'
  secrets: { envVar: string; label: string; hint: string }[]
}
type ConnStatus = {
  id: string
  kind: 'stdio-apikey' | 'remote-oauth'
  enabled: boolean
  requiredSecrets: string[]
  missingSecrets: string[]
  connected?: boolean
  ready: boolean
}
type VaultStatus = { available: boolean; backend: string }

export function ConnectorsPanel(): JSX.Element {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [status, setStatus] = useState<Record<string, ConnStatus>>({})
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [connecting, setConnecting] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    const [list, st, vs] = await Promise.all([
      window.workspace.mcp.listConnectors(),
      window.workspace.mcp.status(),
      window.workspace.secrets.status(),
    ])
    setConnectors(list)
    setStatus(Object.fromEntries(st.map((s) => [s.id, s])))
    setVault(vs)
  }, [])

  useEffect(() => { refresh().catch(() => {}) }, [refresh])

  const toggle = async (id: string, on: boolean): Promise<void> => {
    try {
      if (on) await window.workspace.mcp.enable(id)
      else await window.workspace.mcp.disable(id)
      await refresh()
    } catch { /* surfaced by refresh's status */ }
  }

  const saveKey = async (envVar: string): Promise<void> => {
    const value = drafts[envVar]
    if (!value) return
    try {
      await window.workspace.secrets.set(envVar, value)
      setDrafts((d) => ({ ...d, [envVar]: '' }))
      setErrors((e) => ({ ...e, [envVar]: '' }))
      await refresh()
    } catch (err) {
      setErrors((e) => ({ ...e, [envVar]: (err as Error).message || 'Could not store key' }))
    }
  }

  const removeKey = async (envVar: string): Promise<void> => {
    try {
      await window.workspace.secrets.remove(envVar)
      await refresh()
    } catch { /* ignore */ }
  }

  const connectOAuth = async (id: string): Promise<void> => {
    setConnecting((c) => ({ ...c, [id]: true }))
    setErrors((e) => ({ ...e, [id]: '' }))
    try {
      const res = await window.workspace.mcp.oauthConnect(id)
      if (!res.ok) setErrors((e) => ({ ...e, [id]: res.error || 'Could not connect' }))
      await refresh()
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: (err as Error).message || 'Could not connect' }))
    } finally {
      setConnecting((c) => ({ ...c, [id]: false }))
    }
  }

  const disconnectOAuth = async (id: string): Promise<void> => {
    try {
      await window.workspace.mcp.oauthDisconnect(id)
      await refresh()
    } catch { /* ignore */ }
  }

  const secureUnavailable = vault && !vault.available

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Connectors &amp; Keys</h3>
      <p className={styles.hint}>
        Enable an MCP connector to let the terminal agent reach it. Keys are encrypted with your OS keychain and
        injected only when the agent runs — they never appear in logs or the command line.
      </p>

      {secureUnavailable && (
        <div className={styles.warn}>
          <AlertTriangle size={15} style={{ flex: 'none', marginTop: 1 }} />
          <span>
            Secure storage is unavailable (backend: {vault?.backend}). Keys can’t be stored safely on this system,
            so saving is disabled. Install a system keychain (e.g. gnome-keyring / kwallet) and restart.
          </span>
        </div>
      )}

      {connectors.map((c) => {
        const st = status[c.id]
        const enabled = st?.enabled ?? false
        const ready = st?.ready ?? false
        const isRemote = c.kind === 'remote-oauth'
        const connected = st?.connected ?? false
        return (
          <div key={c.id} className={styles.connector}>
            <div className={styles.connectorHead}>
              <span className={styles.connectorName}>{c.displayName}</span>
              {enabled && (
                <span className={`${styles.badge} ${ready ? styles.badgeReady : styles.badgeNeeds}`}>
                  {ready ? 'Ready' : isRemote ? 'Not connected' : 'Needs key'}
                </span>
              )}
              <div className={styles.connectorToggle}>
                <div className={styles.segmented}>
                  <button className={enabled ? styles.segOn : styles.segOff} onClick={() => toggle(c.id, true)}>On</button>
                  <button className={!enabled ? styles.segOn : styles.segOff} onClick={() => toggle(c.id, false)}>Off</button>
                </div>
              </div>
            </div>
            <p className={styles.connectorDesc}>{c.description}</p>

            {isRemote && (
              <div>
                <div className={styles.keyRow}>
                  <span className={styles.keyName}>OAuth connection</span>
                  {connected && (
                    <span className={styles.keyStored}>
                      <Check size={12} style={{ verticalAlign: 'middle' }} /> connected
                    </span>
                  )}
                </div>
                <div className={styles.keyField}>
                  <button
                    className={styles.btn}
                    disabled={!!secureUnavailable || !!connecting[c.id]}
                    onClick={() => connectOAuth(c.id)}
                  >
                    {connecting[c.id] ? 'Connecting…' : connected ? 'Reconnect' : 'Connect with OAuth'}
                  </button>
                  {connected && (
                    <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => disconnectOAuth(c.id)}>
                      Disconnect
                    </button>
                  )}
                </div>
                <p className={styles.keyHint}>
                  Opens your browser to sign in. We store only a refresh token (encrypted); the agent gets a fresh
                  access token at connect time — no token ever touches logs or the command line.
                </p>
                {errors[c.id] && <p className={styles.errText}>{errors[c.id]}</p>}
              </div>
            )}

            {c.secrets.map((s) => {
              const stored = st ? !st.missingSecrets.includes(s.envVar) : false
              return (
                <div key={s.envVar}>
                  <div className={styles.keyRow}>
                    <span className={styles.keyName}>{s.label}</span>
                    {stored && (
                      <span className={styles.keyStored}>
                        <Check size={12} style={{ verticalAlign: 'middle' }} /> stored
                      </span>
                    )}
                  </div>
                  <div className={styles.keyField}>
                    <input
                      className={styles.pwInput}
                      type="password"
                      autoComplete="off"
                      placeholder={stored ? 'Replace stored key…' : 'Paste key…'}
                      value={drafts[s.envVar] ?? ''}
                      disabled={!!secureUnavailable}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.envVar]: e.target.value }))}
                    />
                    <button
                      className={styles.btn}
                      disabled={!!secureUnavailable || !(drafts[s.envVar] ?? '').trim()}
                      onClick={() => saveKey(s.envVar)}
                    >
                      {stored ? 'Update' : 'Add key'}
                    </button>
                    {stored && (
                      <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => removeKey(s.envVar)}>
                        Remove
                      </button>
                    )}
                  </div>
                  <p className={styles.keyHint}>{s.hint}</p>
                  {errors[s.envVar] && <p className={styles.errText}>{errors[s.envVar]}</p>}
                </div>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}
