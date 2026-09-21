import fs from 'fs'
import path from 'path'
import { docgenResourceDir } from '../../docgen'
import { agentActionGuide } from '../../context/workspaceContext'
import { capabilityGuidanceBlock } from '../capabilityCatalog'
import type { AgentFile } from '../../handlers/agents'

export function codexGuidance(root: string, activeFile: string | null, agent: AgentFile | null, safe: boolean, memory: string): string {
  let schemas = ''
  try {
    const skill = fs.readFileSync(path.join(docgenResourceDir(), 'SKILL.md'), 'utf8')
    schemas = skill.slice(skill.indexOf('## Spec schemas'))
  } catch { /* CLI help remains available */ }
  return [
    agent?.persona ?? '',
    'You are the Codex agent inside Workspace OS. Work on the user’s real artifacts and leave results for review.',
    `Workspace: ${root}. ${activeFile ? `Open document: ${activeFile}` : ''}`,
    agent?.capabilities?.length ? capabilityGuidanceBlock(agent.capabilities).replace(/one Task per item/g, 'one supported Codex subagent per item').replace(/with the Write tool/g, 'with the available file tools') : '',
    agentActionGuide(),
    'Workspace operations use `wos-action run <action> \'<JSON arguments>\'`. Your run identity grants only the authorized surfaces. Never send mail or bypass a rejected grant. Draft for the user.',
    'PREFERRED TRANSPORT: use the workspace_action tool with actionId and args for all Workspace operations, including document.generate and document.data. It goes directly to the same grant-checked app handler and works in Safe mode and unattended routines without shell escalation. The wos-action CLI examples below describe the same actionId and args; use the tool when available.',
    'DOCUMENT TRANSPORT: create files with `wos-action run document.generate \'{"format":"xlsx","name":"Budget.xlsx","spec":{"sheets":[{"name":"Budget","rows":[["Item","Amount"],["Example",100]]}]}}\'`. For pptx/docx use their specs below. For html/md provide `content` instead of `spec`. This operation creates a NEW file and refuses to overwrite an original. If the name exists, choose a new name. Returned path is the deliverable.',
    safe ? 'SAFE MODE: your shell is read-only. Do NOT write a spec or run wos-gen directly. Send the spec inline to document.generate above; main performs the granted artifact operation. Other direct shell writes will fail. You may read and use granted app operations.' : 'FULL MODE: edits within the workspace are allowed. Requests for additional permissions go to the user. Do not retry a denied operation through another mechanism.',
    'For live data use `wos-action run document.data \'{"operation":"metric:list","args":[]}\'`; `document.data` exposes the validated metric/range/collection operations, not arbitrary IPC. Ask `document.data` with operation "help" for its exact operations.',
    'To remember or recall facts use `wos-action run memory.remember \'{"text":"...","kind":"fact","source":"..."}\'` or `wos-action run memory.search \'{"query":"..."}\'`. Respect a refused capability.',
    'Use the installed Codex skills when applicable. A skill’s file-writing recipe must respect the Safe/Full transport rules above. Subagents must use Codex’s supported subagent tools and inherit only the parent’s grant.',
    schemas,
    memory,
  ].filter(Boolean).join('\n\n')
}
