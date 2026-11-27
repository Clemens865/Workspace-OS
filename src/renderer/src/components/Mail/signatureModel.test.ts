import { describe, it, expect, vi } from 'vitest'
import { loadSignature, storeSignature, MAX_SIGNATURE } from './signatureModel'

describe('loadSignature', () => {
  it('reads the account’s signature', async () => {
    const get = vi.fn(async () => ({ ok: true as const, value: 'Ana\nAcme' }))
    await expect(loadSignature(get, 'a1')).resolves.toEqual({ text: 'Ana\nAcme' })
    expect(get).toHaveBeenCalledWith('a1')
  })

  it('reports a failure, so an unread signature is never saved over', async () => {
    await expect(
      loadSignature(async () => ({ ok: false as const, error: { code: 'unknown' as const, message: 'No such account' } }), 'a1'),
    ).resolves.toEqual({ error: 'No such account' })
    await expect(loadSignature(async () => { throw new Error('disk') }, 'a1')).resolves.toEqual({ error: 'disk' })
  })
})

describe('storeSignature', () => {
  it('saves the text for that account', async () => {
    const set = vi.fn(async () => ({ ok: true as const }))
    await expect(storeSignature(set, 'a1', 'Ana')).resolves.toBeNull()
    expect(set).toHaveBeenCalledWith('a1', 'Ana')
  })

  it('refuses one main would cut short', async () => {
    const set = vi.fn(async () => ({ ok: true as const }))
    await expect(storeSignature(set, 'a1', 'x'.repeat(MAX_SIGNATURE + 1))).resolves.toContain(String(MAX_SIGNATURE))
    expect(set).not.toHaveBeenCalled()
  })

  it('reports why it could not be saved', async () => {
    const set = async (): Promise<never> => {
      throw new Error("Error invoking remote method 'mail:signature-set': Error: read-only disk")
    }
    await expect(storeSignature(set, 'a1', 'Ana')).resolves.toBe('read-only disk')
  })
})
