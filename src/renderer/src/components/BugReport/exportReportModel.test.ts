import { describe, it, expect } from 'vitest'
import { exportOutcome } from './exportReportModel'

describe('exportOutcome', () => {
  it('says where the file went', async () => {
    await expect(exportOutcome(async () => ({ path: '/home/a/bug.md' }))).resolves.toEqual({
      saved: 'Saved to /home/a/bug.md. Nothing was sent.',
      error: null,
    })
  })

  it('says nothing when the save was dismissed', async () => {
    await expect(exportOutcome(async () => ({ path: null }))).resolves.toEqual({ saved: null, error: null })
  })

  it('reports why it could not be written', async () => {
    await expect(
      exportOutcome(async () => { throw new Error("Error invoking remote method 'bug:export': Error: read-only folder") }),
    ).resolves.toEqual({ saved: null, error: 'read-only folder' })
  })
})
