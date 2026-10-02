import { beforeEach, describe, expect, it } from 'vitest'
import { toastStore } from './toastStore'

describe('toastStore', () => {
  beforeEach(() => toastStore.reset())

  it('keeps the latest three, newest last', () => {
    for (const t of ['a', 'b', 'c', 'd']) toastStore.push(t, 'ok', 0)
    expect(toastStore.getSnapshot().map((t) => t.text)).toEqual(['b', 'c', 'd'])
  })

  it('dismisses one by id and tells subscribers', () => {
    let calls = 0
    const off = toastStore.subscribe(() => calls++)
    const id = toastStore.push('x', 'ok', 0)
    toastStore.dismiss(id)
    expect(toastStore.getSnapshot()).toEqual([])
    expect(calls).toBe(2)
    off()
  })
})
