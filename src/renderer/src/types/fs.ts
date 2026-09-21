export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  /**
   * WOS-013: bytes, and last-modified in epoch ms. Both come from `fs:read-dir`.
   * Optional because older persisted shapes (and the quick-open file list) don't
   * carry them; treat a missing value as unknown rather than as zero.
   */
  size?: number
  mtimeMs?: number
}

export interface TreeNode extends FileEntry {
  children?: TreeNode[]
  isLoaded: boolean
}
