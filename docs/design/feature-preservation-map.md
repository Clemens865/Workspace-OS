# Feature-Preservation Map — nothing is lost in the redesign

**Hard rule:** the redesign is a *re-skin + re-organization*, not a rebuild. Every capability the app ships today keeps a clear home in the new navigation model. This table is the contract — I map each existing feature before any code changes.

## The new IA in one line
**HOME** (the Cockpit — ambient triage + command) · **RAIL** (thin left switcher between surfaces) · **STAGE** (main area; surfaces open as tabs) · **⌘K** (universal command) · **Settings/overlays**.

## The map — every current feature → its new home

| Current feature (today) | New home | Notes |
|---|---|---|
| **Files** panel (sidebar) | **RAIL → Files surface** (folder tree) | Opens documents onto the Stage. The folder view you asked about. |
| **Search** panel | **⌘K** (universal) + Files-surface search | Merges with Quick Open into one command. |
| **Memory** panel | **Knowledge surface** (a section) | Prior insights live alongside notes/graph. |
| **Knowledge** (backlinks · graph · related · md-preview) | **RAIL → Knowledge surface** | Unchanged capability, first-class surface. |
| **Review** / Living Feed / **Fleet** (FeedCard, HitlCard, FleetView, MailFeedCard) | **HOME** (ambient cards) **+ RAIL → Agents surface** (full fleet) | The Cockpit *is* this, elevated. "Where are agents running" = the Agents surface. |
| **Mail** panel | **RAIL → Mail surface** (full) **+ HOME cards** | Promoted from a cramped strip to a real surface; items needing you surface in Home. |
| **Canvas** renderers — office (Excel/Word/PPT via LOK) · pdf · monaco (code/text) · csv · image · video · audio · html · **whiteboard** (tldraw .wcanvas) · **markdown preview** | **STAGE** — open a file → its renderer, **as tabs** | The whole editing engine + all renderers preserved verbatim; they just live in the Stage. |
| **Collections / Metrics** (MetricsPanel in the office renderer) | **Within the office Stage surface** (as today) | Liveness stays where the document is. |
| **Agent terminal** (console · **xterm** · **shell** · artifact cards · **new-agent form** · budget ledger · HITL gate · slash commands) | **HOME → Assistant console** (optional, dockable): Chat by default, **Activity log / Terminal** on toggle; NewAgentForm → "Ask / Launch"; ArtifactCards → inside result cards; budget → status | Nothing removed — the power-user xterm/shell is one toggle away, not gone. |
| **Connectors & Keys** (MCP vault) | **Settings → Connectors** | Re-skinned, same function. |
| **Brand kit** | **Settings → Brand** | Same. |
| **Checkpoints** | **Card "Undo" + Settings → History** | The per-card Undo *is* checkpoint rollback, surfaced humanely. |
| **Snapshots** (workspace state) | **Settings → Workspace** | Same. |
| **Trash** | **Files surface + Settings** | Same. |
| **Command palette** (CommandBar) + **Quick Open** | **⌘K** (unified universal command) | Two merge into one. |
| **Settings** | **Settings** (re-skinned in the new language) | Unchanged surface. |
| **Update** | Background + a subtle indicator | Same. |

## The guarantee
- **No renderer, engine call, macro, IPC, or store is removed** — the Stage hosts every current Canvas renderer; the office LOK engine, collections/metrics, mail, canvas, knowledge, agent platform all keep their code.
- **Re-org, not deletion:** the six cramped sidebar views become proper surfaces on the rail; the bottom terminal becomes the optional dockable Assistant; the Living Feed becomes Home.
- **Power features survive:** raw terminal/shell, slash commands, checkpoints, connectors, brand kit, snapshots — all reachable, just placed where they belong instead of crammed.

## Implementation discipline (when we build)
Ship the new shell **behind the existing features, not over them** — the redesign is a new Layout that *composes the same components*. Each surface migrates one at a time, verified against its current behavior, so at no point is functionality dark. A visual test + the existing e2es stay the gate.
