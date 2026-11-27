import { describe, expect, it } from 'vitest'
import { agentMenuTemplate } from './menu-agent'
import type { MI } from './menu-office'

const flat = (items: MI[]): MI[] => items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu as MI[]) : [])])
function build(mode: 'full' | 'safe' = 'full'): { items: MI[]; sent: string[]; click: (label: string) => void } {
  const sent: string[] = []
  const menu = agentMenuTemplate({ agents: [{ id: 'agent.start:Elias', label: 'Elias' }], mode }, (id) => sent.push(id))
  const items = flat([menu])
  return { items, sent, click: (label) => (items.find((i) => i.label === label)!.click as () => void)() }
}

describe('the Agent menu', () => {
  it('sends an id the shell handles for every item', () => {
    const m = build()
    for (const l of ['Focus Agent', 'New Agent…', 'New Shell', 'Checkpoints…', 'Safe (read + generate only)', 'Full (run any command)', 'Default assistant', 'Elias']) m.click(l)
    expect(m.sent).toEqual(['agent.focus', 'agent.new', 'shell.new', 'agent.checkpoints', 'agent.mode:safe', 'agent.mode:full', 'agent.start:', 'agent.start:Elias'])
  })

  it('checks the current mode', () => {
    const checked = build('safe').items.filter((i) => i.checked).map((i) => i.label)
    expect(checked).toEqual(['Safe (read + generate only)'])
  })

  it('starts sessions rather than offering a selection or skills nothing would act on', () => {
    const { items } = build()
    expect(items.find((i) => i.label === 'New Session With')).toBeTruthy()
    expect(items.some((i) => i.label === 'Run Skill' || i.label === 'Agents')).toBe(false)
    expect(items.find((i) => i.label === 'Elias')!.type).toBeUndefined()
  })
})
