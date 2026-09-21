import type { Component } from '../../../types/workspace-api'

interface Prim {
  kind: string
  x: number; y: number; w: number; h: number
  fill: number; line: number; lineWidth: number; cornerRadius: number
  fontColor: number; text: string
  fillKind?: Component['fillKind']; gradTo?: number
}

const hex = (v: number): string => (v < 0 ? 'none' : '#' + (v >>> 0).toString(16).padStart(6, '0').slice(-6))

/** Convert a (possibly partial) component definition into preview primitives. */
function toPrims(c: Partial<Component>): { prims: Prim[]; w: number; h: number } {
  const w = c.w ?? 7000, h = c.h ?? 4500
  const base = (k: string, x: number, y: number, pw: number, ph: number, extra: Partial<Prim> = {}): Prim => ({
    kind: k, x, y, w: pw, h: ph, fill: -1, line: -1, lineWidth: 0, cornerRadius: 0, fontColor: 0, text: '', ...extra,
  })
  if (c.type === 'card') {
    return { w, h, prims: [
      base('roundrect', 0, 0, w, h, { fill: c.fill ?? 5806300, line: 2050940, cornerRadius: 600 }),
      base('text', 600, h / 2 - 900, w - 1200, 1800, { text: c.text || 'Title', fontColor: c.fontColor ?? 16777215 }),
    ] }
  }
  if (c.type === 'media') {
    const capH = 1800
    return { w, h, prims: [
      base('roundrect', 0, 0, w, h, { fill: c.fill ?? 15132390, cornerRadius: 400 }),
      base('image', 300, 300, w - 600, h - capH - 600, { fill: 13816028 }),
      base('text', 300, h - capH, w - 600, capH, { text: c.text || 'Caption', fontColor: c.fontColor ?? 0 }),
    ] }
  }
  if (c.type === 'range') {
    const cw = 4000, ch = 1600, rk = c.rangeKind || 'kpi', fill = c.fill ?? 1810836
    if (rk === 'kpi') {
      return { w: cw, h: ch * 2, prims: [
        base('rect', 0, 0, cw, ch, { fill, line: -1, text: c.text || 'Label', fontColor: 16777215 }),
        base('rect', 0, ch, cw, ch, { fill: 16777215, line: 13816028, text: c.body || '42', fontColor: 0 }),
      ] }
    }
    if (rk === 'header') {
      return { w: cw * 3, h: ch, prims: [0, 1, 2].map((i) => base('rect', i * cw, 0, cw, ch, { fill, line: 16777215, text: i === 0 ? (c.text || 'Title') : '', fontColor: 16777215 })) }
    }
    const prims: Prim[] = []
    for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) prims.push(base('rect', col * cw, r * ch, cw, ch, { fill: r === 0 ? fill : 16777215, line: 13816028, text: r === 0 && col === 0 ? (c.text || 'Title') : '', fontColor: r === 0 ? 16777215 : 0 }))
    return { w: cw * 3, h: ch * 3, prims }
  }
  if (c.type === 'block') {
    const W = 16000, H = 6000, bk = c.blockKind || 'heading'
    if (bk === 'callout') {
      return { w: W, h: H, prims: [
        base('roundrect', 0, 0, W, H, { fill: c.fill ?? 15658734, line: -1, cornerRadius: 300 }),
        base('text', 600, 700, W - 1200, 1600, { text: c.text || 'Note', fontColor: 0 }),
        base('text', 600, 2900, W - 1200, 2400, { text: c.body || 'Callout text', fontColor: 4210752 }),
      ] }
    }
    if (bk === 'quote') {
      return { w: W, h: H, prims: [
        base('text', 1400, 700, W - 2000, 2200, { text: '“' + (c.body || 'Quote') + '”', fontColor: 4210752 }),
        base('text', 1400, 3600, W - 2000, 1400, { text: '— ' + (c.text || 'Author'), fontColor: 8421504 }),
      ] }
    }
    return { w: W, h: H, prims: [
      base('text', 300, 600, W - 600, 2200, { text: c.text || (bk === 'signature' ? 'Name' : 'Heading'), fontColor: 0 }),
      base('text', 300, 3300, W - 600, 2000, { text: c.body || (bk === 'signature' ? 'Title / role' : 'Body text'), fontColor: 4210752 }),
    ] }
  }
  if (c.type === 'captured' && c.elements) {
    const prims = c.elements.map((ln) => {
      const p = ln.split('|')
      return base(p[0], +p[1] || 0, +p[2] || 0, +p[3] || 0, +p[4] || 0, {
        fill: +p[5], line: +p[6], lineWidth: +p[7] || 0, cornerRadius: +p[8] || 0, fontColor: +p[9] || 0, text: p.slice(10).join('|'),
      })
    })
    return { w, h, prims }
  }
  // single shape
  return { w, h, prims: [
    base(c.base ?? 'rect', 0, 0, w, h, {
      fill: c.fill ?? 5806300, line: c.line ?? -1, lineWidth: c.lineWidth ?? 0, cornerRadius: c.base === 'roundrect' ? 900 : 0,
      text: c.text ?? '', fontColor: c.fontColor ?? 0, fillKind: c.fillKind, gradTo: c.gradTo,
    }),
  ] }
}

/** Lightweight SVG preview of a component definition (no engine round-trip). */
export function ComponentPreview({ comp, width = 206, height = 116 }: { comp: Partial<Component>; width?: number; height?: number }): React.JSX.Element {
  const { prims, w, h } = toPrims(comp)
  const pad = 8
  const s = Math.min((width - pad * 2) / Math.max(1, w), (height - pad * 2) / Math.max(1, h))
  const ox = (width - w * s) / 2, oy = (height - h * s) / 2
  return (
    <svg width={width} height={height} style={{ display: 'block', background: 'repeating-conic-gradient(#eee 0 25%, #fafafa 0 50%) 50% / 14px 14px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
      <defs>
        {prims.map((p, i) => p.fillKind === 'gradient' ? (
          <linearGradient key={i} id={`g${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={hex(p.fill)} /><stop offset="100%" stopColor={hex(p.gradTo ?? p.fill)} />
          </linearGradient>
        ) : p.fillKind === 'pattern' ? (
          <pattern key={i} id={`p${i}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={hex(p.fill)} /><line x1="0" y1="0" x2="0" y2="6" stroke={hex(p.line)} strokeWidth="1" />
          </pattern>
        ) : null)}
      </defs>
      {prims.map((p, i) => {
        const x = ox + p.x * s, y = oy + p.y * s, pw = p.w * s, ph = p.h * s
        const fill = p.fillKind === 'gradient' ? `url(#g${i})` : p.fillKind === 'pattern' ? `url(#p${i})` : hex(p.fill)
        const stroke = p.line < 0 ? 'none' : hex(p.line)
        const sw = Math.max(p.lineWidth > 0 ? p.lineWidth * s * 0.04 : (p.line >= 0 ? 1 : 0), 0)
        if (p.kind === 'ellipse') return <ellipse key={i} cx={x + pw / 2} cy={y + ph / 2} rx={pw / 2} ry={ph / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
        if (p.kind === 'line') return <line key={i} x1={x} y1={y + ph} x2={x + pw} y2={y} stroke={p.line >= 0 ? hex(p.line) : '#444'} strokeWidth={Math.max(sw, 1)} />
        if (p.kind === 'text') return <text key={i} x={x + pw / 2} y={y + ph / 2} fontSize={Math.max(7, Math.min(13, ph * 0.5))} fill={hex(p.fontColor)} textAnchor="middle" dominantBaseline="middle">{p.text || ''}</text>
        if (p.kind === 'image') return <g key={i}><rect x={x} y={y} width={pw} height={ph} fill={hex(p.fill < 0 ? 13816028 : p.fill)} /><text x={x + pw / 2} y={y + ph / 2} fontSize="11" fill="#888" textAnchor="middle" dominantBaseline="middle">🖼</text></g>
        const r = p.cornerRadius > 0 ? Math.min(p.cornerRadius * s, pw / 2, ph / 2) : 0
        return <g key={i}><rect x={x} y={y} width={pw} height={ph} rx={r} ry={r} fill={fill} stroke={stroke} strokeWidth={sw} />{p.text ? <text x={x + pw / 2} y={y + ph / 2} fontSize={Math.max(7, Math.min(13, ph * 0.4))} fill={hex(p.fontColor)} textAnchor="middle" dominantBaseline="middle">{p.text}</text> : null}</g>
      })}
    </svg>
  )
}
