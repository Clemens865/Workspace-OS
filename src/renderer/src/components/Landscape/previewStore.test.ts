import { describe, it, expect } from 'vitest'
import { appendTail, clean, lastLines, outputStore } from './previewStore'

describe('output tails', () => {
  it('strips terminal colour codes and stray carriage returns', () => {
    expect(clean('\x1b[2m[done]\x1b[0m\r\nok\rnext')).toBe('[done]\nok\nnext')
  })

  it('keeps only the last characters', () => {
    expect(appendTail('abc', 'defg', 5)).toBe('cdefg')
  })

  it('returns the last non-empty lines', () => {
    expect(lastLines('one\n\ntwo\nthree  \n\n', 2)).toEqual(['two', 'three'])
  })

  it('stores per run and notifies', () => {
    let n = 0
    const off = outputStore.subscribe(() => n++)
    outputStore.push('run-a', 'Reading the brief\n')
    outputStore.push('run-a', 'Writing section 2')
    off()
    expect(n).toBe(2)
    expect(outputStore.get('run-a')?.text).toBe('Reading the brief\nWriting section 2')
    expect(outputStore.get(null)).toBeUndefined()
  })
})
