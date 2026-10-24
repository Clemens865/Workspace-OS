import { describe, it, expect } from 'vitest'
import { homeFor } from './ProjectSwitcher'

describe('project home', () => {
  it('keeps the remembered parent while the workspace is inside it', () => {
    expect(homeFor('/w/clients/acme', '/w')).toBe('/w')
    expect(homeFor('/w', '/w')).toBe('/w')
  })

  it('falls back to the workspace itself when it is elsewhere', () => {
    expect(homeFor('/other', '/w')).toBe('/other')
    expect(homeFor('/wide', '/w')).toBe('/wide')
    expect(homeFor('/w', null)).toBe('/w')
  })
})

describe('homeFor on Windows', () => {
  it('keeps a remembered parent for a workspace inside it, regardless of case', () => {
    expect(homeFor('D:\\OBS\\vault\\clients\\acme', 'd:\\obs\\vault')).toBe('d:\\obs\\vault')
    expect(homeFor('D:\\OBS\\vault-old', 'D:\\OBS\\vault')).toBe('D:\\OBS\\vault-old')
  })
})
