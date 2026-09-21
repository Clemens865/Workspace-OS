import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { authorizeArtifactPath, isAuthorizedArtifact } from './artifact-allowlist'

describe('artifact-allowlist', () => {
  it('authorizes a path and recognizes it by real path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-art-'))
    const f = path.join(dir, 'cv.pdf')
    fs.writeFileSync(f, 'x')
    expect(isAuthorizedArtifact(f)).toBe(false)
    authorizeArtifactPath(f)
    expect(isAuthorizedArtifact(f)).toBe(true)
    // a different, un-authorized sibling stays denied
    const g = path.join(dir, 'other.pdf')
    fs.writeFileSync(g, 'y')
    expect(isAuthorizedArtifact(g)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
