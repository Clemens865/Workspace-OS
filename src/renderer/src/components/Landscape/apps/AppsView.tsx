import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Download, FolderOpen, MessageCircle, Plus, Upload } from 'lucide-react'
import type { WosApp, WosAppManifest } from '../../../types/workspace-api'
import { useWorkspaceRoot } from '../../../hooks/useWorkspaceRoot'
import { useGlass } from '../backdrop/useBackdrop'
import { toast } from '../toastStore'
import { AppHost } from './AppHost'
import styles from './AppsView.module.css'

const when = (t: number): string => {
  if (!t) return ''
  const days = Math.floor((Date.now() - t) / 86_400_000)
  return days <= 0 ? 'Changed today' : days === 1 ? 'Changed yesterday' : `Changed ${days} days ago`
}
const reason = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'That did not work')

function Icon({ icon }: { icon: string }): JSX.Element {
  return <span className={styles.icon}>{icon}</span>
}

interface Props {
  /** Build or change an app in Chat, with its live preview. Null: a new app. */
  onBuild: (slug: string | null) => void
  /** Open this app (from elsewhere: the builder's "Open"). */
  initialApp?: string | null
}

/**
 * Apps (the dock's third item): the small tools the person made in Workspace
 * OS, or added from the gallery, each a folder in Apps/. A card opens the app
 * full size; "Edit with chat" changes it with the builder.
 */
export function AppsView({ onBuild, initialApp = null }: Props): JSX.Element {
  const root = useWorkspaceRoot()
  const panel = useRef<HTMLDivElement>(null)
  useGlass(panel, { radius: 26, bezel: 24, thickness: 46, frost: 0.82 })
  const [list, setList] = useState<WosApp[] | null>(null)
  const [gallery, setGallery] = useState<(WosAppManifest & { added: boolean })[]>([])
  const [open, setOpen] = useState<string | null>(initialApp)

  const load = useCallback(async () => {
    const [a, t] = await Promise.all([window.workspace.apps.list(), window.workspace.apps.templates()]).catch(() => [[], []] as [WosApp[], (WosAppManifest & { added: boolean })[]])
    setList(a)
    setGallery(t)
  }, [])
  useEffect(() => {
    void load()
  }, [load, root])

  const add = async (id: string): Promise<void> => {
    try {
      const slug = await window.workspace.apps.install(id)
      await load()
      setOpen(slug)
    } catch (e) {
      toast(reason(e))
    }
  }
  const duplicate = async (slug: string): Promise<void> => {
    try {
      const copy = await window.workspace.apps.duplicate(slug)
      await load()
      setOpen(copy)
      toast('Duplicated. This copy is yours to change.')
    } catch (e) {
      toast(reason(e))
    }
  }

  const exportApp = async (slug: string): Promise<void> => {
    try {
      const name = await window.workspace.apps.export(slug)
      if (name) toast(`Saved as ${name}. It holds the app, not its data.`)
    } catch (e) {
      toast(reason(e))
    }
  }
  // Import: the file is read and checked first; the person sees what it may do, then adds it.
  const [offer, setOffer] = useState<{ token: string; manifest: WosAppManifest; files: number } | null>(null)
  const pickImport = async (): Promise<void> => {
    try {
      const o = await window.workspace.apps.importPick()
      if (o) setOffer(o)
    } catch (e) {
      toast(reason(e))
    }
  }
  const confirmImport = async (): Promise<void> => {
    if (!offer) return
    try {
      const slug = await window.workspace.apps.importConfirm(offer.token)
      setOffer(null)
      await load()
      setOpen(slug)
    } catch (e) {
      toast(reason(e))
    }
  }
  const asks = (m: WosAppManifest): string => {
    const p = [m.permissions.includes('ai') && 'use AI', m.permissions.includes('ai.web') && 'look things up on the web'].filter(Boolean)
    return p.length ? `It may ${p.join(' and ')}, and keep its own data.` : 'It asks for nothing beyond keeping its own data.'
  }

  const current = list?.find((a) => a.slug === open)

  if (!root) {
    return (
      <div className={styles.apps}>
        <div ref={panel} className={styles.panel}>
          <p className={styles.quiet}>No folder is open. Apps live in a workspace: choose one from the project menu at the top right.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.apps} data-testid="apps-view">
      <div ref={panel} className={`${styles.panel} ${open ? styles.running : ''}`}>
        {open ? (
          <>
            <div className={styles.bar}>
              <button type="button" className={styles.ghost} onClick={() => setOpen(null)} data-testid="apps-back">
                <ArrowLeft size={14} /> All apps
              </button>
              <span className={styles.runName}>
                {current && <Icon icon={current.icon} />} {current?.name ?? open}
              </span>
              <button type="button" className={styles.ghost} onClick={() => onBuild(open)} data-testid="apps-edit">
                <MessageCircle size={14} /> Edit with chat
              </button>
              <button type="button" className={styles.ghost} onClick={() => void duplicate(open)} data-testid="apps-duplicate">
                <Copy size={14} /> Duplicate
              </button>
              <button type="button" className={styles.ghost} onClick={() => void exportApp(open)} title="Save it as a file to share (without its data)" data-testid="apps-export">
                <Upload size={14} /> Export
              </button>
              <button type="button" className={styles.ghost} onClick={() => void window.workspace.apps.reveal(open)} title="Show its folder in Finder">
                <FolderOpen size={14} />
              </button>
            </div>
            <div className={styles.stage}>
              <AppHost slug={open} />
            </div>
          </>
        ) : (
          <div className={styles.scroll}>
            <div className={styles.head}>
              <p className={styles.count}>{list === null ? 'Reading your apps…' : list.length ? `${list.length} app${list.length === 1 ? '' : 's'} in this workspace` : 'Your apps'}</p>
              <button type="button" className={styles.ghost} onClick={() => void pickImport()} title="Add an app from a .wosapp file" data-testid="apps-import">
                <Download size={14} /> Import…
              </button>
              <button type="button" className={styles.primary} onClick={() => onBuild(null)} data-testid="apps-new">
                <Plus size={15} /> New app
              </button>
            </div>
            {offer && (
              <div className={styles.offer} data-testid="apps-import-offer">
                <Icon icon={offer.manifest.icon} />
                <div className={styles.offerText}>
                  <span className={styles.cardName}>Add “{offer.manifest.name}”?</span>
                  <span className={styles.cardText}>
                    {offer.manifest.description ? `${offer.manifest.description} ` : ''}
                    {asks(offer.manifest)} Like every app, it runs sandboxed: no network, no access to your files beyond the ones you pick.
                  </span>
                </div>
                <button type="button" className={styles.ghost} onClick={() => setOffer(null)}>
                  Cancel
                </button>
                <button type="button" className={styles.primary} onClick={() => void confirmImport()} data-testid="apps-import-confirm">
                  Add it
                </button>
              </div>
            )}
            <div className={styles.grid} data-testid="apps-grid">
              {(list ?? []).map((a) => (
                <button key={a.slug} type="button" className={styles.card} onClick={() => setOpen(a.slug)} data-app-card={a.slug}>
                  <Icon icon={a.icon} />
                  <span className={styles.cardName}>{a.name}</span>
                  <span className={styles.cardText}>{a.description || 'No description yet.'}</span>
                  <span className={styles.cardWhen}>{when(a.updatedAt)}</span>
                </button>
              ))}
              <button type="button" className={`${styles.card} ${styles.newCard}`} onClick={() => onBuild(null)}>
                <span className={styles.plus}>
                  <Plus size={20} />
                </span>
                <span className={styles.cardName}>Describe a new app</span>
                <span className={styles.cardText}>Say what it should do; it is built in front of you, in the Workspace OS look.</span>
              </button>
            </div>

            {gallery.some((t) => !t.added) && (
              <section className={styles.shelf}>
                <h3 className={styles.label}>Add from the gallery</h3>
                <div className={styles.grid}>
                  {gallery
                    .filter((t) => !t.added)
                    .map((t) => (
                      <div key={t.slug} className={`${styles.card} ${styles.templateCard}`} data-template={t.slug}>
                        <Icon icon={t.icon} />
                        <span className={styles.cardName}>{t.name}</span>
                        <span className={styles.cardText}>{t.description}</span>
                        <button type="button" className={styles.addBtn} onClick={() => void add(t.slug)} data-testid={`apps-add-${t.slug}`}>
                          <Plus size={13} /> Add
                        </button>
                      </div>
                    ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
