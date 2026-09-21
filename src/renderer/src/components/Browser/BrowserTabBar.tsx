import { Globe, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { BrowserTab } from './browserTabs'
import type { TabGroup } from './tab-groups'
import styles from './BrowserTabBar.module.css'

/**
 * The Browser surface's TAB STRIP — one entry per open tab (favicon or a globe
 * + the truncated page title), an active state, a close ×, and a + new-tab
 * button. Token-styled to read like the terminal dock's active tab (calm
 * surfaces, one blue). Pure/presentational: all state lives in the reducer.
 */

interface Props {
  tabs: BrowserTab[]
  activeId: string
  /** Groups that have formed. Empty is the normal state. */
  groups: TabGroup[]
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onToggleGroup: (id: string) => void
  onRenameGroup: (id: string, name: string) => void
  onUngroup: (id: string) => void
}

/** A tab's display label: its title, else its host, else "New Tab". */
function labelFor(tab: BrowserTab): string {
  if (tab.title) return tab.title
  if (tab.url) {
    try {
      return new URL(tab.url).hostname.replace(/^www\./, '')
    } catch {
      return tab.url
    }
  }
  return 'New Tab'
}

export function BrowserTabBar({
  tabs,
  activeId,
  groups,
  onActivate,
  onClose,
  onNew,
  onToggleGroup,
  onRenameGroup,
  onUngroup,
}: Props): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)

  /**
   * Tabs in strip order, with each group's header rendered once — at the
   * position of its FIRST member, so grouping never reorders the strip. A tab
   * that jumps position when a group forms would be worse than no grouping:
   * the point is to label what is already there.
   */
  const rendered: JSX.Element[] = []
  const headerDone = new Set<string>()

  const groupHeader = (g: TabGroup, count: number): JSX.Element => (
    <div
      key={`h-${g.id}`}
      className={styles.groupHead}
      data-color={g.color}
      onDoubleClick={() => setEditing(g.id)}
      title={`${g.name} — ${count} tabs. Double-click to rename.`}
    >
      <button
        type="button"
        className={styles.groupDot}
        data-color={g.color}
        onClick={() => onToggleGroup(g.id)}
        aria-label={g.collapsed ? `Expand ${g.name}` : `Collapse ${g.name}`}
      />
      {editing === g.id ? (
        <input
          className={styles.groupInput}
          defaultValue={g.name}
          autoFocus
          onBlur={(e) => {
            onRenameGroup(g.id, e.target.value)
            setEditing(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditing(null)
          }}
        />
      ) : (
        <button type="button" className={styles.groupName} onClick={() => onToggleGroup(g.id)}>
          {g.name}
          {g.collapsed && <span className={styles.groupCount}>{count}</span>}
        </button>
      )}
      <button
        type="button"
        className={styles.groupX}
        title="Ungroup these tabs (does not close them)"
        aria-label="Ungroup"
        onClick={() => onUngroup(g.id)}
      >
        <X size={11} />
      </button>
    </div>
  )

  return (
    <div className={styles.strip} role="tablist" aria-label="Browser tabs">
      <div className={styles.tabScroll}>
        {tabs.map((tab) => {
          const on = tab.id === activeId
          const group = tab.groupId ? groups.find((g) => g.id === tab.groupId) : undefined

          if (group && !headerDone.has(group.id)) {
            headerDone.add(group.id)
            rendered.push(groupHeader(group, tabs.filter((t) => t.groupId === group.id).length))
          }
          // A collapsed group hides its members but never the ACTIVE tab —
          // hiding the page you are looking at is not a state a browser should
          // be able to reach.
          if (group?.collapsed && !on) return null

          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={on}
              className={`${styles.tab} ${on ? styles.tabOn : ''} ${group ? styles.tabGrouped : ''}`}
              data-color={group ? group.color : undefined}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(e) => {
                // Middle-click closes, like a real browser.
                if (e.button === 1) {
                  e.preventDefault()
                  onClose(tab.id)
                }
              }}
              title={labelFor(tab)}
            >
              {tab.favicon ? (
                <img
                  className={styles.favicon}
                  src={tab.favicon}
                  alt=""
                  onError={(e) => {
                    ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <Globe className={styles.globe} size={13} />
              )}
              <span className={styles.tabLabel}>{labelFor(tab)}</span>
              <button
                type="button"
                className={styles.tabClose}
                title="Close tab"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        }).flatMap((el) => {
          // Group headers are collected as tabs are walked, then spliced in at
          // the position of their first member.
          const out = rendered.splice(0, rendered.length)
          return el ? [...out, el] : out
        })}
      </div>
      <button type="button" className={styles.newBtn} title="New tab" aria-label="New tab" onClick={onNew}>
        <Plus size={16} />
      </button>
    </div>
  )
}
