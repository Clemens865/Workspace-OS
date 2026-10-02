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
