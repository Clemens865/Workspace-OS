import { useMemo } from 'react'
import { createAvatar } from '@dicebear/core'
import { notionists } from '@dicebear/collection'

/**
 * A PURE, deterministic illustrated FACE for an agent, derived only from its
 * name (the seed). Same seed → identical face, always — no randomness, no
 * network. Faces are generated LOCALLY by DiceBear (the `notionists` style: a
 * calm, hand-drawn, editorial line-art person that fits a professional,
 * Apple-like B2B surface). We import ONLY that one style so the bundle stays
 * lean (the collection is tree-shakeable per-style).
 *
 * Rendering: we take the SVG as a data-URI and paint it in an <img>. This is
 * the bulletproof route — a prior inline-SVG-with-gradient avatar measured 0×0
 * in the live app, so we deliberately avoid inlining SVG here. The face sits on
 * a soft rounded squircle (border-radius:30%) with a very light neutral
 * background so it rests calmly on the white card.
 *
 * Exported helpers are pure so the determinism can be unit-tested directly.
 */

export interface AgentAvatarProps {
  /** Seed string — the agent name. */
  seed: string
  /** Rendered diameter in px. Default 44. */
  size?: number
  className?: string
}

/** Stable 32-bit FNV-1a hash. Deterministic across runs and platforms. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Fold to an unsigned 32-bit int.
  return h >>> 0
}

/** Initials: first letters of up to two words, else first two chars. */
export function monogram(seed: string): string {
  const words = seed.trim().split(/[\s\-_]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * The illustrated face for a seed as an `<img>`-ready data-URI. Pure and fully
 * deterministic: same seed → byte-identical URI, always, and rendered entirely
 * offline by DiceBear (no HTTP API). Unit-tested for determinism + uniqueness.
 *
 * `size` is baked into the SVG so the raster is crisp at the display diameter.
 */
export function faceDataUri(seed: string, size = 44): string {
  return createAvatar(notionists, {
    seed,
    size,
    // Deterministic, calm framing — no per-render randomness anywhere.
    radius: 0,
    backgroundColor: ['transparent']
  }).toDataUri()
}

/**
 * The deterministic agent avatar. A sized squircle `<div>` with a very light
 * neutral background, holding the DiceBear face as an `<img>`. Same seed →
 * identical avatar. Public API is unchanged: `<AgentAvatar seed size />`.
 */
export function AgentAvatar({ seed, size = 44, className }: AgentAvatarProps): JSX.Element {
  const src = useMemo(() => faceDataUri(seed, size), [seed, size])
  return (
    <div
      className={className}
      role="img"
      aria-label={`${seed} avatar`}
      data-testid="agent-avatar"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '30%',
        overflow: 'hidden',
        // Soft, calm container — a light sunk tint so the face sits quietly on
        // the white card, with a hairline edge to define the squircle.
        background: 'var(--wos-sunk, #f2f3f5)',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)',
        userSelect: 'none'
      }}
    >
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={size}
        height={size}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </div>
  )
}
