import { IpcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { codexSkills } from '../agent/providers/codexCatalog'
import { getProviderModel } from '../agent/providerSettings'
import { parseModelPick } from '../agent/modelPick'
import { getWorkspaceRoot } from '../workspace-root'

/**
 * Discovers the Claude skills available to the agent — global (~/.claude/skills)
 * and project (<workspace>/.claude/skills) — so the Agent UI can surface them
 * as invokable commands. The agent already loads these because it runs `claude`
 * with cwd = workspace root; this just makes them visible.
 */

export interface SkillInfo {
  name: string
  description: string
  scope: 'global' | 'project'
}

/** Pulls `name` / `description` out of a SKILL.md YAML frontmatter block. */
function parseSkill(skillMd: string, fallbackName: string): { name: string; description: string } {
  let name = fallbackName
  let description = ''
  const fm = /^---\s*\n([\s\S]*?)\n---/.exec(skillMd)
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^(name|description):\s*(.+?)\s*$/.exec(line)
      if (m) {
        const val = m[2].replace(/^["']|["']$/g, '')
        if (m[1] === 'name') name = val
        else description = val
      }
    }
  }
  return { name, description }
}

function listDir(dir: string, scope: 'global' | 'project'): SkillInfo[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: SkillInfo[] = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const md = path.join(dir, e.name, 'SKILL.md')
    let info = { name: e.name, description: '' }
    try {
      info = parseSkill(fs.readFileSync(md, 'utf-8'), e.name)
    } catch {
      continue // no SKILL.md — not a skill
    }
    out.push({ name: info.name, description: info.description, scope })
  }
  return out
}

export function registerSkillsHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.SKILLS_LIST, async (_event, model) => {
    if (parseModelPick(model || getProviderModel()).provider === 'codex') {
      // A missing or older Codex must still answer: the native Agent menu is
      // built from this reply and stays empty when it rejects.
      let native: Awaited<ReturnType<typeof codexSkills>> = []
      try { native = await codexSkills(getWorkspaceRoot() ?? os.homedir()) } catch { /* no Codex install or app-server */ }
      return [...native.filter((s) => s.name !== 'office-docgen'), { name: 'office-docgen', description: 'Create Office documents through the Workspace document bridge', scope: 'global' as const }].sort((a, b) => a.name.localeCompare(b.name))
    }
    const global = listDir(path.join(os.homedir(), '.claude', 'skills'), 'global')
    const root = getWorkspaceRoot()
    const project = root ? listDir(path.join(root, '.claude', 'skills'), 'project') : []
    // Project skills win on name collisions.
    const byName = new Map<string, SkillInfo>()
    for (const s of [...global, ...project]) byName.set(s.name, s)
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  })
}
