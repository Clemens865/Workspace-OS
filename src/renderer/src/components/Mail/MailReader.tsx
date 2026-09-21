import { useMemo, useState, useEffect, useCallback } from 'react'
import { Paperclip, ShieldAlert, Reply, ReplyAll, Forward, Download, ImageIcon, Printer, Code2 } from 'lucide-react'
import type { FullMessage, MailCategory } from '../../types/workspace-api'
import styles from './MailPanel.module.css'

interface MailReaderProps {
  message: FullMessage
  /** Draft a reply from a STANCE — the agent writes from your intent. */
  onQuickReply?: (stance: 'positive' | 'neutral' | 'negative') => void
  /** Opens Compose pre-filled for reply / reply-all / forward. */
  onReply?: (mode: 'reply' | 'replyAll' | 'forward') => void
  /** Where this message lives — needed to fetch attachment bytes on demand. */
  accountId?: string
  folder?: string
}

function fmtAddr(list: { name: string; address: string }[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Reader pane. HTML is already sanitized in the main process; here we render it
 * inside a SANDBOXED iframe with a restrictive CSP so — even if something slipped
 * the sanitizer — no script runs and no network request (remote images, beacons)
 * can be issued. `sandbox` has no allow-scripts / allow-same-origin, and the CSP
 * blocks every remote source. Plaintext is shown when there is no HTML.
 */
export function MailReader({ message, onReply, onQuickReply, accountId, folder }: MailReaderProps): JSX.Element {
  // Opt-in per message, and reset whenever a different message is opened —
  // consenting to load one sender's images must never silently apply to the
  // next one.
  const [showRemote, setShowRemote] = useState(false)
  const [raw, setRaw] = useState<string | null>(null)
  /** Original URL → data: URI, filled by main when the user opts in. */
  const [remoteImages, setRemoteImages] = useState<Record<string, string>>({})
  const [loadingImages, setLoadingImages] = useState(false)
  /**
   * What the app decided this message is, and why.
   *
   * Shown rather than acted on silently. A classifier the person cannot see is
   * one they cannot correct, and the correction is the whole point of the
   * rules — the moment you notice the mistake is the moment you can fix it,
   * and that moment is here, reading the message, not later in a settings
   * panel you would have to remember to open.
   */
  const [verdict, setVerdict] = useState<{ category: MailCategory; reason: string; ruleId?: string } | null>(null)
  const [ruleSaved, setRuleSaved] = useState<string | null>(null)
  useEffect(() => {
    setShowRemote(false)
    setRaw(null)
    setRemoteImages({})
    setLoadingImages(false)
    setVerdict(null)
    setRuleSaved(null)
    if (accountId && folder) {
      void window.workspace.mail
        .classify(accountId, folder, message.uid)
        .then((r) => setVerdict(r.ok ? r.value : null))
        .catch(() => setVerdict(null))
    }
  }, [message.uid, message.messageId, accountId, folder])

  /**
   * "This is not a newsletter" → a rule, from this sender's domain.
   *
   * The domain rather than the exact address, because a service that got it
   * wrong once will send from `noreply@`, `notifications@` and `builds@` and
   * the person should not have to correct each of them separately.
   */
  const correctTo = useCallback(
    async (category: MailCategory) => {
      const addr = message.from[0]?.address ?? ''
      const domain = addr.slice(addr.lastIndexOf('@') + 1)
      if (!domain) return
      await window.workspace.mail.rules.add({ domain, category })
      setVerdict({ category, reason: `your rule: from ${domain} → ${category}` })
      setRuleSaved(`Mail from ${domain} will be treated as ${category} from now on.`)
    },
    [message.from],
  )

  /**
   * Collects the URLs the sanitizer parked and asks main to fetch them.
   *
   * Reading them off the HTML rather than threading a list through the parse
   * keeps the two in step: whatever the sanitizer blocked is exactly what gets
   * requested, so a change to one cannot silently desync the other.
   */
  const loadRemote = useCallback(async () => {
    setLoadingImages(true)
    try {
      const urls = Array.from(
        (message.html ?? '').matchAll(/\sdata-blocked-(?:src|srcset|background|poster)\s*=\s*("|')([^"']*)\1/gi),
      ).map((m) => m[2])
      const res = await window.workspace.mail.remoteImages(urls)
      if (res.ok) setRemoteImages(res.value.images)
      // A failure here still flips to the loaded state: the banner has served
      // its purpose, and leaving it up implies another click would help.
      setShowRemote(true)
    } finally {
      setLoadingImages(false)
    }
  }, [message.html])

  const srcDoc = useMemo(() => {
    /**
     * `img-src data:` in BOTH states, and that is not an oversight.
     *
     * This is a srcdoc document, so it inherits the app-wide CSP and the two
     * compose by intersection — an inner policy can only narrow what it
     * inherits, never widen it. The app policy has no `https:`, so the previous
     * opt-in policy here (`img-src data: https:`) was silently reduced to
     * `data:` and every promoted URL was refused. The button looked wired and
     * could never have worked.
     *
     * Remote images are now fetched in MAIN and arrive as data: URIs, which
     * this policy already permits. That keeps the app-wide policy untouched and
     * tells the sender less than a direct load would: no cookies, no referrer.
     */
    const csp =
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:;"

    let rendered = message.html
    if (showRemote && rendered) {
      // Promote the URLs the sanitizer parked in data-blocked-*, substituting
      // the bytes main fetched. A URL with no entry (blocked host, wrong
      // content type, too large, dead server) stays inert rather than becoming
      // a live request the iframe cannot make anyway.
      rendered = rendered.replace(
        /\sdata-blocked-(src|srcset|background|poster)\s*=\s*("|')([^"']*)\2/gi,
        (whole, attr: string, quote: string, url: string) => {
          const data = remoteImages[url]
          if (!data) return whole
          return ` ${attr.toLowerCase()}=${quote}${data}${quote}`
        },
      )
    }

    const body = rendered
      ? rendered
      : `<pre style="white-space:pre-wrap;word-wrap:break-word;font-family:inherit;margin:0">${escapeHtml(message.text)}</pre>`
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;padding:12px;color:#222;background:#fff;font:14px/1.5 -apple-system,system-ui,sans-serif}a{color:#2a6df4}img{max-width:100%}</style></head><body>${body}</body></html>`
  }, [message.html, message.text, showRemote, remoteImages])

  return (
    <div className={styles.reader}>
      <div className={styles.readerHeader}>
        <div className={styles.readerSubject}>{message.subject || '(no subject)'}</div>
        <div className={styles.readerMeta}>
          <div><span className={styles.metaKey}>From</span> {fmtAddr(message.from)}</div>
          <div><span className={styles.metaKey}>To</span> {fmtAddr(message.to)}</div>
          {message.cc.length > 0 && <div><span className={styles.metaKey}>Cc</span> {fmtAddr(message.cc)}</div>}
          <div className={styles.metaDate}>{fmtDate(message.date)}</div>
        </div>

        {verdict && (
          <div className={styles.verdict}>
            <span className={`${styles.verdictTag} ${styles[`verdict_${verdict.category}`] ?? ''}`}>
              {verdict.category}
            </span>
            <span className={styles.verdictWhy}>{verdict.reason}</span>
            {/* One button, offering the correction the verdict makes likely. */}
            {verdict.category === 'newsletter' && (
              <button className={styles.verdictFix} onClick={() => void correctTo('notification')}>
                Not a newsletter
              </button>
            )}
            {verdict.category === 'notification' && (
              <button className={styles.verdictFix} onClick={() => void correctTo('newsletter')}>
                It is a newsletter
              </button>
            )}
            {verdict.category === 'personal' && (
              <button className={styles.verdictFix} onClick={() => void correctTo('newsletter')}>
                It is a newsletter
              </button>
            )}
          </div>
        )}
        {ruleSaved && <div className={styles.verdictSaved}>{ruleSaved}</div>}
        {onReply && (
          <div className={styles.replyActions}>
            <button
              className={styles.replyBtn}
              onClick={() => void window.workspace.mail.exportPdf(
                message.html || `<pre>${escapeHtml(message.text)}</pre>`,
                message.subject || 'message',
              )}
              title="Save this message as a PDF"
            >
              <Printer size={13} /> PDF
            </button>
            {accountId && folder && (
              <button
                className={styles.replyBtn}
                onClick={async () => {
                  if (raw !== null) { setRaw(null); return }
                  const res = await window.workspace.mail.rawSource(accountId, folder, message.uid)
                  setRaw(res.ok ? res.value : 'Could not load the original source.')
                }}
                title="Show the raw RFC822 source"
              >
                <Code2 size={13} /> {raw !== null ? 'Hide source' : 'Source'}
              </button>
            )}
            <button className={styles.replyBtn} onClick={() => onReply('reply')}><Reply size={13} /> Reply</button>
            <button className={styles.replyBtn} onClick={() => onReply('replyAll')}><ReplyAll size={13} /> Reply all</button>
            <button className={styles.replyBtn} onClick={() => onReply('forward')}><Forward size={13} /> Forward</button>
          </div>
        )}
        {onQuickReply && (
          <div className={styles.quickReplies}>
            {/* A stance, not a canned sentence. You supply the one thing only
                you know — yes, acknowledge, or no — and the agent writes from
                that intent. It produces a DRAFT; approve-before-send is
                unchanged. */}
            <span className={styles.quickLabel}>Quick reply</span>
            <button className={styles.quickYes} onClick={() => onQuickReply('positive')} title="Agree, accept, or confirm you will do it">
              Yes
            </button>
            <button className={styles.quickNeutral} onClick={() => onQuickReply('neutral')} title="Received and understood, without committing yet">
              Acknowledge
            </button>
            <button className={styles.quickNo} onClick={() => onQuickReply('negative')} title="Say no, or that you cannot do it">
              Decline
            </button>
          </div>
        )}

        {message.hasBlockedRemoteContent && !showRemote && (
          <div className={styles.blockedNotice}>
            <ShieldAlert size={13} />
            <span>Remote images were blocked — loading them tells the sender you opened this.</span>
            <button className={styles.loadImages} onClick={() => void loadRemote()} disabled={loadingImages}>
              <ImageIcon size={12} /> {loadingImages ? 'Loading…' : 'Load images'}
            </button>
          </div>
        )}
        {message.attachments.length > 0 && (
          <div className={styles.attachments}>
            {/* Click opens with the OS default app; the download icon saves.
                Bytes are fetched on demand — the reader never carries them. */}
            {message.attachments.map((a, i) => {
              const ready = Boolean(accountId && folder)
              return (
                <span key={i} className={styles.attachment} title={a.contentType}>
                  <button
                    className={styles.attOpen}
                    disabled={!ready}
                    onClick={() => ready && void window.workspace.mail.openAttachment(accountId!, folder!, message.uid, i)}
                    title={ready ? `Open ${a.filename}` : 'Open'}
                  >
                    <Paperclip size={12} /> {a.filename}
                    <span className={styles.attSize}>{fmtBytes(a.size)}</span>
                  </button>
                  <button
                    className={styles.attSave}
                    disabled={!ready}
                    onClick={() => ready && void window.workspace.mail.saveAttachment(accountId!, folder!, message.uid, i)}
                    title={`Save ${a.filename}`}
                  >
                    <Download size={12} />
                  </button>
                </span>
              )
            })}
          </div>
        )}
      </div>
      {raw !== null ? (
        <pre className={styles.rawSource}>{raw}</pre>
      ) : (
      <iframe
        className={styles.readerFrame}
        title="Message body"
        // allow-popups ONLY. No allow-scripts, so nothing in the message can
        // run — a popup can therefore only originate from a real click on a
        // real link. The main process denies the actual window and routes the
        // url into an in-app browser tab.
        sandbox="allow-popups"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
      />
      )}
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
