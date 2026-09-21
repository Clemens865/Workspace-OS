/**
 * MOCK data for the Calm Cockpit design prototype.
 *
 * TEAM-LEAD altitude: ~16 agents/tasks in flight. This is realistic-feeling
 * fiction — NOT wired to any live source. Everything the cockpit renders comes
 * from here so the surface can be judged as a design, not a stub.
 */

/** A confidence dot's health — drives colour-temperature, never a loud badge. */
export type Health = 'healthy' | 'watch' | 'blocked' | 'done'

/** Which lens a thing groups under. The Prism re-groups the SAME items. */
export interface Grouping {
  team: string
  type: string
  project: string
  urgency: string
}

/** A "needs-you" — a self-contained decision the human resolves in one gesture. */
export interface Decision {
  id: string
  /** Smart-Brevity line: what changed + why it matters. */
  line: string
  /** The categorical LABEL — mirrors the LIVE cockpit's chip for consistency. */
  category?: import('./cockpitModel').LabelCategory
  /** The agent/team that produced it. */
  by: string
  /** Optional confidence note shown as a quiet warm chip ("Analyst 0.6 sure"). */
  confidence?: string
  /** The leaned default. THE single blue action per item. */
  primary: string
  /** The quiet alternative(s). */
  secondary: string[]
  /** Detail revealed on ⌄. */
  detail: string
  group: Grouping
}

/** A live agent as a "presence cell" — small, breathing, glanceable. */
export interface Presence {
  id: string
  /** Agent or team name. */
  who: string
  /** One live line: "reading 5 rivals · 3/5". */
  live: string
  health: Health
  /** 0..1 confidence → dot temperature. */
  confidence: number
  /** Tiny running cost, e.g. "$0.12". */
  cost: string
  group: Grouping
}

/** A settled result. Quiet, past-tense, one → open affordance. */
export interface Landed {
  id: string
  line: string
  kind: 'deck' | 'xlsx' | 'docx' | 'email' | 'note'
  group: Grouping
}

export interface CockpitData {
  /** One plain-language status line for the whole board. */
  status: string
  decisions: Decision[]
  working: Presence[]
  landed: Landed[]
  /** How many landed items are folded away. */
  landedMore: number
}

export const MOCK: CockpitData = {
  status: 'Calm. 16 of 18 tasks are healthy and moving. ~4 min needs you.',

  decisions: [
    {
      id: 'd1',
      line: 'The reply to Acme is drafted and reads well — send it, or tweak first.',
      category: 'SEND',
      by: 'Mailer',
      primary: 'Approve & send',
      secondary: ['Edit', 'Later'],
      detail:
        'Acme asked to move the renewal call to Thursday. Draft confirms 2pm CET, keeps the agenda, and offers a reschedule link. Tone matches your last three replies.',
      group: { team: 'Growth', type: 'Email', project: 'Acme renewal', urgency: 'Now' }
    },
    {
      id: 'd2',
      line: 'Q3 forecast dropped 4% after a supplier price change — keep it or revert.',
      category: 'REVIEW',
      by: 'Analyst',
      confidence: 'Analyst 0.6 sure',
      primary: 'Keep',
      secondary: ['Revert', 'See the cells'],
      detail:
        'Row 42 (COGS) rose from €18.20 to €19.95 per unit. Margin model recomputed; the 4% dip is isolated to Q3. Source: supplier email 07-24, medium confidence on the effective date.',
      group: { team: 'Finance', type: 'Spreadsheet', project: 'Q3 forecast', urgency: 'Today' }
    },
    {
      id: 'd3',
      line: 'Research says lead with the pricing slide — approve the new deck order.',
      category: 'DECISION',
      by: 'Planner',
      primary: 'Approve',
      secondary: ['Reject', 'See why'],
      detail:
        'Across 5 competitor decks, price-transparency-first correlated with faster replies. Proposed reorder: Pricing → Proof → Onboarding. Reversible; the old order is saved.',
      group: { team: 'Growth', type: 'Decision', project: 'Pitch deck', urgency: 'Today' }
    }
  ],

  // ~13 live cells — a faint working band. Grouped by the active lens.
  working: [
    { id: 'w1', who: 'Scout', live: 'reading 5 rivals · 3/5', health: 'healthy', confidence: 0.86, cost: '$0.14', group: { team: 'Growth', type: 'Research', project: 'Pitch deck', urgency: 'Steady' } },
    { id: 'w2', who: 'Analyst', live: 'reconciling ledger · 812 rows', health: 'healthy', confidence: 0.9, cost: '$0.21', group: { team: 'Finance', type: 'Spreadsheet', project: 'Q3 forecast', urgency: 'Steady' } },
    { id: 'w3', who: 'Writer', live: 'drafting section 2 of 4', health: 'healthy', confidence: 0.82, cost: '$0.09', group: { team: 'Growth', type: 'Writing', project: 'Case study', urgency: 'Steady' } },
    { id: 'w4', who: 'Mailer', live: 'watching inbox · 2 threads', health: 'healthy', confidence: 0.88, cost: '$0.03', group: { team: 'Growth', type: 'Email', project: 'Acme renewal', urgency: 'Steady' } },
    { id: 'w5', who: 'Indexer', live: 'indexing workspace · 61%', health: 'healthy', confidence: 0.94, cost: '$0.02', group: { team: 'Platform', type: 'Research', project: 'Knowledge base', urgency: 'Background' } },
    { id: 'w6', who: 'Designer', live: 'laying out 12 slides · 7/12', health: 'watch', confidence: 0.64, cost: '$0.18', group: { team: 'Growth', type: 'Design', project: 'Pitch deck', urgency: 'Steady' } },
    { id: 'w7', who: 'Analyst 2', live: 'sizing 3 markets · 1/3', health: 'healthy', confidence: 0.8, cost: '$0.11', group: { team: 'Finance', type: 'Research', project: 'Market sizing', urgency: 'Steady' } },
    { id: 'w8', who: 'Scheduler', live: 'holding 3 calendar slots', health: 'healthy', confidence: 0.91, cost: '$0.01', group: { team: 'Ops', type: 'Scheduling', project: 'Acme renewal', urgency: 'Background' } },
    { id: 'w9', who: 'Reviewer', live: 'checking 40 cells for typos', health: 'healthy', confidence: 0.87, cost: '$0.05', group: { team: 'Finance', type: 'Spreadsheet', project: 'Q3 forecast', urgency: 'Background' } },
    { id: 'w10', who: 'Researcher', live: 'summarizing 9 sources · 6/9', health: 'healthy', confidence: 0.83, cost: '$0.16', group: { team: 'Platform', type: 'Research', project: 'Knowledge base', urgency: 'Steady' } },
    { id: 'w11', who: 'Translator', live: 'localizing deck → DE · 4/12', health: 'watch', confidence: 0.58, cost: '$0.07', group: { team: 'Growth', type: 'Writing', project: 'Pitch deck', urgency: 'Steady' } },
    { id: 'w12', who: 'Cruncher', live: 'rebuilding 3 charts', health: 'healthy', confidence: 0.89, cost: '$0.08', group: { team: 'Finance', type: 'Spreadsheet', project: 'Q3 forecast', urgency: 'Steady' } },
    { id: 'w13', who: 'Watcher', live: 'monitoring 2 rival sites', health: 'healthy', confidence: 0.92, cost: '$0.02', group: { team: 'Growth', type: 'Research', project: 'Market sizing', urgency: 'Background' } }
  ],

  landed: [
    { id: 'l1', line: 'Board deck v3 exported — 14 slides, ready to review.', kind: 'deck', group: { team: 'Growth', type: 'Design', project: 'Pitch deck', urgency: 'Done' } },
    { id: 'l2', line: 'April–June actuals reconciled into the model.', kind: 'xlsx', group: { team: 'Finance', type: 'Spreadsheet', project: 'Q3 forecast', urgency: 'Done' } },
    { id: 'l3', line: 'Onboarding one-pager written and filed.', kind: 'docx', group: { team: 'Growth', type: 'Writing', project: 'Case study', urgency: 'Done' } }
  ],
  landedMore: 4
}

/** The lenses the Prism offers. Each maps an item → its group bucket. */
export const LENSES = ['team', 'type', 'project', 'urgency'] as const
export type Lens = (typeof LENSES)[number]

/** The altitudes. Clicking one FLIES the whole surface to that representation. */
export const ALTITUDES = ['CEO', 'Head-of', 'Team-lead', 'Agent'] as const
export type Altitude = (typeof ALTITUDES)[number]

/* ─────────────────────────────────────────────────────────────────────────
 * ALTITUDE MOCKS — each altitude is its own calm-light view, all obeying
 * hide-the-healthy · language-leads · one-warm-zone. Fiction, not live data.
 * ───────────────────────────────────────────────────────────────────────── */

/** CEO — a company-weather region. Most read calm; one runs warm. */
export interface WeatherRegion {
  id: string
  team: string
  /** One plain-language momentum note. */
  note: string
  /** 'calm' recedes; 'warm' is the single zone that wants attention. */
  tone: 'calm' | 'warm'
}

export interface CeoView {
  status: string
  regions: WeatherRegion[]
  /** ONLY the 1–2 decisions that are the CEO's — warm/forward. */
  decisions: Decision[]
}

export const CEO_VIEW: CeoView = {
  status: 'The company is calm. Five of six areas are moving well. Pricing needs a call.',
  regions: [
    { id: 'r1', team: 'Growth', note: 'Shipping fast · pipeline up 12%', tone: 'calm' },
    { id: 'r2', team: 'Pricing', note: 'Stalled two weeks · burn trending up', tone: 'warm' },
    { id: 'r3', team: 'Finance', note: 'Q3 model reconciled · on plan', tone: 'calm' },
    { id: 'r4', team: 'Product', note: 'Two features in flight · steady', tone: 'calm' },
    { id: 'r5', team: 'Ops', note: 'Quiet · nothing needs you', tone: 'calm' },
    { id: 'r6', team: 'Platform', note: 'Indexing the knowledge base · background', tone: 'calm' }
  ],
  decisions: [
    {
      id: 'c1',
      line: 'Pricing has stalled two weeks and burn is climbing — call it or reset the plan.',
      category: 'DECISION',
      by: 'Head of Pricing',
      confidence: 'Aggregated · 0.7 sure',
      primary: 'Set a reset call',
      secondary: ['See the burn', 'Give it a week'],
      detail:
        'Three pricing experiments are inconclusive; spend is €48k/mo against a €30k target. Two paths: freeze new tests and ship the current tier, or extend one week for the enterprise cohort read.',
      group: { team: 'Pricing', type: 'Decision', project: 'Packaging', urgency: 'Now' }
    }
  ]
}

/** Head-of — one function's flow, staged left→right (a calm river). */
export interface FlowItem {
  id: string
  label: string
  who: string
}

export interface FlowStage {
  id: string
  title: string
  /** The one warm stage — the "your-call" zone. */
  warm?: boolean
  hint: string
  items: FlowItem[]
}

export interface HeadOfView {
  status: string
  fn: string
  stages: FlowStage[]
}

export const HEADOF_VIEW: HeadOfView = {
  status: 'Growth is flowing. Ideas are plentiful, three are in flight, two want your call.',
  fn: 'Growth',
  stages: [
    {
      id: 's1',
      title: 'Ideas',
      hint: '6 forming · low effort',
      items: [
        { id: 'i1', label: 'Referral loop v2', who: 'Scout' },
        { id: 'i2', label: 'Lifecycle emails', who: 'Mailer' },
        { id: 'i3', label: 'Partner co-marketing', who: 'Planner' }
      ]
    },
    {
      id: 's2',
      title: 'In flight',
      hint: '3 moving · steady throughput',
      items: [
        { id: 'f1', label: 'Pitch deck reorder', who: 'Designer' },
        { id: 'f2', label: 'Case study draft', who: 'Writer' },
        { id: 'f3', label: 'DE localization', who: 'Translator' }
      ]
    },
    {
      id: 's3',
      title: 'Your call',
      warm: true,
      hint: '2 waiting · ~5 min',
      items: [
        { id: 'y1', label: 'Approve deck: pricing-first', who: 'Planner' },
        { id: 'y2', label: 'Send Acme renewal reply', who: 'Mailer' }
      ]
    },
    {
      id: 's4',
      title: 'Shipped',
      hint: '4 this week · settled',
      items: [
        { id: 'sh1', label: 'Board deck v3', who: 'Designer' },
        { id: 'sh2', label: 'Onboarding one-pager', who: 'Writer' }
      ]
    }
  ]
}

/** Agent — zoom into ONE agent: activity trail, confidence, turns/cost, artifact. */
export interface TrailStep {
  id: string
  line: string
  done: boolean
}

export interface AgentView {
  name: string
  role: string
  live: string
  confidence: number
  turns: number
  cost: string
  /** The artifact taking shape — a thumbnail slot (kind + label). */
  artifact: { kind: Landed['kind']; label: string; progress: string }
  trail: TrailStep[]
}

export const AGENT_VIEW: AgentView = {
  name: 'Designer',
  role: 'Deck & layout',
  live: 'laying out 12 slides · 7 of 12',
  confidence: 0.64,
  turns: 9,
  cost: '$0.18',
  artifact: { kind: 'deck', label: 'Pitch deck v4 — pricing-first order', progress: '7 / 12 slides' },
  trail: [
    { id: 't1', line: 'Read the approved pricing-first order', done: true },
    { id: 't2', line: 'Pulled brand palette + type from the system', done: true },
    { id: 't3', line: 'Rebuilt slides 1–5 (Pricing → Proof)', done: true },
    { id: 't4', line: 'Laying out the onboarding sequence · 7/12', done: false },
    { id: 't5', line: 'Next: proof-points and the close', done: false }
  ]
}
