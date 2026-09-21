import {
  Home,
  Files,
  Mail,
  Calendar,
  MessageSquare,
  Globe,
  Bot,
  Gauge,
  Network,
  Brain,
  Plug,
  Settings,
} from 'lucide-react'
import type { RailId } from './shellModel'
import { RAIL_ITEMS } from './shellModel'
import styles from './WorkspaceShell.module.css'

const ICONS: Record<RailId, typeof Home> = {
  home: Home,
  files: Files,
  mail: Mail,
  calendar: Calendar,
  chats: MessageSquare,
  browser: Globe,
  agents: Bot,
  cockpit: Gauge,
  knowledge: Network,
  memory: Brain,
  connectors: Plug,
  settings: Settings,
}

interface RailProps {
  active: RailId
  onSelect: (id: RailId) => void
}

/** Left rail — the top-level surface switcher (matches prototype.html). */
export function Rail({ active, onSelect }: RailProps): JSX.Element {
  return (
    <nav className={styles.rail} aria-label="Primary">
      <div className={styles.rlogo}>W</div>
      {RAIL_ITEMS.map((item, i) => {
        const Icon = ICONS[item.id]
        // Settings sits at the bottom — push it down with a spacer + hairline.
        const settingsDivider = item.id === 'settings'
        return (
          <span key={item.id} style={{ display: 'contents' }}>
            {settingsDivider && <div className={styles.railSpacer} key={`sp-${i}`} />}
            <button
              className={`${styles.ritem} ${active === item.id ? styles.ritemOn : ''}`}
              onClick={() => onSelect(item.id)}
              aria-current={active === item.id ? 'page' : undefined}
              title={item.label}
            >
              <Icon />
              {item.label}
            </button>
          </span>
        )
      })}
    </nav>
  )
}
