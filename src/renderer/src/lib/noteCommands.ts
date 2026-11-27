/**
 * The note commands of the shell: what the ⌘K palette lists besides the office
 * menu, and how a note main creates or finds gets onto the stage.
 */
import { ipcReason } from './ipcError'

/** The `menu:run-action` id of Go ▸ Today's Note (main/menu.ts sends the same). */
export const NOTE_DAILY_ACTION = 'notes.daily'

export interface PaletteCommand {
  id: string
  label: string
  path: string
  accel?: string
}

/** Commands that are there whatever is open. */
const APP_COMMANDS: PaletteCommand[] = [{ id: NOTE_DAILY_ACTION, label: "Today's Note", path: 'Go › Daily note' }]

/** The palette's command hits: labels that start with the query come first. */
export function matchCommands(officeCommands: PaletteCommand[], query: string, limit = 8): PaletteCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const starts = (c: PaletteCommand): number => (c.label.toLowerCase().startsWith(q) ? 0 : 1)
  return [...officeCommands, ...APP_COMMANDS]
    .filter((c) => c.label.toLowerCase().includes(q) || c.path.toLowerCase().includes(q))
    .sort((a, b) => starts(a) - starts(b))
    .slice(0, limit)
}

/** Asks main for a note and opens it; reports the reason when it cannot. */
export async function openNote(
  request: () => Promise<{ path: string; created: boolean }>,
  open: (path: string) => void,
  report: (message: string) => void,
): Promise<void> {
  try {
    open((await request()).path)
  } catch (e) {
    report(ipcReason(e))
  }
}
