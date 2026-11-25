import fs from 'node:fs/promises'
import path from 'node:path'

// Reject symlinks/junctions in every existing ancestor. A missing suffix is OK;
// access errors are not absence. Recheck immediately before destructive I/O.
export async function assertPlainPath(target) {
  if (!path.isAbsolute(target)) throw new Error('Storage path must be absolute')
  const absolute = path.resolve(target)
  const root = path.parse(absolute).root
  let current = root
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    try {
      const info = await fs.lstat(current)
      if (info.isSymbolicLink()) throw new Error(`Refusing linked storage path: ${current}`)
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
  }
}
