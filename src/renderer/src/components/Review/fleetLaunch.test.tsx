import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'

/**
 * Fleet "+ Launch agent": picking an agent must reach the live shell, which
 * opens a terminal dock tab on `wos:launch-agent`. There is no DOM here, so the
 * view is called as a function (its menu forced open) and the item clicked.
 */
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (v: unknown) => [v === false ? true : v, () => {}],
  useMemo: (f: () => unknown) => f(),
}))
vi.mock('./useReviewStore', () => ({ useReviewStore: () => ({ runs: [], hitl: [] }) }))
vi.mock('./useFleetLaunch', async (original) => ({
  ...(await original<object>()),
  useAgentRoster: () => [{ name: 'Elias', description: 'Writes applications' }],
}))

const sent: CustomEvent[] = []
vi.stubGlobal('window', { dispatchEvent: (e: CustomEvent) => (sent.push(e), true) })

import { FleetView } from './FleetView'
import { launchAgent } from '../Agents/launch'

type Props = { children?: ReactNode; role?: string; onClick?: () => void }
function menuItems(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(menuItems)
  if (!isValidElement<Props>(node)) return []
  return [...(node.props.role === 'menuitem' ? [node.props] : []), ...menuItems(node.props.children)]
}

beforeEach(() => {
  sent.length = 0
})

describe('Fleet launch', () => {
  it('asks the shell to open a tab for the picked agent', () => {
    const [item] = menuItems(FleetView({ onOpenFile: () => {}, onWorkspaceChanged: () => {} }))
    item.onClick!()
    expect(sent.map((e) => [e.type, e.detail])).toEqual([['wos:launch-agent', { name: 'Elias' }]])
  })

  it('sends that one request and nothing to the retired agent console', () => {
    launchAgent('Elias')
    expect(sent.map((e) => e.type)).toEqual(['wos:launch-agent'])
  })
})
