import { useEffect } from 'react'
import { actionById, type SurfaceActionContext } from '../components/Terminal/surfaceActions'
import { browserDriver } from '../lib/browserDriver'

/**
 * AGENT→ACTION bridge — the renderer EXECUTOR.
 *
 * When the in-app agent runs `wos-action run <id>`, main forwards it here via
 * AGENT_ACTION_INVOKE. We look the id up in the SAME surfaceActions registry the
 * dock chips use, build the live harness ctx, run it, and reply reqId-correlated
 * over AGENT_ACTION_RESULT. This is what makes the agent drive the LIVE UI —
 * one registry, one behavior, whether a human clicks a chip or the agent calls.
 *
 * Guards: only a registered id runs (unknown → error reply); every run is
 * wrapped so a throwing action reports {ok:false} instead of hanging main. The
 * registry itself exposes no send/delete, so nothing destructive is reachable.
 *
 * `ctxRef` is a live getter so each invocation runs against the CURRENT harness
 * (surface/open file), not a stale snapshot from mount.
 */
export function useAgentActions(getCtx: () => SurfaceActionContext): void {
  useEffect(() => {
    const api = window.workspace.agentActions
    if (!api) return
    const off = api.onInvoke(async ({ reqId, actionId, args, runId }) => {
      const tab = typeof (args as { tab?: unknown } | undefined)?.tab === 'string' ? (args as { tab: string }).tab : undefined
      browserDriver.record(runId, actionId, tab)
      const reply = await runAgentAction(actionId, getCtx, args)
      // A tab the agent opened for itself is its own from now on.
      const made = (reply.result as { tabId?: unknown } | undefined)?.tabId
      if (actionId === 'browser.newTab' && typeof made === 'string') browserDriver.record(runId, actionId, made)
      api.result({ reqId, ...reply })
    })
    return off
  }, [getCtx])
}

/**
 * Run one agent-invoked action against the live harness. Pure of React/IPC so
 * the executor is unit-testable: look the id up in the registry (unknown →
 * error), run it against the current ctx (+ the agent's JSON args), and never
 * throw — a failing action becomes {ok:false} rather than a hung round-trip. A
 * value RETURNED by the action becomes `result` so the bridge can relay extracted
 * data / a screenshot path back to the agent.
 */
export async function runAgentAction(
  actionId: string,
  getCtx: () => SurfaceActionContext,
  args?: unknown,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const action = actionById(actionId)
  if (!action) return { ok: false, error: `unknown action: ${actionId}` }
  try {
    const result = await action.run(getCtx(), args)
    return result === undefined ? { ok: true } : { ok: true, result }
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? 'action failed' }
  }
}
