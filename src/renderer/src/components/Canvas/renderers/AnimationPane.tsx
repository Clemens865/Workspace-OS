import { ArrowDown, ArrowUp, Sparkles, Trash2, X } from 'lucide-react'
import { CLASS_LABEL, NODE_TYPES, presetLabel, type AnimEffect } from './animationModel'
import styles from './AnimationPane.module.css'

interface Props {
  effects: AnimEffect[]
  /** Runs one WosAnim op ('remove|i', 'order|…', 'timing|i|dur|delay', 'clear'). */
  onOp: (op: string) => void
  onMove: (from: number, to: number) => void
  onTrigger: (index: number, nodeType: number) => void
  onClose: () => void
}

/**
 * The Animation pane: the current slide's effect sequence in play order.
 * Reorder with the arrows, change the trigger, duration and delay in place,
 * remove one or clear all. The list is the engine's own main sequence read
 * back after every change, so what is shown is what the file will carry.
 */
export function AnimationPane({ effects, onOp, onMove, onTrigger, onClose }: Props): JSX.Element {
  return (
    <div className={styles.panel} data-testid="animation-pane">
      <div className={styles.head}>
        <span><Sparkles size={14} strokeWidth={2.2} /> Animation</span>
        <button className={styles.x} title="Close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className={styles.list}>
        {effects.length === 0 && <div className={styles.empty}>No animations on this slide. Select a shape and pick an effect on the Animations tab.</div>}
        {effects.map((e, i) => (
          <div key={`${i}-${e.presetId}`} className={styles.row} data-testid="animation-row">
            <div className={styles.rowHead}>
              <span className={styles.num}>{i + 1}</span>
              <span className={styles.name} title={e.presetId}>{presetLabel(e.presetId)}</span>
              <span className={styles.cls}>{CLASS_LABEL[e.presetClass] ?? ''}</span>
              <span className={styles.spacer} />
              <button className={styles.icon} title="Move up" disabled={i === 0} onClick={() => onMove(i, i - 1)}><ArrowUp size={13} /></button>
              <button className={styles.icon} title="Move down" disabled={i >= effects.length - 1} onClick={() => onMove(i, i + 1)}><ArrowDown size={13} /></button>
              <button className={styles.icon} title="Remove" data-testid="animation-remove" onClick={() => onOp(`remove|${i}`)}><Trash2 size={13} /></button>
            </div>
            <div className={styles.shape}>{e.shape || 'Shape'}</div>
            <div className={styles.controls}>
              <select className={styles.select} value={e.nodeType} title="Start" onChange={(ev) => onTrigger(i, Number(ev.target.value))}>
                {NODE_TYPES.map(([n, label]) => <option key={n} value={n}>{label}</option>)}
              </select>
              <label className={styles.field} title="Duration (seconds)">
                <span>Dur.</span>
                <input type="number" min={0.1} max={30} step={0.25} defaultValue={e.duration.toFixed(2)} key={`d${e.duration}`}
                  onBlur={(ev) => { const v = Number(ev.target.value); if (v > 0 && Math.abs(v - e.duration) > 0.001) onOp(`timing|${i}|${v}|${e.delay}`) }} />
              </label>
              <label className={styles.field} title="Delay before it starts (seconds)">
                <span>Delay</span>
                <input type="number" min={0} max={60} step={0.25} defaultValue={e.delay.toFixed(2)} key={`b${e.delay}`}
                  onBlur={(ev) => { const v = Number(ev.target.value); if (v >= 0 && Math.abs(v - e.delay) > 0.001) onOp(`timing|${i}|${e.duration}|${v}`) }} />
              </label>
            </div>
          </div>
        ))}
      </div>
      {effects.length > 0 && (
        <div className={styles.foot}>
          <button className={styles.clear} onClick={() => onOp('clear')}>Remove all</button>
        </div>
      )}
    </div>
  )
}
