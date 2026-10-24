import { describe, expect, it } from 'vitest'
import { fileUrl } from './fileUrl'

describe('fileUrl', () => {
  it('keeps POSIX paths as file:///…', () => {
    expect(fileUrl('/Users/me/logo.png')).toBe('file:///Users/me/logo.png')
  })
  it('turns a Windows path into file:///C:/…', () => {
    expect(fileUrl('C:\\Users\\me\\logo.png')).toBe('file:///C:/Users/me/logo.png')
  })
  it('escapes spaces, # and ?', () => {
    expect(fileUrl('/a b/#1?.png')).toBe('file:///a%20b/%231%3F.png')
  })
})
