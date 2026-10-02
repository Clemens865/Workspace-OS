import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createProject, folderName, isHomeOf, listProjects, readMarker } from './projects'

let home: string
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-projects-'))
})
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))

describe('sub-projects', () => {
  it('lists the home first, then marked subfolders by name', () => {
    createProject(home, 'Website launch')
    createProject(home, 'Brand', '#D97757')
    fs.mkdirSync(path.join(home, 'plain-folder'))
    const list = listProjects(home)
    expect(list[0]).toMatchObject({ path: home, home: true })
    expect(list.slice(1).map((p) => p.name)).toEqual(['Brand', 'Website launch'])
    expect(list[1].color).toBe('#D97757')
  })

  it('finds a project two levels down, skips dot-folders and Work/Cases', () => {
    fs.mkdirSync(path.join(home, 'clients'))
    createProject(path.join(home, 'clients'), 'Acme')
    fs.mkdirSync(path.join(home, '.hidden', 'x'), { recursive: true })
    fs.mkdirSync(path.join(home, '.hidden', 'x', '.workspace-os'), { recursive: true })
    fs.writeFileSync(path.join(home, '.hidden', 'x', '.workspace-os', 'project.json'), '{}')
    expect(listProjects(home).map((p) => p.name)).toEqual([path.basename(home), 'Acme'])
  })

  it('creates the folder with its marker, Cases/ and Work/', () => {
    const p = createProject(home, 'Q4 report')
    expect(fs.existsSync(path.join(p.path, 'Cases'))).toBe(true)
    expect(fs.existsSync(path.join(p.path, 'Work'))).toBe(true)
    expect(readMarker(p.path)?.name).toBe('Q4 report')
    expect(() => createProject(home, 'Q4 report')).toThrow(/already exists/)
  })

  it('makes safe folder names', () => {
    expect(folderName('  Café / Ops: 2026  ')).toBe('Cafe Ops 2026')
    expect(() => folderName('///')).toThrow()
  })

  it('only treats the workspace and its ancestors as a home', () => {
    expect(isHomeOf('/a/b', '/a/b')).toBe(true)
    expect(isHomeOf('/a', '/a/b/c')).toBe(true)
    expect(isHomeOf('/a/bc', '/a/b')).toBe(false)
    expect(isHomeOf('/x', '/a/b')).toBe(false)
  })

  it('a broken marker does not count as a project', () => {
    fs.mkdirSync(path.join(home, 'p', '.workspace-os'), { recursive: true })
    fs.writeFileSync(path.join(home, 'p', '.workspace-os', 'project.json'), 'not json')
    expect(readMarker(path.join(home, 'p'))).toBeNull()
  })
})
