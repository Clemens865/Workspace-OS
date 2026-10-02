/* Worklive — Screen Landscape clickable prototype.
   One persistent world of agent sheets; each view re-places them.
   Foreground panels live in #layer and animate in/out. */
const { agents, statusLabel, providerLabel } = WL;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const byId = (id) => agents.find((a) => a.id === id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = "cubic-bezier(.22,.8,.18,1)";

const state = { view: "overview", agent: null, tab: "browser", mode: "agents", caseId: null, inboxId: "lena", stack: [] };
const world = $("#world"), layer = $("#layer"), stage = $("#stage");

/* ---------- line icons (1.6 stroke) ---------- */
const ICONS = {
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.3c1.8.6 3 2.2 3.4 4.7"/>',
  inbox: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  handoff: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  file: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9.5 13h6M9.5 16.5h6"/>',
  plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V21"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.3l2.4 2.4 4.8-5"/>',
  bookmark: '<path d="M7 3.5h10v17l-5-3.6-5 3.6z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  book: '<path d="M12 6.5C10 5 7 4.5 3.5 5v13.5C7 18 10 18.5 12 20c2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5V20"/>',
  layers: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.6-4.6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  pin: '<path d="M9 3.5h6M10 3.5v6l-3 3.5h10L14 9.5v-6M12 13v7.5"/>',
  pdf: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 16.5h1.6a1.4 1.4 0 0 0 0-2.8H9v4.3"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  note: '<rect x="4.5" y="4" width="15" height="16" rx="2"/><path d="M8 9h8M8 12.5h8M8 16h5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z"/>',
  attach: '<path d="M19.5 11.5l-7.6 7.6a4.6 4.6 0 0 1-6.5-6.5l8-8a3 3 0 0 1 4.3 4.3l-7.7 7.7a1.5 1.5 0 0 1-2.2-2.2l7-7"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9l4.5-4.5L16.5 9M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15"/>',
  template: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11"/>',
  stack: '<ellipse cx="12" cy="6.5" rx="7.5" ry="3"/><path d="M4.5 6.5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5M4.5 11.5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  cursor: '<path d="M5 4l13.5 6-5.8 1.9L10.8 18z"/>',
  export: '<path d="M12 3.5v11M7.5 8L12 3.5 16.5 8M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>',
};
const ico = (n, sz = 18) => `<svg class="i" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

/* ---------- fit 1600×900 stage to window ---------- */
function fit() {
  const s = Math.min(innerWidth / 1600, innerHeight / 900);
  stage.style.transform = `translate(-50%,-50%) scale(${s})`;
}
addEventListener("resize", fit); fit();

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2400);
}

/* ---------- agent sheets ---------- */
function miniHTML(a) {
  const st = statusLabel[a.status];
  switch (a.mini) {
    case "article": return `<div class="m-browser"><div class="urlbar">${ico("globe", 10)} example.com/article</div>
      <div class="m-art">The future<br>of focused work</div><div class="m-img"></div><div class="bars"><i style="width:90%"></i><i style="width:70%"></i></div></div>
      <div class="m-foot"><span class="pulse"></span>Working · <span class="live shimmer" data-text="Live">Live</span></div>`;
    case "research": return `<div class="m-browser"><div class="urlbar">${ico("globe", 10)} example.com/research</div>
      <div class="m-art">Research notes</div><div class="row" style="align-items:flex-start;margin-top:8px;gap:14px">
      <div class="tiny muted" style="line-height:2">Overview<br>Sources<br>Notes<br>Summary</div>
      <div style="flex:1"><div class="tiny">Exploring different approaches…</div><div class="bars"><i></i><i style="width:80%"></i><i style="width:90%"></i></div></div></div></div>
      <div class="m-foot"><span class="pulse"></span>Working · <span class="live shimmer" data-text="Live">Live</span></div>`;
    case "doc": return `<div class="m-browser" style="padding:6px 6px"><div class="row small" style="gap:8px"><span style="color:#4a8fd8">${ico("file", 15)}</span> Product brief</div>
      <div class="row" style="align-items:flex-start;margin-top:12px"><div class="bars" style="flex:1"><i></i><i style="width:85%"></i><i style="width:90%"></i><i style="width:60%"></i></div>
      <div class="m-img" style="width:76px;height:60px;margin:0"></div></div><div class="bars"><i></i><i style="width:75%"></i></div></div>
      <div class="m-foot"><span class="dot"></span>Ready for review</div>`;
    case "question": return `<div class="m-center" style="padding-bottom:36px"><div class="q-ico">?</div>
      <div class="small" style="margin-top:6px">New users or<br>administrators?</div><div class="m-input">Your answer…</div></div>
      <div class="m-foot"><span class="dot" style="--c:var(--amber)"></span>Needs your answer</div>`;
    case "paused": return `<div class="m-center" style="padding-bottom:36px"><div class="p-ico">II</div>
      <div style="font-size:14px;margin-top:4px">Paused</div><div class="m-sub">Task on hold</div>
      <div class="m-input" style="text-align:center;color:var(--ink-2)">Resume when ready</div></div>
      <div class="m-foot"><span class="dot" style="--c:var(--grey)"></span>Paused</div>`;
    default: return `<div class="m-center"><div class="mono">${a.name[0]}</div><div class="m-state">${st}</div><div class="m-sub">${a.sub || "Ready when you are"}</div></div>`;
  }
}

function buildSheets() {
  agents.forEach((a) => {
    const c = a.caseId && WL.cases.find((x) => x.id === a.caseId);
    const el = h(`<div class="sheet ${a.p} ${a.status === "question" ? "asks" : ""}" data-id="${a.id}">
      <div class="face" tabindex="0" role="button" aria-label="${a.name}, ${providerLabel[a.p]}, ${statusLabel[a.status]}">
        <div class="mini">${miniHTML(a)}</div><div class="full"></div>
      </div>
      <button class="grip" tabindex="-1"><span class="dot"></span><span>${a.name}<span class="pv"> / ${providerLabel[a.p]}</span></span></button>
      ${c ? `<button class="casetab" data-case="${c.id}">${c.title}</button>` : ""}
    </div>`);
    el.querySelector(".face").addEventListener("click", () => { if (!el.classList.contains("focused")) openAgent(a.id); });
    el.querySelector(".face").addEventListener("keydown", (e) => { if (e.key === "Enter" && !el.classList.contains("focused")) openAgent(a.id); });
    el.querySelector(".grip").addEventListener("click", () => openAgent(a.id));
    const tab = el.querySelector(".casetab");
    if (tab) tab.addEventListener("click", (e) => { e.stopPropagation(); go("overview", { mode: "cases", caseId: tab.dataset.case }); });
    world.appendChild(el);
  });
  const add = h(`<div class="sheet ghost" data-id="__add"><div class="face" tabindex="0" role="button" aria-label="Add agent">
    <div class="m-center"><div style="width:36px;height:36px;border-radius:50%;border:1.5px dashed var(--muted);display:grid;place-items:center;color:var(--muted);font-size:20px">+</div>
    <div style="font-size:15px;color:var(--ink-2);margin-top:6px">Add agent</div></div></div></div>`);
  add.querySelector(".face").addEventListener("click", () => go("create"));
  world.appendChild(add);
}

function place(el, p) {
  if (!p) p = { x: 700, y: 330, z: -1400, w: 200, h: 200, ry: 0, op: 0 };
  el.style.width = p.w + "px"; el.style.height = p.h + "px";
  el.style.transform = `translate3d(${p.x}px,${p.y}px,${p.z || 0}px) rotateY(${p.ry || 0}deg) rotateX(${p.rx || 0}deg)`;
  el.style.setProperty("--op", p.op ?? 1);
  el.style.setProperty("--ry", (p.ry || 0).toFixed(2));
  el.style.pointerEvents = (p.op ?? 1) < 0.2 ? "none" : "";
  el.style.zIndex = p.zi ?? Math.round((p.z || 0) + 1000);
  el.classList.toggle("side", !!p.side);
  el.classList.toggle("glass", !!p.glass);
  el.classList.toggle("deep", p.glass === 2);
  el.style.transitionDelay = (p.delay || 0) + "ms";
}

/* ---------- layouts ---------- */
const FRONT = ["ada", "milo", "lena", "noor", "sam", "juno", "otto", "vera"];
const BACK = ["heiko", "mike", "iris", "theo", "remy", "nia", "kai", "lou", "__add"];
const BACK_AGENTS = BACK.filter((id) => id !== "__add");

/* Scroll position of the team carousel, in "front-row items" (0 = Ada…Juno centred). */
const SC = { cur: -1, t: -1, raf: 0, snapT: 0, last: 0 };
const SC_MIN = -1, SC_MAX = FRONT.length - 7; // three resting positions for eight front sheets
const scrolling = () => SC.raf !== 0;

// Sheets sit on the inside of a shallow cylinder: edges turn toward the viewer.
function arc(L, ids, off, o) {
  const mid = (ids.length - 1) / 2;
  ids.forEach((id, i) => {
    const d = i - mid - off, a = d * o.step, ad = Math.abs(d);
    L[id] = {
      x: 800 + o.R * Math.sin(a) - o.w / 2, y: o.y + ad * ad * o.sag,
      z: o.z0 + o.R * o.depth * (1 - Math.cos(a)), ry: -a * 57.3 * o.turn,
      w: o.w, h: o.h, glass: o.glass,
      op: ad <= o.vis ? 1 : Math.max(0, 1 - (ad - o.vis) / .75),
      delay: scrolling() ? 0 : o.delay + Math.round(ad) * 35,
    };
  });
}
function overviewLayout() {
  const L = {}, off = SC.cur;
  arc(L, FRONT, off, { R: 2000, step: .125, w: 222, h: 232, y: 428, z0: 0, depth: .2, turn: .62, sag: 1.2, vis: 2.6, delay: 0 });
  // back row drifts slower: a quiet parallax that reads as depth
  arc(L, BACK, -.5 + (off + 1) * .78, { R: 2100, step: .104, w: 190, h: 182, y: 196, z0: -160, depth: .16, turn: .5, sag: .8, vis: 3.4, glass: 1, delay: 120 });
  return L;
}

const SIDE_L = [{ x: 22, y: 180, w: 178, h: 310, ry: 30 }, { x: 206, y: 182, w: 166, h: 305, ry: 26 }];
const SIDE_R = [{ x: 1240, y: 190, w: 112, h: 296, ry: -26 }, { x: 1362, y: 194, w: 108, h: 290, ry: -26 }, { x: 1480, y: 200, w: 104, h: 284, ry: -28 }];
function hiddenLayout(L, ids) {
  ids.forEach((id, i) => { if (!L[id]) L[id] = { x: 700 + (i % 2 ? 140 : -140), y: 260, z: -1200, w: 190, h: 190, op: 0 }; });
  return L;
}
const ringOf = (id) => (BACK_AGENTS.includes(id) ? BACK_AGENTS : FRONT);
// Neighbours flank the focus in carousel order, so ←/→ feels like turning the ring.
function flankLayout(focusId, slotsL = SIDE_L, slotsR = SIDE_R) {
  const L = {}, ring = ringOf(focusId), n = ring.length;
  const c = focusId ? ring.indexOf(focusId) : Math.round(4 + SC.cur); // first sheet right of centre
  const at = (k) => ring[((k % n) + n) % n];
  slotsL.forEach((slot, j) => { const id = at(c - (slotsL.length - j)); L[id] = { ...slot, z: -40, side: true, glass: 2, delay: 60 + j * 50 }; });
  slotsR.forEach((slot, j) => { const id = at(c + j + (focusId ? 1 : 0)); if (!L[id]) L[id] = { ...slot, z: -40, side: true, glass: 2, delay: 60 + j * 50 }; });
  return hiddenLayout(L, [...FRONT, ...BACK]);
}
function focusLayout(id) {
  const L = flankLayout(id);
  L[id] = { x: 392, y: 64, z: 80, w: 826, h: 612, zi: 3000 };
  return L;
}
function awayLayout() { // world recedes into mist (for library, handoff, connections, projects)
  const L = overviewLayout();
  Object.values(L).forEach((p, i) => Object.assign(p, { z: -1300, y: p.y - 40, op: 0, delay: i * 15 }));
  return L;
}
function casesLayout() {
  const L = hiddenLayout({}, [...FRONT, ...BACK]);
  L.ada = { x: 90, y: 178, z: 0, ry: 4, w: 210, h: 210 };
  L.lena = { x: 340, y: 186, z: -10, ry: 2, w: 190, h: 196, glass: 1 };
  return L;
}
function applyLayout(L) {
  $$(".sheet", world).forEach((el) => place(el, L[el.dataset.id]));
}

/* ---------- foreground layer ---------- */
function enter(el, i = 0, from = "rise") {
  if (reduced) return;
  const k = {
    rise: [{ opacity: 0, translate: "0 46px -260px", scale: ".94" }, { opacity: 1, translate: "0 0 0", scale: "1" }],
    left: [{ opacity: 0, translate: "-120px 20px -200px", scale: ".95" }, { opacity: 1, translate: "0 0 0", scale: "1" }],
    right: [{ opacity: 0, translate: "120px 20px -200px", scale: ".95" }, { opacity: 1, translate: "0 0 0", scale: "1" }],
    drop: [{ opacity: 0, translate: "0 -30px 0", scale: "1" }, { opacity: 1, translate: "0 0 0", scale: "1" }],
  }[from];
  el.animate(k, { duration: 900, delay: 140 + i * 70, easing: ease, fill: "backwards" });
}
function setLayer(nodes) {
  $$(":scope > *", layer).forEach((old) => {
    old.style.pointerEvents = "none";
    const a = reduced ? null : old.animate([{ opacity: 1 }, { opacity: 0, translate: "0 24px -220px", scale: ".96" }], { duration: 420, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
    a ? a.finished.then(() => old.remove()) : old.remove();
  });
  nodes.forEach((n, i) => { layer.appendChild(n); enter(n, i, n.dataset.enter || "rise"); });
}

/* ---------- chrome ---------- */
const CHROME = {
  overview: () => ({ title: state.mode === "cases" ? "Your cases" : "Your team", sub: state.mode === "cases" ? "" : "16 agents  •  2 working  •  1 question  •  1 to review", toggle: true, tools: true, hint: state.mode !== "cases", dock: "overview" }),
  cases: () => ({ title: "Your cases", toggle: true, tools: true, dock: "overview" }),
  agent: () => ({ back: "Team overview", dock: "overview", hint: "← → or swipe sideways to switch agents · Esc to return", noScrub: true }),
  menu: () => ({ title: "", word: "Menu", dock: "menu", corner: "Esc to return" }),
  inbox: () => ({ title: "Inbox · 3 waiting", sub: "Other tasks paused for review", dock: "inbox" }),
  projects: () => ({ dock: "projects" }),
  library: () => ({ dock: "library" }),
  handoff: () => ({ title: "Handoff", small: true, dock: "overview" }),
  create: () => ({ title: "Create agent", small: true, dock: "overview" }),
  connections: () => ({ title: "Connect your tools", sub: "Use your existing subscriptions.", back: "Back", dock: "menu" }),
};
// Whole-word swap: old text lifts away with a little blur, new text settles from below.
// Adapted from Transitions.dev "text-states-swap", scaled for the serif display size.
function swapText(el, next, mid) {
  if (el.textContent === next) { mid && mid(); return; }
  if (reduced || !el.textContent) { el.textContent = next; mid && mid(); return; }
  clearTimeout(el._swap);
  el.classList.add("t-exit");
  el._swap = setTimeout(() => {
    el.textContent = next; mid && mid();
    el.classList.replace("t-exit", "t-enter"); void el.offsetWidth; el.classList.remove("t-enter");
  }, 200);
}
function updateChrome() {
  const c = CHROME[state.view]();
  const title = $("#title");
  swapText(title, c.title || "", () => { title.style.fontSize = c.small ? "26px" : ""; });
  title.classList.toggle("is-hidden", !c.title);
  setTimeout(() => swapText($("#subtitle"), c.sub || ""), 60);
  $("#subtitle").classList.toggle("is-hidden", !c.sub);
  $("#back").hidden = !c.back; $("#back-label").textContent = c.back || "";
  $("#toggle").classList.toggle("is-hidden", !c.toggle);
  $$("#toggle button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
  requestAnimationFrame(() => movePill($("#toggle")));
  $(".top-right").classList.toggle("is-hidden", !c.tools);
  const hintText = typeof c.hint === "string" ? c.hint : "Scroll to explore · choose a screen to step closer";
  if (c.hint) swapText($("#hint"), hintText);
  $("#hint").style.opacity = c.hint ? 1 : 0;
  scrub.style.opacity = c.hint && !c.noScrub ? 1 : 0;
  $$("#dock button").forEach((b) => b.classList.toggle("on", b.dataset.go === c.dock));
  moveDockGlow();
  document.body.classList.toggle("zoomed", state.view !== "overview");
}
// One pill glides behind the active segment (Transitions.dev "tabs-sliding").
function movePill(group, instant) {
  if (!group) return;
  let pill = group.querySelector(".seg-pill");
  if (!pill) { pill = h(`<span class="seg-pill" aria-hidden="true"></span>`); group.prepend(pill); instant = true; }
  const on = group.querySelector(".on"); if (!on) return;
  if (instant) pill.style.transition = "none";
  pill.style.width = on.offsetWidth + "px"; pill.style.transform = `translateX(${on.offsetLeft}px)`;
  if (instant) { void pill.offsetWidth; pill.style.transition = ""; }
}
function moveDockGlow() {
  const on = $("#dock button.on"), g = $(".dock-glow");
  if (!on) { g.style.width = "0px"; return; }
  g.style.left = on.offsetLeft + "px"; g.style.width = on.offsetWidth + "px";
}

/* ---------- router ---------- */
function snapshot() { return { view: state.view, agent: state.agent, tab: state.tab, caseId: state.caseId, mode: state.mode }; }
function go(view, opts = {}) {
  if (view !== state.view || opts.agent !== state.agent || opts.caseId !== state.caseId) state.stack.push(snapshot());
  if (state.stack.length > 30) state.stack.shift();
  Object.assign(state, { view, agent: null, caseId: null }, opts);
  if (view === "overview" && !opts.mode) state.mode = "agents";
  render();
}
function back() {
  if (state.view === "overview" && state.mode === "agents") return;
  const prev = state.stack.pop();
  if (!prev || state.view === "agent") { Object.assign(state, { view: "overview", agent: null, mode: "agents" }); state.stack = []; }
  else Object.assign(state, prev);
  render();
}
function rippleFrom(el, amp = 1) {
  if (!el || !window.WLBG) return;
  const r = el.getBoundingClientRect();
  WLBG.ripple(r.left + r.width / 2, Math.max(r.bottom, innerHeight * .52), amp);
}
function openAgent(id, tab = "browser") {
  if (state.view !== "agent") rippleFrom($(`.sheet[data-id="${id}"] .face`)); go("agent", { agent: id, tab: byId(id).status === "question" && tab === "browser" ? "task" : tab }); }

function render() {
  updateChrome();
  $$(".sheet", world).forEach((el) => {
    const f = el.dataset.id === state.agent && state.view === "agent";
    const was = el.classList.contains("focused");
    el.classList.toggle("focused", f);
    if (f) renderAgentFull(el);
    if (f && !was && !reduced) $(".face", el).animate([{ transform: "scale(.94)", offset: 0 }, { transform: "scale(1.012)", offset: .7 }, { transform: "scale(1)" }], { duration: 1100, easing: "cubic-bezier(.3,.7,.2,1)" });
  });
  syncBg();
  const L = (LAYOUTS[state.view] || overviewLayout)();
  applyLayout(L);
  setLayer((VIEWS[state.view] || (() => []))());
}
const PROV_RGB = { codex: [.18, .62, .56], claude: [.85, .47, .34] };
// Footprints of standing sheets, for reflections and contact shadows on the lake.
function sheetFootprints() {
  const out = [], hz = innerHeight * (1 - .505);
  for (const el of world.children) {
    const op = +(el.style.getPropertyValue("--op") || 1);
    if (op < .25 || el.dataset.id === "__add") continue;
    const r = $(".face", el).getBoundingClientRect();
    if (r.bottom < hz || r.width < 20) continue;
    const a = byId(el.dataset.id);
    out.push({ left: r.left, right: r.right, bottom: r.bottom, alpha: op * (el.classList.contains("glass") ? .55 : 1), color: PROV_RGB[a.p], z: r.width });
  }
  return out.sort((a, b) => b.z - a.z).slice(0, 8);
}
let lastView = "";
function syncBg() {
  if (!window.WLBG) return;
  WLBG.trackSheets(sheetFootprints, 1500);
  const key = state.view + state.mode;
  if (lastView && key !== lastView) WLBG.breathe();
  lastView = key;
  const fa = state.view === "agent" && $(`.sheet[data-id="${state.agent}"]`);
  WLBG.setLight(fa ? .5 : .56);
  const home = state.view === "overview" && state.mode === "agents";
  WLBG.setFocus(home ? 0 : state.view === "agent" ? 1 : .7);
  const a = state.view === "agent" && byId(state.agent);
  WLBG.setTint(a ? (a.p === "codex" ? "#2D9D8F" : "#D97757") : null);
}
const LAYOUTS = {
  overview: () => state.mode === "cases" ? casesLayout() : overviewLayout(),
  cases: casesLayout,
  agent: () => focusLayout(state.agent),
  menu: () => flankLayout(null, [{ x: 40, y: 200, w: 200, h: 270, ry: 22 }, { x: 236, y: 196, w: 180, h: 272, ry: 16 }, { x: 420, y: 182, w: 150, h: 300, ry: 10 }],
    [{ x: 1032, y: 205, w: 175, h: 260, ry: -10 }, { x: 1222, y: 222, w: 165, h: 240, ry: -16 }, { x: 1405, y: 228, w: 155, h: 228, ry: -22 }]),
  inbox: () => hiddenLayout({}, [...FRONT, ...BACK]),
  create: () => flankLayout(null, [{ x: 34, y: 176, w: 190, h: 290, ry: 20 }, { x: 246, y: 180, w: 190, h: 285, ry: 16 }],
    [{ x: 1165, y: 182, w: 190, h: 270, ry: -16 }, { x: 1370, y: 190, w: 190, h: 262, ry: -20 }]),
  projects: awayLayout, library: awayLayout, handoff: awayLayout, connections: awayLayout,
};
const VIEWS = {};

/* ---------- focused agent ---------- */
const TABS = [["browser", "Browser"], ["chat", "Chat"], ["task", "Task"], ["context", "Context"], ["results", "Results"]];
function statusDot(s, a) { return { working: a && a.p === "claude" ? "var(--terra)" : "var(--teal)", review: "var(--terra)", question: "var(--amber)", paused: "var(--grey)", idle: "var(--grey)" }[s]; }

function renderAgentFull(el) {
  const a = byId(el.dataset.id), full = $(".full", el);
  full.innerHTML = `<div class="ag" style="--pc:var(--c)">
    <div class="row between ag-head"><div class="row"><div class="av lg ${a.p}">${a.name[0]}</div>
      <div class="ag-name">${a.name} <span class="muted">·</span> ${a.role}</div></div>
      <div class="row"><span class="status"><span class="dot" style="--c:${statusDot(a.status, a)}"></span>${statusLabel[a.status]}</span>
      <button class="x" aria-label="Back to overview">✕</button></div></div>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join("")}<span class="ink"></span></div>
    <div class="tab-body"></div></div>`;
  $(".x", full).onclick = back;
  $$(".tabs button", full).forEach((b) => b.onclick = () => setTab(el, b.dataset.tab));
  setTab(el, state.tab, true);
}
function setTab(el, tab, first) {
  state.tab = tab;
  const a = byId(el.dataset.id), full = $(".full", el);
  $$(".tabs button", full).forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const on = $(".tabs button.on", full), ink = $(".tabs .ink", full);
  requestAnimationFrame(() => { ink.style.left = on.offsetLeft + "px"; ink.style.width = on.offsetWidth + "px"; });
  const body = $(".tab-body", full);
  body.innerHTML = ""; const pane = h(`<div class="tab-pane">${TAB_HTML[tab](a)}</div>`);
  if (first) pane.style.animationDelay = ".35s";
  body.appendChild(pane);
  (TAB_WIRE[tab] || (() => {}))(a, pane, el);
}

const steps = (a) => { const t = WL.tasks[a.id]; return t ? `<div class="steps">${t.steps.map(([s, w, d], i) => `<div class="step ${d ? "done" : ""}" style="--i:${i}"><i></i><div><div>${s}</div><div class="tiny muted">${w}</div></div></div>`).join("")}</div>` : ""; };

const TAB_HTML = {
  browser: (a) => {
    const t = WL.tasks[a.id];
    const live = a.status === "working";
    const page = live ? `<div class="bw-page"><div class="h-xl">A simpler first session</div>
        <p class="muted" style="margin:12px 0 16px;max-width:460px;line-height:1.5">A calm start helps you get value sooner. This guide walks you through the essentials, with a few practical tips along the way.</p>
        <div class="m-img hero"></div>
        <div class="cols3"><div><b>Set your goals</b><p>Tell us what you're working on so we can be helpful from the start.</p></div>
        <div><b>Explore with confidence</b><p>Try a task, ask questions, and make it your own.</p></div>
        <div><b>Build your workflow</b><p>Bring useful context and keep going at your pace.</p></div></div></div>`
      : `<div class="bw-empty"><div class="mono">${a.name[0]}</div><div style="margin-top:12px">${a.status === "idle" ? "No browser open" : "Last capture · 10:31"}</div>
        <div class="small muted">${a.status === "idle" ? "Start a task to give " + a.name + " a browser." : "Not live — shown as a timestamped capture."}</div></div>`;
    return `<div class="bw"><div class="bw-main"><div class="bw-bar"><span>←</span><span>→</span><span>↻</span><div class="bw-url">https://example.com/onboarding</div><span>⋯</span></div>${page}</div>
      <div class="bw-side">${t ? `<div class="row between"><div class="h-m">${t.title}</div><span class="muted">⋯</span></div>${steps(a)}<div class="brief">${t.brief}</div>
        <div class="row" style="gap:10px;margin-top:auto">${a.status === "working" ? `<button class="btn" data-act="pause">❙❙ Pause</button><button class="btn out-terra" data-act="stop">■ Stop</button>` : a.status === "paused" ? `<button class="btn teal" data-act="resume">▶ Resume</button>` : ""}</div>`
        : `<div class="h-m">No task yet</div><p class="small muted" style="margin-top:8px;line-height:1.5">${a.name} is idle. Chat is for discussion — create a task to start work.</p><button class="btn teal" style="margin-top:16px" data-act="newtask">Create a task</button>`}</div></div>
      <div class="bw-foot"><div class="row" id="ctrl-state"><span class="eye">${ico("eye", 20)}</span> Watching <span class="muted">·</span> <span style="color:var(--c)">Agent in control</span></div>
        <div class="ctrl"><button class="btn teal" data-act="take" ${live ? "" : "disabled"}>${ico("cursor", 16)} Take control</button><div class="tiny muted" style="margin-top:5px">Pauses ${a.name} before you interact.</div></div>
        <button class="link" data-act="results">View results →</button></div>`;
  },
  chat: (a) => {
    const msgs = WL.chat[a.id] || [["agent", `Hi — I'm ${a.name}. What would you like to talk through?`, "Now"]];
    return `<div class="chat"><div class="msgs" aria-live="polite">${msgs.map(msgHTML).join("")}</div>
      <div class="chat-note">ⓘ Chat is for discussion. Start a task to use tools.</div>
      <form class="composer"><input class="field" placeholder="Message ${a.name}…" aria-label="Message"><button class="send" aria-label="Send">➤</button></form></div>`;
  },
  task: (a) => {
    const t = WL.tasks[a.id];
    if (a.status === "question") return `<div class="qwrap"><div class="q-ico">?</div><div class="h-l" style="margin-top:14px">New users or administrators?</div>
      <p class="muted" style="margin:8px 0 18px">This will help me set up the right onboarding flow.</p>
      <div class="opts">${["New users", "Administrators", "Both"].map((o) => `<button class="opt">${o}</button>`).join("")}</div>
      <button class="btn teal" data-act="answer" disabled style="margin-top:18px">Send answer and continue</button>
      <div class="tiny muted" style="margin-top:8px">Continues the existing run. Casual chat stays separate.</div></div>`;
    if (t) return `<div class="task-v"><div><div class="tiny muted">CURRENT TASK · Website launch</div><div class="h-l" style="margin:6px 0 10px">${t.title}</div><p style="line-height:1.6">${t.brief}</p>
      <div class="row" style="margin-top:16px;gap:8px"><span class="chip">${ico("file", 15)}Task files · 3</span><span class="chip">Run 2</span><span class="chip">Context received</span></div></div>${steps(a)}</div>`;
    return `<form class="task-new"><div class="flabel">Title</div><input class="field" name="t" placeholder="What should ${a.name} do?">
      <div class="flabel">Brief / expected deliverable</div><textarea class="field" name="b" rows="4" placeholder="Describe the result you want to review."></textarea>
      <div class="row" style="margin-top:14px;gap:10px"><span class="chip">${ico("folder", 15)}Website launch</span><span class="chip">Prerequisite · none</span></div>
      <div class="row" style="margin-top:18px"><button class="btn" type="button" data-act="save">Save as planned</button><button class="btn teal" type="submit">Start task</button></div>
      <div class="tiny muted" style="margin-top:8px">Work starts only when you choose Start.</div></form>`;
  },
  context: (a) => `<div class="ctx">${[["Personal", "Private to " + a.name, ["Notes", "Drafts", "Saved"]], ["Project", "Website launch", ["Project brief", "Voice guidelines", "brief.pdf"]], ["Company", "Shared with every agent", ["Guidelines", "Templates"]]]
    .map(([s, d, items]) => `<div class="card ctx-col"><div class="h-m">${s}</div><div class="small muted">${d}</div>${items.map((i) => `<button class="ctx-item row">${ico("file", 16)}${i}</button>`).join("")}</div>`).join("")}</div>
    <div class="tiny muted" style="margin-top:12px">Read-only while a task runs. Scopes are provider-independent.</div>`,
  results: (a) => a.status === "review" || a.status === "working" ? `<div class="res"><div class="card res-doc"><div class="tiny muted">${a.status === "review" ? "READY FOR REVIEW" : "IN PROGRESS · PARTIAL"}</div>
      <div class="h-l" style="margin:6px 0">${a.status === "review" ? "Launch plan" : "Onboarding comparison (draft)"}</div><div class="bars"><i></i><i style="width:92%"></i><i style="width:80%"></i><i style="width:88%"></i><i style="width:60%"></i></div></div>
      <div class="res-side"><div class="small row">${ico("globe", 16)}3 sources</div><div class="small row">${ico("clock", 16)}Task history</div>${a.status === "review" ? `<button class="btn terra" data-act="review">Open review</button>` : `<div class="small muted">Results are reviewable once the run finishes.</div>`}</div></div>`
    : `<div class="bw-empty" style="height:300px"><div style="font-size:30px">▢</div><div style="margin-top:10px">No results yet</div><div class="small muted">Results appear after a task run.</div></div>`,
};
function msgHTML([who, text, time, prep]) {
  return who === "you" ? `<div class="msg you"><div class="row between tiny"><b>You</b><span class="muted">${time}</span></div><div>${text}</div></div>`
    : `<div class="msg agent"><div class="av sm ${(byId(state.agent) || {}).p || ""}">${(byId(state.agent) || {}).name?.[0] || "N"}</div><div style="flex:1"><div class="row between tiny"><b>${(byId(state.agent) || {}).name || ""}</b><span class="muted">${time}</span></div><div class="msg-text">${text}</div>${prep ? `<button class="btn out-teal prep">Prepare task</button>` : ""}</div></div>`;
}

// Words resolve through a soft blur (Transitions.dev "streaming-text"); the full text is in the DOM at once.
function streamIn(msg) {
  const body = msg.querySelector(".msg-text"); if (!body || reduced) return;
  const words = body.textContent.split(" ");
  body.innerHTML = words.map((w) => `<span class="t-w">${w}</span>`).join(" ");
  const gap = Math.min(60, 1100 / words.length);
  body.querySelectorAll(".t-w").forEach((w, i) => setTimeout(() => w.classList.add("in"), i * gap));
}
const TAB_WIRE = {
  browser: (a, pane, el) => {
    let taken = false;
    pane.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
      const act = b.dataset.act;
      if (act === "take") {
        taken = !taken;
        $("#ctrl-state", pane).innerHTML = taken ? `<span class="eye" style="color:var(--amber)">${ico("cursor", 20)}</span> You're in control <span class="muted">·</span> <span style="color:var(--amber)">${a.name} paused</span>`
          : `<span class="eye">${ico("eye", 20)}</span> Watching <span class="muted">·</span> <span class="muted">Control returned · resume when ready</span>`;
        b.innerHTML = taken ? "↩ Return control" : "▶ Resume";
        b.classList.toggle("teal", !taken); b.classList.toggle("amber", taken);
        el.querySelector(".face").classList.toggle("taken", taken);
        if (!taken) b.onclick = () => { toast(`${a.name} resumed`); setTab(el, "browser"); };
        toast(taken ? `${a.name} paused — you have the browser` : "Control returned. Resume is a separate step.");
      }
      if (act === "pause") toast(`${a.name} will pause after the current step`);
      if (act === "stop") toast("Stop needs confirmation — prototype only");
      if (act === "resume") toast(`${a.name} resumed`);
      if (act === "results") setTab(el, "results");
      if (act === "newtask") setTab(el, "task");
    });
  },
  chat: (a, pane, el) => {
    const msgs = $(".msgs", pane); msgs.scrollTop = msgs.scrollHeight;
    const wirePrep = () => $$(".prep", pane).forEach((b) => b.onclick = () => {
      toast("Brief copied into a task composer — nothing started");
      setTab(el, "task");
      const f = $(".task-new", el); if (f) { f.t.value = "Onboarding comparison brief"; f.b.value = "Compare setup, the first useful action and how each product explains the next step. Focus on first-time users."; }
    });
    wirePrep();
    $(".composer", pane).onsubmit = (e) => {
      e.preventDefault(); const inp = $("input", e.target); const v = inp.value.trim(); if (!v) return;
      inp.value = "";
      const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const add = (html) => { const n = h(html); n.classList.add("tab-pane"); msgs.appendChild(n); msgs.scrollTo({ top: msgs.scrollHeight, behavior: "smooth" }); return n; };
      add(msgHTML(["you", v, now]));
      const typing = add(`<div class="msg agent"><div class="av sm ${a.p}">${a.name[0]}</div><div class="typing"><i></i><i></i><i></i></div></div>`);
      setTimeout(() => { typing.remove(); streamIn(add(msgHTML(["agent", "Understood. When you want me to act on this, I can turn it into a task brief for you to review first.", now, true]))); wirePrep(); }, 1400);
    };
  },
  task: (a, pane, el) => {
    let pick = null;
    $$(".opt", pane).forEach((o) => o.onclick = () => { $$(".opt", pane).forEach((x) => x.classList.remove("on")); o.classList.add("on"); pick = o.textContent; $("[data-act=answer]", pane).disabled = false; });
    const ans = $("[data-act=answer]", pane);
    if (ans) ans.onclick = () => { toast(`Answer sent: “${pick}” — ${a.name} continues the run`); };
    const f = $(".task-new", pane);
    if (f) {
      f.onsubmit = (e) => { e.preventDefault(); toast(f.t.value ? `“${f.t.value}” started with ${providerLabel[a.p]}` : "Give the task a title first"); };
      $("[data-act=save]", f).onclick = () => toast("Saved as planned. Start it when you're ready.");
    }
  },
  context: (a, pane) => $$(".ctx-item", pane).forEach((b) => b.onclick = () => go("library")),
  results: (a, pane) => { const r = $("[data-act=review]", pane); if (r) r.onclick = () => go("inbox", { inboxId: a.id }); },
};

/* ---------- menu ---------- */
VIEWS.menu = () => {
  const items = [["team", "Your team", "16 agents", "overview"], ["inbox", "Inbox", null, "inbox", 3], ["folder", "Projects", null, "projects"], ["handoff", "Handoffs", null, "handoff"], ["file", "Memory & files", null, "library"], ["plug", "Connections", null, "connections"]];
  const p = h(`<div class="panel teal menu" style="left:570px;top:58px;width:460px;height:648px" data-enter="rise">
    <div class="handle"></div><button class="x" aria-label="Close">✕</button>
    <div class="h-xl" style="margin:26px 0 18px">Worklive</div>
    <label class="search">${ico("search", 20)}<input placeholder="Find a file…" aria-label="Find a file"><kbd>⌘ K</kbd></label>
    <div class="menu-list stagger">${items.map(([i, t, s, g, b]) => `<button class="mi" data-go="${g}"><span class="mi-i">${ico(i, 22)}</span><span class="mi-t">${t}${s ? `<small>${s}</small>` : ""}</span>${b ? `<b class="mbadge">${b}</b>` : ""}<span class="arr">→</span></button>`).join("")}</div>
    <button class="mi create" data-go="create"><span class="plus">+</span><span class="mi-t">Create agent</span><span class="arr">→</span></button>
    <div class="row muted small" style="margin-top:14px;padding:0 6px;gap:8px">${ico("folder", 16)} Current project · <span style="color:var(--ink)">Website launch</span></div>
    <div class="row" style="margin-top:12px;gap:10px"><div class="prov"><span class="dot" style="--c:var(--teal)"></span>Codex · Ready</div><div class="prov"><span class="dot" style="--c:var(--terra)"></span>Claude Code · Ready</div></div>
  </div>`);
  $(".x", p).onclick = back;
  $$("[data-go]", p).forEach((b) => b.onclick = () => go(b.dataset.go));
  $(".search input", p).addEventListener("input", (e) => { const q = e.target.value.toLowerCase(); $$(".mi", p).forEach((m) => m.style.opacity = !q || m.textContent.toLowerCase().includes(q) ? 1 : .25); });
  return [p, h(`<div class="corner">Esc to return</div>`)];
};

/* ---------- inbox ---------- */
let inboxPick = null;
VIEWS.inbox = () => {
  const cards = WL.inbox.map((it, i) => {
    const a = byId(it.id);
    const tag = { question: ["Needs your answer", "var(--amber)"], paused: ["Paused", "var(--grey)"], review: ["Ready for review", "var(--terra)"] }[it.kind];
    const c = h(`<div class="side-card ${a.p === "codex" ? "teal" : "terra"} ib-card ${state.inboxId === it.id ? "sel" : ""}" style="left:${34 + i * 196}px;top:${196 + i * 6}px;width:${i === 2 ? 200 : 184}px;height:${i === 2 ? 340 : 330}px;transform:rotateY(${18 - i * 4}deg)" data-enter="left" tabindex="0">
      <div class="row between"><div class="av ${a.p}">${a.name[0]}</div><span class="tagp"><span class="dot" style="--c:${tag[1]}"></span>${tag[0]}</span></div>
      <div class="serif" style="font-size:19px;margin-top:12px">${a.name}</div><div class="serif" style="font-size:17px;line-height:1.2">${it.title}</div>
      <p class="tiny muted" style="margin-top:8px;line-height:1.5">${it.text}</p>
      ${it.options ? it.options.map((o) => `<div class="ib-opt">${o}</div>`).join("") : it.kind === "review" ? `<div class="m-img" style="height:90px;margin-top:10px"></div>` : `<div class="bars"><i></i><i style="width:80%"></i><i style="width:60%"></i></div>`}
      <div class="grip-s"><span class="dot" style="--c:var(--${a.p === "codex" ? "teal" : "terra"})"></span>${a.name} / ${providerLabel[a.p]}</div></div>`);
    c.onclick = () => { state.inboxId = it.id; swapInboxMain(); $$(".ib-card").forEach((x) => x.classList.toggle("sel", x === c)); };
    return c;
  });
  const main = h(`<div class="panel terra ib-main" style="left:690px;top:80px;width:870px;height:600px" data-enter="right"></div>`);
  const pick = (dir) => {
    const i = WL.inbox.findIndex((x) => x.id === state.inboxId), n = WL.inbox.length;
    const j = Math.max(0, Math.min(n - 1, i + dir)); if (j === i) return;
    state.inboxId = WL.inbox[j].id; swapInboxMain();
    cards.forEach((c, k) => c.classList.toggle("sel", k === j));
  };
  let wheelLock = false, acc = 0;
  cards.forEach((c) => c.addEventListener("wheel", (e) => {
    e.preventDefault(); e.stopPropagation();
    acc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!wheelLock && Math.abs(acc) > 40) { pick(Math.sign(acc)); acc = 0; wheelLock = true; setTimeout(() => wheelLock = false, 380); }
  }, { passive: false }));
  inboxPick = pick;
  setTimeout(swapInboxMain, 0);
  return [...cards, main];
};
function swapInboxMain() {
  const main = $(".ib-main"); if (!main) return;
  const it = WL.inbox.find((x) => x.id === state.inboxId) || WL.inbox[2], a = byId(it.id);
  main.className = `panel ${a.p === "codex" ? "teal" : "terra"} ib-main`;
  let body;
  if (it.kind === "review") body = `<div class="row between"><div><div class="serif" style="font-size:26px">Launch plan.md</div><div class="status" style="font-size:16px;margin-top:4px"><span class="dot" style="--c:var(--terra)"></span>Ready for your review</div></div>
      <div class="seg" style="margin:0"><button class="on">Read</button><button>Edit</button><button>Sources</button></div></div>
    <div class="doc"><div class="h-xl" style="font-size:40px">Launch plan</div><p class="muted" style="margin:8px 0 18px;max-width:600px;line-height:1.5">A clear and focused plan to launch the updated experience, with an emphasis on a smooth rollout, user readiness and measurable outcomes.</p>
      <div class="doc-cols"><div><div class="h-m">1. Approach</div><p class="small" style="line-height:1.6;margin:8px 0">Release in phases, starting with a small group, then expanding based on feedback.</p>
      <ul class="dots"><li>Start with a closed beta</li><li>Gather feedback and iterate</li><li>Roll out in stages</li><li>Keep support ready</li></ul></div>
      <div><div class="h-m">2. Milestones</div><div class="ms">${["Finalize build and content", "Internal testing and feedback", "Limited release", "Broader rollout"].map((m, i) => `<div><i></i>${m}<span>Week ${i + 1}</span></div>`).join("")}</div></div></div>
      <div class="row small muted doc-meta"><span class="row">${ico("layers", 16)}3 sources</span><span class="row">${ico("file", 16)}Context received</span><span class="row">${ico("clock", 16)}Task history</span></div></div>
    <div class="row ib-actions"><button class="btn terra" data-act="accept">Mark accepted</button><button class="btn" data-act="rev">Send revision</button>
      <label class="field rev"><input placeholder="What should change?"><span>➤</span></label><button class="btn handoff-btn" data-act="handoff" disabled>${ico("link", 16)} Hand off after acceptance</button></div>`;
  else if (it.kind === "question") body = `<div class="qwrap" style="margin-top:40px"><div class="q-ico">?</div><div class="h-xl" style="font-size:38px;margin-top:16px">${it.title}</div>
      <p class="muted" style="margin:10px 0 22px">${a.name} asked during “Confirm audience” · 8 minutes ago</p><div class="opts">${it.options.map((o) => `<button class="opt">${o}</button>`).join("")}</div>
      <button class="btn teal" data-act="answer" disabled style="margin-top:22px">Send answer and continue</button></div>`;
  else body = `<div class="qwrap" style="margin-top:50px"><div class="p-ico" style="width:70px;height:70px;font-size:26px">II</div><div class="h-xl" style="font-size:38px;margin-top:16px">Sam is blocked</div>
      <p class="muted" style="margin:10px 0 22px;max-width:440px;text-align:center">${it.text}</p><div class="row"><button class="btn" data-act="open">Open blocked work</button><button class="btn teal" data-act="resume">Resume</button></div></div>`;
  main.innerHTML = `<div class="ib-inner tab-pane">${body}</div><div class="label-grip"><span class="dot"></span>${a.name} / ${providerLabel[a.p]}</div>`;
  let pick;
  $$(".opt", main).forEach((o) => o.onclick = () => { $$(".opt", main).forEach((x) => x.classList.remove("on")); o.classList.add("on"); pick = o.textContent; $("[data-act=answer]", main).disabled = false; });
  const on = (k, f) => { const b = $(`[data-act=${k}]`, main); if (b) b.onclick = f; };
  on("accept", (e) => { const b = e.currentTarget; b.innerHTML = `<svg class="okcheck" viewBox="0 0 16 16" width="16" height="16"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg> Accepted`; b.classList.add("accepted"); b.disabled = true; $("[data-act=handoff]", main).disabled = false; toast("Accepted. Sharing is still a separate step."); });
  on("rev", () => toast("Revision sent — Lena continues the same case"));
  on("handoff", () => go("handoff"));
  on("answer", () => toast(`Answer “${pick}” sent — Noor continues`));
  on("open", () => openAgent("sam"));
  on("resume", () => toast("Sam is still blocked on staging access"));
}

/* ---------- projects ---------- */
VIEWS.projects = () => {
  const P = WL.project, out = [];
  out.push(h(`<div class="proj-head" data-enter="drop"><div class="h-xl" style="font-size:54px">${P.title}</div><p class="muted" style="font-size:17px;margin-top:10px">${P.goal}</p>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="btn" data-act="brief">Edit brief</button><button class="btn" data-act="team">Manage team</button></div>
    <div class="row" style="justify-content:center;margin-top:14px;gap:8px">${P.team.map((id) => { const a = byId(id); return `<button class="chip" data-agent="${id}"><span class="av sm ${a.p}">${a.name[0]}</span>${a.name} / ${providerLabel[a.p]}</button>`; }).join("")}</div></div>`));
  const xs = [56, 360, 657, 954, 1250], rys = [12, 6, 0, -6, -12], tops = [238, 246, 252, 246, 238];
  P.columns.forEach((col, i) => {
    const c = h(`<div class="col ${col.warm ? "warm" : ""}" style="left:${xs[i]}px;top:${tops[i]}px;transform:rotateY(${rys[i]}deg)" data-enter="rise">
      <div class="row between"><div class="h-l">${col.title}</div><span class="muted">⋯</span></div><div class="small muted" style="margin:4px 0 14px">${col.sub}</div>
      <div class="col-items">${col.items.map((t) => { const a = byId(t.a); return `<div class="tcard"><div class="row between"><div class="serif" style="font-size:17px">${t.t}</div><span class="muted">⋯</span></div>
        <div class="row small" style="margin:8px 0"><span class="av sm ${a.p}">${a.name[0]}</span>${a.name} · ${providerLabel[a.p]}</div>
        <div class="row between small muted">${t.files ? `<span class="row" style="gap:6px">${ico("file", 15)}Task files · ${t.files}</span>` : `<span class="tiny">ⓘ ${t.note}</span>`}
        <button class="btn sm ${t.amber ? "amber" : t.disabled ? "" : "out-teal"}" ${t.disabled ? "disabled" : ""} data-go="${t.go || ""}">${t.action}</button></div>
        ${t.disabled && t.files ? `<div class="tiny muted" style="text-align:right;margin-top:4px">${t.note}</div>` : ""}</div>`; }).join("")}</div></div>`);
    out.push(c);
  });
  out.push(h(`<button class="add-task" data-enter="rise"><span class="plus-c">+</span><span><b>Add task</b><br><span class="small muted">Create a new task for this project</span></span></button>`));
  out.push(h(`<button class="proj-ctx" data-enter="rise">${ico("folder", 26)}<span><b>Project context · 4 files</b><br><span class="small muted">Brief, research, assets, notes</span></span></button>`));
  setTimeout(() => {
    $$("[data-go]", layer).forEach((b) => { if (!b.dataset.go) return; b.onclick = () => { const [v, id] = b.dataset.go.split(":"); v === "agent" ? openAgent(id) : v === "inbox" ? go("inbox", { inboxId: id }) : go(v); }; });
    $$("[data-agent]", layer).forEach((b) => b.onclick = () => openAgent(b.dataset.agent));
    const at = $(".add-task"); if (at) at.onclick = () => openTaskSheet();
    const pc = $(".proj-ctx"); if (pc) pc.onclick = () => go("library");
    $$("[data-act=brief],[data-act=team]", layer).forEach((b) => b.onclick = () => toast("Changes affect subsequent context, not running tasks"));
  }, 0);
  return out;
};
function openTaskSheet() {
  const scrim = h(`<div class="scrim"></div>`);
  const s = h(`<form class="panel neutral sheet-form" style="left:520px;top:150px;width:560px">
    <div class="h-l">New planned task</div><div class="small muted">Website launch</div>
    <div class="flabel">Title</div><input class="field" name="t" placeholder="e.g. Draft FAQ">
    <div class="flabel">Owner</div><div class="row owners">${WL.project.team.map((id) => { const a = byId(id); return `<button type="button" class="chip" data-o="${id}"><span class="av sm ${a.p}">${a.name[0]}</span>${a.name}</button>`; }).join("")}</div>
    <div class="flabel">Prerequisite</div><div class="row"><span class="chip">None</span><span class="chip">Launch plan</span></div>
    <div class="row" style="margin-top:22px;justify-content:flex-end"><button type="button" class="btn" data-x>Cancel</button><button class="btn teal">Save as planned</button></div></form>`);
  layer.append(scrim, s); enter(s, 0, "rise"); scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  const close = () => { s.animate([{ opacity: 1 }, { opacity: 0, translate: "0 30px" }], { duration: 300, fill: "forwards" }).finished.then(() => s.remove()); scrim.remove(); };
  scrim.onclick = close; $("[data-x]", s).onclick = close;
  $$("[data-o]", s).forEach((c) => c.onclick = () => { $$("[data-o]", s).forEach((x) => x.classList.remove("on")); c.classList.add("on"); });
  s.onsubmit = (e) => { e.preventDefault(); close(); toast("Planned. It starts only when you choose Start."); };
  $("input", s).focus();
}

/* ---------- library ---------- */
VIEWS.library = () => {
  const L = WL.library.project;
  const left = h(`<div class="side-card teal lib-side" style="left:90px;top:170px;width:280px;height:440px;transform:rotateY(22deg)" data-enter="left">
    <div class="mono" style="--c:var(--teal);width:66px;height:66px;font-size:30px">A</div><div style="font-size:21px;margin-top:20px">Personal · Ada</div><div class="muted">Private to Ada</div>
    <div class="lib-list">${[["note", "Notes"], ["check", "Drafts"], ["bookmark", "Saved"], ["gear", "Settings"]].map(([i, x]) => `<div class="row">${ico(i)}${x}</div>`).join("")}</div>
    <div class="grip-s"><span class="dot" style="--c:var(--teal)"></span>Ada / Codex</div></div>`);
  const right = h(`<div class="side-card lib-side" style="left:1250px;top:160px;width:270px;height:430px;transform:rotateY(-22deg)" data-enter="right">
    <div class="mono" style="--c:#8a979f;width:66px;height:66px;font-size:30px">C</div><div style="font-size:21px;margin-top:20px">Company</div><div class="muted">Shared with every agent</div>
    <div class="lib-list small">${[["team", "Team context"], ["file", "Guidelines"], ["template", "Templates"], ["stack", "Resources"]].map(([i, x]) => `<div class="row">${ico(i)}${x}</div>`).join("")}</div>
    <button class="proposal">! 1 proposal to review ›</button><div class="grip-s"><span class="dot" style="--c:var(--grey)"></span>Company memory</div></div>`);
  const main = h(`<div class="panel neutral lib" style="left:410px;top:86px;width:800px;height:560px" data-enter="rise">
    <div class="row between"><div class="row small" style="gap:8px">${ico("folder", 16)} Project · Website launch</div><div class="row small"><span class="pz">II</span> Work paused · <span class="muted">Context can be edited</span></div></div>
    <div class="row between" style="margin-top:14px"><div><div style="font-size:27px;font-weight:500;letter-spacing:-.01em;white-space:nowrap">Website launch / Shared context</div><div class="muted">Available to agents assigned to this project.</div></div>
    <div class="row" style="gap:6px"><button class="btn sm" data-t="Pinned" aria-label="Pin">${ico("pin", 16)}</button><button class="btn sm" data-t="Editing — saves a new version">Edit</button><button class="btn sm" data-t="Version history opened">History</button><button class="btn sm" data-t="Archived — restorable">Archive</button></div></div>
    <div class="lib-body"><div class="lib-files">${L.map((f, i) => `<button class="lf ${i === 1 ? "on" : ""}" data-i="${i}">${ico(f.pdf ? "pdf" : "file", 19)}${f.t}${f.pin ? `<span class="pin">${ico("pin", 16)}</span>` : ""}</button>`).join("")}</div><div class="lib-read"></div></div>
    <div class="drop">${ico("upload", 24)}<div><div>Add files to this project</div><div class="tiny muted">PDF · DOCX · TXT · MD · CSV · JSON — 10 MB per file</div></div><button class="btn sm" data-t="Choose an explicit scope before importing">Import…</button></div>
    <div class="label-grip"><span class="dot" style="--c:var(--grey)"></span>Project memory</div></div>`);
  const read = (i) => { const f = L[i], [t, sub, pts] = f.body;
    $(".lib-read", main).innerHTML = `<div class="tab-pane"><div style="font-size:24px">${t}</div><div class="muted" style="margin:6px 0 18px">${sub}</div><ul class="dots teal">${pts.map((p) => `<li>${p}</li>`).join("")}</ul><div class="lib-meta tiny muted">${f.meta}</div></div>`; };
  read(1);
  $$(".lf", main).forEach((b) => b.onclick = () => { $$(".lf", main).forEach((x) => x.classList.remove("on")); b.classList.add("on"); read(+b.dataset.i); });
  $$("[data-t]", main).forEach((b) => b.onclick = () => toast(b.dataset.t));
  $(".proposal", right).onclick = () => toast("Company proposal — publish only after review");
  return [left, right, main];
};

/* ---------- handoff ---------- */
VIEWS.handoff = () => {
  const left = h(`<div class="side-card terra" style="left:96px;top:196px;width:296px;height:440px;transform:rotateY(18deg)" data-enter="left">
    <div class="row between"><span class="muted">${ico("file", 30)}</span><span class="chip ok">✓ Accepted</span></div>
    <div class="serif" style="font-size:22px;margin-top:14px">Launch plan.md</div><div class="tiny muted">Last edited by Lena · Today 10:24</div>
    <div class="card" style="margin-top:18px;background:#f6f8f9"><div class="serif" style="font-size:17px">Project launch plan</div><div class="code-l">1. Goals<br>2. Audience<br>3. Key messages<br>4. Timeline<br>5. Next steps</div></div>
    <div class="small muted" style="margin-top:14px">Ready to hand off.</div><div class="grip-s"><span class="dot" style="--c:var(--terra)"></span>Lena / Claude Code</div></div>`);
  const flight = h(`<div class="flight" data-enter="drop"><div class="fdoc">${ico("file", 26)}</div><div class="tiny">Launch plan.md</div></div>`);
  const right = h(`<div class="side-card teal" style="left:1250px;top:188px;width:286px;height:450px;transform:rotateY(-18deg)" data-enter="right">
    <div class="row"><span class="muted">${ico("file", 30)}</span><div class="serif" style="font-size:21px">Ready for next task</div></div>
    <div class="m-img" style="height:90px;margin:24px 0"></div>${["Available for new work", "Context ready", "Standing by"].map((x) => `<div class="small muted ho-c">○ ${x}</div>`).join("")}
    <div class="grip-s"><span class="dot" style="--c:var(--teal)"></span>Sam / Codex</div></div>`);
  const main = h(`<form class="panel neutral ho" style="left:516px;top:86px;width:620px;height:620px" data-enter="rise">
    <div class="h-xl" style="font-size:40px">Hand off one reviewed file</div><div class="muted" style="font-size:18px;margin-top:4px">Project: <span style="color:var(--ink)">Website launch</span></div>
    <div class="ho-grid"><div class="small">File preview</div><div class="card row" style="align-items:flex-start;gap:14px"><div class="fthumb"></div><div><b>Launch plan.md</b><div class="tiny muted">Markdown document · 2.4 KB</div>
      <div class="code-l tiny"># Project launch plan<br>## 1. Goals<br>Introduce our product with a clear message…</div></div></div>
    <div></div><div class="tiny muted">Only this file and your brief are shared.</div>
    <div class="small">Recipient</div><div class="field row between"><span class="row"><span class="dot" style="--c:var(--teal)"></span>Sam · Codex</span><span>⌄</span></div>
    <div class="small">Next task</div><input class="field" value="Write the welcome guide">
    <div class="small">Brief</div><textarea class="field" rows="3">Use this launch plan to draft a concise first-use guide.</textarea></div>
    <label class="row small consent"><input type="checkbox" class="sr"><span class="cbox" aria-hidden="true"><svg viewBox="0 0 12 11" width="12" height="11"><path d="M1 5.52L3.92 9.17L10.5 1.5"/></svg></span> I reviewed this file and authorize sharing it with Sam for this project.</label>
    <div class="row" style="margin-top:14px"><button class="btn teal" style="flex:1" disabled>Queue handoff task</button><button type="button" class="btn" data-x style="width:110px">Cancel</button></div>
    <div class="tiny muted" style="margin-top:8px">Queued work starts only when you choose Start.</div>
    <div class="label-grip"><span class="dot" style="--c:var(--grey)"></span>Review sharing</div></form>`);
  const cb = $("input[type=checkbox]", main), q = $(".btn.teal", main);
  cb.onchange = () => q.disabled = !cb.checked;
  $("[data-x]", main).onclick = back;
  main.onsubmit = (e) => { e.preventDefault(); flight.classList.add("go"); setTimeout(() => rippleFrom(right, .8), 1150); q.textContent = "✓ Queued for Sam"; q.disabled = true; toast("Queued for Sam — start it separately"); };
  return [left, right, flight, main];
};

/* ---------- create agent ---------- */
VIEWS.create = () => {
  let prov = "claude";
  const p = h(`<form class="panel terra create" style="left:458px;top:86px;width:690px;height:540px" data-enter="rise">
    <div class="h-xl" style="text-align:center;font-size:44px;margin-top:8px">Meet your next teammate</div>
    <div class="row provs" style="justify-content:center;margin:20px auto 0;gap:16px;position:relative;width:max-content"><button type="button" class="provbtn" data-p="codex"><span class="dot" style="--c:var(--teal)"></span>Codex</button><button type="button" class="provbtn on" data-p="claude"><span class="dot" style="--c:var(--terra)"></span>Claude Code</button></div>
    <div class="tiny" style="text-align:center;margin-top:8px"><span class="dot" style="--c:var(--teal);display:inline-block;width:7px;height:7px"></span> Connection ready</div>
    <div class="cr-grid"><div><div class="flabel">Name</div><input class="field" name="n" value="Iris"><div class="flabel">Role</div><input class="field" value="Research editor">
      <div class="flabel">Personality</div><textarea class="field" rows="2">Precise, curious, and direct. Asks when a source is unclear.</textarea></div>
      <div class="cr-av"><div class="mono big">I</div><button type="button" class="link" style="text-decoration:underline">Appearance</button><p class="small muted" style="margin-top:22px;line-height:1.5">Memory stays with Iris when you change provider.</p></div></div>
    <div class="row" style="margin-top:20px"><button class="btn terra cbtn" style="width:220px">Create agent</button><button type="button" class="btn" data-x style="width:120px">Cancel</button></div>
    <div class="tiny muted" style="margin-top:8px">Creates an idle agent. Work starts separately.</div>
    <div class="label-grip"><span class="dot"></span><span class="lg-t">Iris / Claude Code</span></div></form>`);
  const slot = h(`<div class="slot" data-enter="right"><span>A new place in your team</span></div>`);
  const sync = () => {
    const n = p.n.value || "New agent";
    p.className = `panel ${prov === "codex" ? "teal" : "terra"} create`;
    $(".cbtn", p).className = `btn ${prov === "codex" ? "teal" : "terra"} cbtn`;
    $(".mono.big", p).textContent = n[0]?.toUpperCase() || "?";
    $(".mono.big", p).style.setProperty("--c", prov === "codex" ? "var(--teal)" : "var(--terra)");
    $(".lg-t", p).textContent = `${n} / ${providerLabel[prov]}`;
  };
  $$(".provbtn", p).forEach((b) => b.onclick = () => { prov = b.dataset.p; $$(".provbtn", p).forEach((x) => x.classList.toggle("on", x === b)); movePill($(".provs", p)); sync(); });
  setTimeout(() => movePill($(".provs", p), true), 0);
  p.n.oninput = sync; sync();
  $("[data-x]", p).onclick = back;
  p.onsubmit = (e) => {
    e.preventDefault();
    p.animate([{ opacity: 1, translate: "0 0 0", scale: "1" }, { opacity: 0, translate: "520px 160px -500px", scale: ".35" }], { duration: 900, easing: ease, fill: "forwards" });
    slot.classList.add("filled"); slot.innerHTML = `<span class="mono" style="--c:${prov === "codex" ? "var(--teal)" : "var(--terra)"}">${p.n.value[0] || "?"}</span><span>${p.n.value} · Idle</span>`;
    setTimeout(() => rippleFrom(slot, .9), 700);
    toast(`${p.n.value} joined your team — idle until you start a task`);
    setTimeout(() => go("overview"), 1500);
  };
  return [p, slot];
};

/* ---------- connections ---------- */
VIEWS.connections = () => {
  const card = (k, name, ok, x, ry) => h(`<div class="panel ${k === "codex" ? "teal" : "terra"} conn" style="left:${x}px;top:140px;width:356px;height:440px;transform:rotateY(${ry}deg)" data-enter="${k === "codex" ? "left" : "right"}">
    <div class="mono" style="--c:var(--${k === "codex" ? "teal" : "terra"});width:62px;height:62px;font-size:28px">C</div><div class="h-xl" style="font-size:40px;margin-top:12px">${name}</div>
    <div class="cstate ${ok ? "ok" : "warn"}"><span class="dot" style="--c:${ok ? "var(--teal)" : "var(--amber)"}"></span><span>${ok ? "Connected" : "Sign in needed"}</span></div>
    <p class="muted cdesc">${ok ? "Your official tool is ready." : "Open the official tool, sign in there, then check the connection here."}</p>
    <div class="cbtns"><button class="btn ${ok ? "teal" : "terra"}" data-a="${ok ? "check" : "open"}">${ok ? "Check connection →" : "Open official tool ↗"}</button><button class="btn" data-a="${ok ? "open" : "check"}">${ok ? "Open official tool ↗" : "Check connection →"}</button></div>
    <div class="label-grip"><span class="dot"></span>${name}</div></div>`);
  const a = card("codex", "Codex", true, 420, 4), b = card("claude", "Claude Code", false, 822, -4);
  const cont = h(`<div class="cont" data-enter="rise"><button class="btn teal" style="height:50px;width:340px;font-size:16px">Continue with Codex →</button><div class="small muted" style="margin-top:14px;line-height:1.6;text-align:center">You can connect the other provider later.<br>Sign-in stays in the official tools.</div></div>`);
  [a, b].forEach((c) => $$("[data-a]", c).forEach((btn) => btn.onclick = () => {
    if (btn.dataset.a === "open") return toast("Opens the official CLI in Terminal — credentials never pass through Worklive");
    btn.innerHTML = `<span class="spin"></span> Checking…`;
    setTimeout(() => {
      if (c === b) { $(".cstate", b).className = "cstate ok"; $(".cstate span:last-child", b).textContent = "Connected"; $(".cstate .dot", b).style.setProperty("--c", "var(--teal)"); $(".cdesc", b).textContent = "Your official tool is ready."; $("button", cont).textContent = "Continue →"; }
      btn.innerHTML = "Check connection →"; toast(c === b ? "Claude Code connected" : "Codex is ready");
    }, 1300);
  }));
  $("button", cont).onclick = () => go("create");
  return [a, b, cont];
};

/* ---------- cases ---------- */
// A small reusable rail: wheel/trackpad/drag move a value that eases and snaps to whole items.
// Same model as the team carousel (OptionWheel-style notch steps, FlexCarousel-style flick).
function makeRail(el, { max, apply, stepPx = 180 }) {
  const R = { cur: 0, t: 0, raf: 0, last: 0, held: false };
  const clamp = (v, give = 0) => Math.max(-give, Math.min(max() + give, v));
  const tick = (now) => {
    const dt = Math.min(.05, (now - (R.last || now)) / 1000); R.last = now;
    R.cur += (R.t - R.cur) * (reduced ? 1 : 1 - Math.pow(.0009, dt));
    if (Math.abs(R.t - R.cur) < .002) R.cur = R.t;
    apply(R.cur);
    if (R.cur === R.t && !R.held) { R.raf = 0; R.last = 0; return; }
    R.raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!R.raf) R.raf = requestAnimationFrame(tick); };
  let snapT;
  const snap = () => { clearTimeout(snapT); snapT = setTimeout(() => { if (!R.held) { R.t = clamp(Math.round(R.t)); kick(); } }, 140); };
  R.go = (v) => { R.t = clamp(v); kick(); };
  R.step = (d) => R.go(Math.round(R.t) + d);
  el.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;
    e.preventDefault(); e.stopPropagation();
    let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    if (e.deltaMode === 1 || (Math.abs(d) >= 50 && e.deltaX === 0)) { if (!R.lock) { R.step(Math.sign(d)); R.lock = true; setTimeout(() => R.lock = false, 90); } return; }
    R.t = clamp(R.t + Math.max(-.6, Math.min(.6, d / 300)), .35); kick(); snap();
  }, { passive: false });
  let dr = null;
  el.addEventListener("pointerdown", (e) => { if (e.button === 0 && !e.target.closest("input")) dr = { x: e.clientX, t0: R.t, moved: false, v: 0, lx: e.clientX, lt: performance.now() }; });
  el.addEventListener("pointermove", (e) => {
    if (!dr) return; const dx = e.clientX - dr.x;
    if (!dr.moved && Math.abs(dx) > 5) { dr.moved = true; R.held = true; el.setPointerCapture(e.pointerId); }
    if (!dr.moved) return;
    const now = performance.now(); dr.v = (e.clientX - dr.lx) / Math.max(1, now - dr.lt); dr.lx = e.clientX; dr.lt = now;
    const scale = stage.getBoundingClientRect().width / 1600;
    R.t = clamp(dr.t0 - dx / scale / stepPx, .35); kick();
  });
  const up = () => {
    if (dr && dr.moved) {
      R.held = false; R.go(Math.round(R.t - dr.v * 1.4));
      el.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); }, { capture: true, once: true });
      setTimeout(() => { el.dispatchEvent(new Event("dragdone")); }, 0);
    }
    dr = null;
  };
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  return R;
}

let shelfRail = null;
function casesView() {
  if (!state.caseId) state.caseId = "c024";
  const shelf = h(`<div class="shelf" data-enter="left"><label class="shelf-search">${ico("search", 16)}<input placeholder="Search cases…" aria-label="Search cases"></label><div class="folios" tabindex="0" aria-label="Cases — scroll or use arrow keys"></div>
    <div class="pager"><button data-d="-1" aria-label="Previous">‹</button><span class="pg"></span><span class="pg-rail"><i></i></span><button data-d="1" aria-label="Next">›</button></div></div>`);
  const main = h(`<div class="folio-open" data-enter="right"><div class="ftabs"><i></i><i></i><i></i></div><div class="fo-body"></div></div>`);
  const track = $(".folios", shelf);
  let q = "", list = [];
  const VISIBLE = 3;
  const apply = (off) => {
    $$(".folio", track).forEach((f, i) => {
      const d = i - off;
      f.style.translate = `${d * 178}px ${d * -8}px`;
      f.style.transform = `rotateY(${10 + Math.max(0, d - 1) * 3}deg) rotateX(4deg)`;
      f.style.opacity = d < -.6 ? Math.max(0, 1 + (d + .6) / .5) : d > VISIBLE - .4 ? Math.max(0, 1 - (d - VISIBLE + .4) / .5) : 1;
      f.style.zIndex = 50 - i;
      f.style.pointerEvents = d < -.5 || d > VISIBLE - .5 ? "none" : "";
    });
    const n = Math.max(1, list.length - VISIBLE + 1);
    $(".pg", shelf).textContent = `${Math.min(n, Math.round(off) + 1)} / ${n}`;
    const frac = n > 1 ? off / (n - 1) : 0;
    $(".pg-rail i", shelf).style.transform = `translateX(${Math.max(0, Math.min(1, frac)) * 34}px)`;
  };
  shelfRail = makeRail(track, { max: () => Math.max(0, list.length - VISIBLE), apply, stepPx: 178 });
  const drawShelf = () => {
    list = WL.cases.filter((c) => (c.title + c.n + c.project).toLowerCase().includes(q));
    track.innerHTML = list.map((c, i) => `<button class="folio ${c.id === state.caseId ? "sel" : ""}" data-c="${c.id}" style="--i:${Math.min(i, 3)}">
      <span class="ftab"></span><span class="serif ft">${c.title}</span><span class="tiny muted">Case ${c.n}<br>${c.updated}</span></button>`).join("") || `<div class="small muted" style="padding:40px">No matching cases</div>`;
    $$(".folio", track).forEach((f) => f.onclick = () => { state.caseId = f.dataset.c; $$(".folio", track).forEach((x) => x.classList.toggle("sel", x === f)); drawCase(main, true); });
    shelfRail.go(Math.min(shelfRail.t, Math.max(0, list.length - VISIBLE))); apply(shelfRail.cur);
  };
  $("input", shelf).oninput = (e) => { q = e.target.value.toLowerCase(); shelfRail.go(0); drawShelf(); };
  $$(".pager button", shelf).forEach((b) => b.onclick = () => shelfRail.step(+b.dataset.d));
  track.addEventListener("keydown", (e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); shelfRail.step(e.key === "ArrowRight" ? 1 : -1); } });
  drawShelf(); drawCase(main);
  return [shelf, main];
}
VIEWS.cases = casesView;
VIEWS.overview = () => state.mode === "cases" ? casesView() : [];

const CASE_TABS = ["Overview", "Files", "Sources", "Conversation", "History"];
function drawCase(main, animate) {
  const c = WL.cases.find((x) => x.id === state.caseId), a = byId(c.agent);
  const st = { review: ["Ready for review", "var(--teal)"], paused: ["Paused", "var(--grey)"], question: ["Needs your answer", "var(--amber)"], working: ["Working", "var(--teal)"] }[c.status];
  const body = $(".fo-body", main);
  if (animate && !reduced) main.animate([{ translate: "0 0 0" }, { translate: "0 -14px 40px" }, { translate: "0 0 0" }], { duration: 700, easing: ease });
  body.innerHTML = `<div class="tab-pane"><div class="row between"><div class="small muted">${c.project} / Case ${c.n}</div><button class="link small row" data-x="export" style="gap:6px">${ico("export", 16)}Export case</button></div>
    <div class="h-xl" style="margin-top:4px;font-size:42px">${c.title}</div><div class="muted" style="font-size:18px;margin-top:4px">${c.goal}</div>
    <span class="chip" style="margin-top:10px"><span class="dot" style="--c:${st[1]}"></span>${st[0]}</span>
    <div class="tabs ctabs" style="--pc:var(--ink-2);margin-top:16px">${CASE_TABS.map((t, i) => `<button data-t="${i}" class="${i ? "" : "on"}">${t}${t === "Files" ? ` <b class="cnt">${c.files.length}</b>` : t === "Sources" ? ` <b class="cnt">${c.sources}</b>` : ""}</button>`).join("")}<span class="ink"></span></div>
    <div class="ctab-body"></div>
    <div class="tiny muted fo-foot">${c.files.length} files · ${c.sources} sources · ${c.messages} messages · ${c.runs} runs</div></div>
    <div class="fo-grip">Case ${c.n} · ${c.title}</div>`;
  const tb = $(".ctab-body", body), ink = $(".ctabs .ink", body);
  const show = (i) => {
    $$(".ctabs button", body).forEach((b, j) => b.classList.toggle("on", i === j));
    const on = $(".ctabs button.on", body); requestAnimationFrame(() => { ink.style.left = on.offsetLeft + "px"; ink.style.width = on.offsetWidth + "px"; });
    tb.innerHTML = `<div class="tab-pane">${CASE_PANES[i](c, a)}</div>`;
    const cta = $("[data-cta]", tb); if (cta) cta.onclick = () => c.status === "review" ? go("inbox", { inboxId: a.id === "ada" ? "lena" : a.id }) : c.status === "question" ? go("inbox", { inboxId: "noor" }) : openAgent(a.id);
    const cont = $("[data-cont]", tb); if (cont) cont.onclick = () => toast("Reading a case never starts work. Continue needs a manual start.");
  };
  $$(".ctabs button", body).forEach((b) => b.onclick = () => show(+b.dataset.t));
  $("[data-x=export]", body).onclick = () => toast("Export includes only the authorized contents you select");
  show(0);
}
const CASE_PANES = [
  (c) => `<div class="co-grid"><div><div class="h-m">What we have</div><div class="fcards">${c.files.map(([n, k]) => `<div class="fcard"><div class="fprev k-${k}"><span class="ftype k-${k}"></span>${k === "doc" ? `<div class="m-img"></div>` : `<div class="bars"><i></i><i style="width:70%"></i><i style="width:85%"></i></div>`}</div><div class="small">${n}</div></div>`).join("")}</div>
      <div class="card row small" style="margin-top:12px;color:var(--ink-2)">${ico("attach", 16)}Attached context · product-brief.pdf</div></div>
    <div class="co-act"><div class="h-m">Decisions & activity</div><div class="tl">${c.activity.map(([t, who, what, k]) => `<div class="tl-i ${k}"><i></i><div><span>${t} · ${who}</span><div class="muted">${what}</div></div></div>`).join("")}</div></div></div>
    <div class="next row between"><span style="font-size:17px">Next: ${c.next.toLowerCase()}</span><button class="btn teal" data-cta>${c.cta}</button></div>`,
  (c) => `<div class="flist">${c.files.map(([n, k], i) => `<div class="fl-row"><span class="fi k-${k}">${ico(k === "sheet" ? "grid" : k === "note" ? "note" : "file", 20)}</span><div style="flex:1"><div>${n}</div><div class="tiny muted">v${c.files.length - i + 1} · managed output · ${["Today 09:42", "Today 09:24", "Yesterday"][i] || "Earlier"}</div></div><span class="tiny muted">${i ? "Uploaded context" : "Generated"}</span><button class="btn sm">Preview</button></div>`).join("")}
    <div class="fl-row muted"><span class="fi">${ico("file", 20)}</span><div style="flex:1">Findings v1 <span class="tiny">· superseded</span></div><button class="btn sm">Open</button></div></div>`,
  (c) => `<div class="flist">${Array.from({ length: Math.min(c.sources, 5) }, (_, i) => `<div class="fl-row"><span class="fi">${ico("globe", 20)}</span><div style="flex:1"><div>example.com/${["onboarding", "setup-guide", "help/start", "docs/first-run", "blog/calm-start"][i]}</div><div class="tiny muted">Captured 09:${(14 + i * 2).toString().padStart(2, "0")} · text snapshot (not a full archive)</div></div><button class="btn sm">Captured text</button></div>`).join("")}</div>`,
  (c, a) => `<div class="cconv"><div class="msg you"><div class="row between tiny"><b>Task brief</b><span class="muted">09:08</span></div><div>${c.goal}</div></div>
    <div class="msg agent"><div class="av sm ${a.p}">${a.name[0]}</div><div><div class="tiny"><b>${a.name}</b></div>Should I focus on first-time users or returning ones?</div></div>
    <div class="msg you"><div class="row between tiny"><b>You</b><span class="muted">09:10</span></div><div>Focus on first-time users.</div></div></div>
    <div class="composer"><span class="case-in row" style="gap:6px">${ico("folder", 14)}${c.title}</span><input class="field" placeholder="Add to this case…"><button class="btn" data-cont>Continue…</button></div>`,
  (c, a) => `<div class="tl hist">${[["09:08", "System", "Case created · task linked", "sys"], ["09:10", "You", "Decision: focus on first-time users", "user"], ["09:12", a.name, "Run 1 started", "agent"], ["09:24", a.name, "Saved six sources (recorded)", "agent"], ["09:31", "System", "Run 1 interrupted · provider limit", "sys"], ["09:33", a.name, "Run 2 · continuation of run 1", "agent"], ["09:42", a.name, "Findings v2 — ready for review, not accepted", "agent"]].map(([t, w, x, k]) => `<div class="tl-i ${k}"><i></i><div><span>${t} · ${w}</span><div class="muted">${x}</div></div></div>`).join("")}</div>`,
];

/* ---------- scroll: team carousel ---------- */
// Wheel, trackpad, drag and arrow keys all drive one target; the view eases toward it,
// then snaps to the nearest resting position. Transitions are paused while it moves.
const clampS = (v, give = 0) => Math.max(SC_MIN - give, Math.min(SC_MAX + give, v));
function scrollTick(now) {
  const dt = Math.min(.05, (now - (SC.last || now)) / 1000); SC.last = now;
  const k = reduced ? 1 : 1 - Math.pow(.0009, dt);
  SC.cur += (SC.t - SC.cur) * k;
  if (Math.abs(SC.t - SC.cur) < .0015) SC.cur = SC.t;
  if (state.view === "overview" && state.mode === "agents") applyLayout(overviewLayout());
  updateScrub();
  window.WLBG?.trackSheets(sheetFootprints, 250);
  if (SC.cur === SC.t && !SC.held) { SC.raf = 0; SC.last = 0; world.classList.remove("scrolling"); return; }
  SC.raf = requestAnimationFrame(scrollTick);
}
function kickScroll() {
  world.classList.add("scrolling");
  if (!SC.raf) SC.raf = requestAnimationFrame(scrollTick);
}
function snapSoon(ms = 140) {
  clearTimeout(SC.snapT);
  SC.snapT = setTimeout(() => { if (!SC.held) { SC.t = clampS(Math.round(SC.t)); kickScroll(); } }, ms);
}
function scrollBy(items) { SC.t = clampS(Math.round(SC.t) + items); kickScroll(); }
const carouselOn = () => state.view === "overview" && state.mode === "agents";

stage.addEventListener("wheel", (e) => {
  if (e.ctrlKey) return; // pinch-zoom
  if (carouselOn()) {
    e.preventDefault();
    let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    // notched mouse wheel: one sheet per click; trackpad: continuous, then snap
    const notched = e.deltaMode === 1 || (Math.abs(d) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
    if (notched) { if (!SC.notchLock) { scrollBy(Math.sign(d)); SC.notchLock = true; setTimeout(() => SC.notchLock = false, 90); } return; }
    SC.t = clampS(SC.t + Math.max(-.6, Math.min(.6, d / 420)), .35);
    kickScroll(); snapSoon();
  } else if (state.view === "agent" && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
    // horizontal swipe turns the ring to the neighbouring agent
    e.preventDefault();
    SC.swipe = (SC.swipe || 0) + e.deltaX;
    if (Math.abs(SC.swipe) > 90 && !SC.swipeLock) { stepAgent(Math.sign(SC.swipe)); SC.swipe = 0; SC.swipeLock = true; setTimeout(() => SC.swipeLock = false, 650); }
    clearTimeout(SC.swipeT); SC.swipeT = setTimeout(() => SC.swipe = 0, 200);
  }
}, { passive: false });

// drag anywhere on the landscape; a drag never counts as a click
let drag = null;
world.addEventListener("pointerdown", (e) => {
  if (!carouselOn() || e.button !== 0) return;
  drag = { x: e.clientX, t0: SC.t, moved: false, v: 0, lx: e.clientX, lt: performance.now(), id: e.pointerId };
});
addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, scale = stage.getBoundingClientRect().width / 1600;
  if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; SC.held = true; world.setPointerCapture?.(drag.id); world.classList.add("dragging"); }
  if (!drag.moved) return;
  const now = performance.now();
  drag.v = (e.clientX - drag.lx) / Math.max(1, now - drag.lt); drag.lx = e.clientX; drag.lt = now;
  SC.t = clampS(drag.t0 - dx / scale / 250, .35); kickScroll();
});
addEventListener("pointerup", () => {
  if (!drag) return;
  if (drag.moved) {
    SC.held = false; world.classList.remove("dragging");
    SC.t = clampS(Math.round(SC.t - drag.v * 1.6)); kickScroll();
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", swallow, { capture: true }), 50);
  }
  drag = null;
});

function stepAgent(dir) {
  const ring = ringOf(state.agent), i = ring.indexOf(state.agent);
  const next = ring[(i + dir + ring.length) % ring.length];
  state.stack.pop(); // stepping sideways is not a deeper level
  go("agent", { agent: next, tab: state.tab === "chat" ? "chat" : "browser" });
}

/* scroll position indicator */
const scrub = h(`<div id="scrub" aria-hidden="true"><i></i></div>`);
stage.appendChild(scrub);
function updateScrub() {
  const span = SC_MAX - SC_MIN, frac = span ? (SC.cur - SC_MIN) / span : 0;
  scrub.firstChild.style.transform = `translateX(${frac * 56}px)`;
}

/* ---------- boot ---------- */
buildSheets();
$$("#dock button").forEach((b) => b.onclick = () => {
  const v = b.dataset.go;
  if (v === state.view && v !== "overview") return;
  v === "overview" ? (state.stack = [], Object.assign(state, { view: "overview", mode: "agents", agent: null }), render()) : go(v);
});
$$("#toggle button").forEach((b) => b.onclick = () => { if (state.mode === b.dataset.mode) return; state.mode = b.dataset.mode; state.view = "overview"; state.agent = null; render(); });
$("#back").onclick = back;
$("#search-btn").onclick = () => go("menu");
$("#project-filter").onclick = () => toast("Project filter is a view filter — it never reassigns agents");
addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if ($(".scrim")) return $(".scrim").click(); back(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); go("menu"); setTimeout(() => $(".menu .search input")?.focus(), 500); }
  if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (carouselOn() && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); scrollBy(e.key === "ArrowRight" ? 1 : -1); }
  if (state.view === "agent" && (e.key === "ArrowRight" || e.key === "ArrowLeft") && !document.activeElement.closest?.(".tabs")) { e.preventDefault(); stepAgent(e.key === "ArrowRight" ? 1 : -1); }
  if (carouselOn() && /^[1-8]$/.test(e.key)) openAgent(FRONT[+e.key - 1]);
  if (state.view === "inbox" && inboxPick && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); inboxPick(e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1); }
});
// pointer: perspective drift + specular light on glass
const po = { x: 0, y: 0, tx: 0, ty: 0 }; let poRaf = 0;
function poLoop() {
  po.x += (po.tx - po.x) * .08; po.y += (po.ty - po.y) * .08;
  const v = `${50 + po.x * 3.2}%`, w = `${42 + po.y * 2.4}%`;
  world.style.setProperty("--po-x", v); world.style.setProperty("--po-y", w);
  world.style.setProperty("--sway", (po.x * 8).toFixed(2));
  layer.style.setProperty("--po-x", `${50 + po.x * 1.6}%`); layer.style.setProperty("--po-y", `${42 + po.y * 1.2}%`);
  poRaf = Math.abs(po.tx - po.x) + Math.abs(po.ty - po.y) > .001 ? requestAnimationFrame(poLoop) : 0;
}
if (!reduced) addEventListener("pointermove", (e) => {
  po.tx = e.clientX / innerWidth * 2 - 1; po.ty = e.clientY / innerHeight * 2 - 1;
  if (!poRaf) poRaf = requestAnimationFrame(poLoop);
  const f = e.target.closest && e.target.closest(".face");
  if (f) { const r = f.getBoundingClientRect(); f.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100) + "%"); f.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100) + "%"); }
}, { passive: true });
// Real glass (WebGL, see bg.js) behind the dock, the view toggle, the case tabs and every
// agent sheet. Each pane follows its element's projected corners; the HTML keeps the content.
const sheetOf = (el) => el.closest(".sheet");
const sheetAlpha = (el) => {
  const sh = sheetOf(el);
  if (!sh || sh.classList.contains("focused")) return 0;
  return +(sh.style.getPropertyValue("--op") || 1);
};
function syncGlass() {
  if (!window.WLBG?.glassEl) return;
  document.body.classList.add("gl-glass");
  WLBG.glassEl($("#dock"), { radius: 32, bezel: 26, thickness: 46, frost: .1 });
  WLBG.glassEl($("#toggle"), { radius: 21, bezel: 12, thickness: 24, frost: .08, alpha: (el) => (el.classList.contains("is-hidden") || el.closest(".is-hidden") ? 0 : 1) });
  WLBG.glassEl($("#project-filter"), { radius: 21, bezel: 12, thickness: 24, frost: .08 });
  WLBG.glassEl($("#search-btn"), { radius: 21, bezel: 12, thickness: 26, frost: .08 });
  const provColor = (el) => (sheetOf(el).classList.contains("claude") ? "#D97757" : "#2D9D8F");
  $$(".sheet:not(.ghost) .face", world).forEach((f) => WLBG.glassEl(f, {
    radius: 22, bezel: 22, thickness: 56, color: provColor(f), alpha: sheetAlpha,
    frost: (el) => { const sh = sheetOf(el); return sh.classList.contains("deep") ? .22 : sh.classList.contains("glass") ? .08 : .12; },
  }));
  // the name pill and the case tab are small glass: clear, with their own light edge
  $$(".sheet:not(.ghost) .grip", world).forEach((g) => WLBG.glassEl(g, {
    radius: 9, bezel: 7, thickness: 14, frost: .35, alpha: sheetAlpha,
  }));
  $$(".casetab", world).forEach((t) => WLBG.glassEl(t, {
    radius: 8, bezel: 6, thickness: 12, frost: .22,
    alpha: (el) => { const sh = sheetOf(el); return sh.classList.contains("side") ? 0 : sheetAlpha(el); },
  }));
  WLBG.trackSheets(null, 1200);
}
// hover lifts a sheet; let the glass follow while it moves
world.addEventListener("pointerover", (e) => { if (e.target.closest(".sheet")) window.WLBG?.trackSheets(null, 700); });
addEventListener("resize", () => requestAnimationFrame(syncGlass));
// the shader module loads after app.js — sync it once it exists
const bgWait = setInterval(() => { if (window.WLBG) { clearInterval(bgWait); syncBg(); syncGlass(); } }, 120);
setTimeout(() => clearInterval(bgWait), 8000);
// first paint: rise sheets out of the mist
applyLayout(awayLayout());
requestAnimationFrame(() => requestAnimationFrame(() => render()));
