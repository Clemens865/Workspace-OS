import fs from 'fs'
import path from 'path'
import { isValidModelAlias } from './modelPick'

// Main owns the persisted default so overdue routines don't depend on a renderer.
let file: string | undefined
let model = ''
let effort = ''
const efforts = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
export function getCodexEffort(): string { return effort }
export function setCodexEffort(value: unknown): void {
  if (typeof value !== 'string' || !efforts.includes(value)) throw new Error('Invalid Codex reasoning effort')
  effort = value
  persist()
}
export function getProviderModel(): string { return model }
export function loadProviderSettings(userData: string): void {
  file = path.join(userData, 'agent-provider.json')
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    model = isValidModelAlias(saved.model) ? saved.model : ''
    effort = efforts.includes(saved.effort) ? saved.effort : ''
  } catch { model = ''; effort = '' }
}
export function setProviderModel(value: unknown): void {
  model = isValidModelAlias(value) ? value : ''
  persist()
}
function persist(): void {
  if (file) {
    fs.writeFileSync(file + '.tmp', JSON.stringify({ model, effort }), { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
  }
}
