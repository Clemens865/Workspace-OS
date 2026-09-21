import fs from 'fs'
import path from 'path'
import { isConnectorId } from './connectors'

/**
 * Persists WHICH connectors the user has enabled (a plain list of ids — no
 * secrets here). Lives in a small userData JSON. Enabling only records intent;
 * the required secret must additionally be present in the Vault for the
 * connector to actually wire into a run.
 */
const STATE_FILE = 'mcp-connectors.json'

export class ConnectorState {
  constructor(private readonly storeDir: string) {}

  private statePath(): string {
    return path.join(this.storeDir, STATE_FILE)
  }

  /** The set of enabled connector ids (validated against the catalog). */
  enabled(): string[] {
    try {
      const raw = fs.readFileSync(this.statePath(), 'utf-8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isConnectorId)
    } catch {
      return []
    }
  }

  private write(ids: string[]): void {
    fs.mkdirSync(this.storeDir, { recursive: true })
    fs.writeFileSync(this.statePath(), JSON.stringify([...new Set(ids)], null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    })
  }

  enable(id: string): void {
    if (!isConnectorId(id)) return
    const set = new Set(this.enabled())
    set.add(id)
    this.write([...set])
  }

  disable(id: string): void {
    if (!isConnectorId(id)) return
    this.write(this.enabled().filter((x) => x !== id))
  }

  isEnabled(id: string): boolean {
    return this.enabled().includes(id)
  }
}
