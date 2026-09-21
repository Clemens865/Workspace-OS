import { useEffect, useRef } from 'react'
import type { FileAction, ActionContext } from '../../lib/fileActions'
import styles from './ActionMenu.module.css'

interface ActionMenuProps {
  items: { action: FileAction; ctx: ActionContext }[]
  onClose: () => void
}

const GROUP_ORDER: FileAction['group'][] = ['file', 'edit', 'export', 'danger']

/**
 * Dropdown of file actions, grouped and separated. Driven entirely by the
 * action registry — surfaces don't hardcode the items.
 */
export function ActionMenu({ items, onClose }: ActionMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const groups = GROUP_ORDER
    .map((g) => items.filter((it) => it.action.group === g))
    .filter((g) => g.length > 0)

  return (
    <div ref={ref} className={styles.menu} role="menu">
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className={styles.separator} />}
          {group.map(({ action, ctx }) => {
            const Icon = action.icon
            return (
              <button
                key={action.id}
                className={`${styles.item} ${action.danger ? styles.danger : ''}`}
                onClick={() => { action.run(ctx); onClose() }}
              >
                <Icon size={15} strokeWidth={1.9} className={styles.icon} />
                {action.label(ctx)}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
