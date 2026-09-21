import { describe, it, expect } from 'vitest'
import { validateBuildOutput } from './foundry'
import { requiredMode } from './capabilityCatalog'

/**
 * The Foundry's mode must be DERIVED from the granted capabilities, not taken
 * from the builder model.
 *
 * The regression this pins: the builder prompt says "prefer safe", and the model
 * duly returned `safe` for a travel planner whose description was entirely about
 * opening a browser tab per option and comparing them — work safe mode cannot do,
 * because it has no Task/Agent and therefore no parallel fan-out. The agent
 * shipped without the capability its own description asked for.
 */
describe('requiredMode', () => {
  it('is full when any capability declares full', () => {
    expect(requiredMode(['research', 'webpage'])).toBe('full') // webpage → full
    expect(requiredMode(['files'])).toBe('full')
  })

  it('is safe when every capability works in safe mode', () => {
    expect(requiredMode(['research', 'documents', 'mail'])).toBe('safe')
  })

  it('is safe for an empty set, and ignores unknown ids', () => {
    expect(requiredMode([])).toBe('safe')
    expect(requiredMode(['not-a-capability'])).toBe('safe')
  })
})

describe('validateBuildOutput mode derivation', () => {
  const base = { name: 'Marlow — Trip Planner', persona: 'You are Marlow.', description: 'Plans trips.' }

  it("escalates the model's 'safe' to full when a capability requires it", () => {
    const spec = validateBuildOutput({ ...base, capabilities: ['research', 'webpage', 'files'], mode: 'safe' })
    expect(spec?.mode).toBe('full')
    expect(spec?.capabilities).toContain('webpage')
  })

  it('grants cases to EVERY agent — a run that leaves files but no case is invisible to the cockpit', () => {
    // The job scout was born without `cases`: it produced a perfect workbook
    // and the cockpit never heard about it. Standing equipment now.
    expect(validateBuildOutput({ ...base, capabilities: ['research'], mode: 'safe' })?.capabilities).toContain('cases')
    expect(validateBuildOutput({ ...base, capabilities: [], mode: 'safe' })?.capabilities).toEqual(['cases'])
    // Already granted → not duplicated.
    expect(
      validateBuildOutput({ ...base, capabilities: ['cases', 'research'], mode: 'safe' })?.capabilities.filter((c) => c === 'cases'),
    ).toHaveLength(1)
  })

  it('mode follows the standing cases grant — full, since case actions need it', () => {
    expect(validateBuildOutput({ ...base, capabilities: ['research', 'documents'], mode: 'safe' })?.mode).toBe('full')
    expect(validateBuildOutput({ ...base, capabilities: [], mode: 'safe' })?.mode).toBe('full')
  })

  it('honours an explicit full even when nothing requires it', () => {
    expect(validateBuildOutput({ ...base, capabilities: ['documents'], mode: 'full' })?.mode).toBe('full')
  })

  it('still rejects output missing a name or persona', () => {
    expect(validateBuildOutput({ ...base, name: '', capabilities: [], mode: 'safe' })).toBeNull()
    expect(validateBuildOutput({ ...base, persona: '  ', capabilities: [], mode: 'safe' })).toBeNull()
  })
})
