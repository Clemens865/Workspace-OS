// ── Surface content (compact but representative) ──
const S = {};
S.files = `<div class="pad"><h1>Files</h1><div class="lede">Everything in your workspace.</div>
<div style="display:grid;grid-template-columns:240px 1fr;gap:18px">
<div class="gcard" style="padding:10px">
 <div class="prow" data-open="report"><svg class="ic" viewBox="0 0 24 24"><path d="M8 4h8l4 4v12H4V4z"/></svg> report.docx</div>
 <div class="prow" data-open="budget"><svg class="ic" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg> budget.xlsx</div>
 <div class="prow"><svg class="ic" viewBox="0 0 24 24"><path d="M4 5h16v11H4z"/><path d="M9 20h6"/></svg> deck.pptx</div>
 <div class="prow"><svg class="ic" viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg> notes/</div>
</div>
<div class="gcard"><b>report.docx</b><div class="muted" style="margin-top:6px">Modified 2 min ago · 4 pages</div><div style="margin-top:14px"><button class="b blue" data-open="report">Open</button></div></div>
</div></div>`;
S.report = `<div class="ribbon"><div class="rtabs"><b class="on">Home</b><b>Insert</b><b>Layout</b><b>References</b><b>Review</b><b>View</b></div>
<div class="rtools"><span class="rt">Styles ▾</span><span class="rt b">B</span><span class="rt i">i</span><span class="rt u">U</span><span class="rsep"></span><span class="rt">☰ Lists</span><span class="rt">▦ Table</span><span class="rt">📈 Chart</span><span class="rt">🔗 Live value</span><span class="rsep"></span><span class="rt">Find & replace</span><span class="rt">Track changes</span></div></div>
<div class="pad" style="max-width:760px"><div class="gcard" style="padding:36px 44px">
<div style="font-size:22px;font-weight:640;letter-spacing:-.02em;margin-bottom:14px">Q3 Business Review</div>
<p class="muted" style="font-size:15px;line-height:1.7">Revenue grew across all regions this quarter. Total company revenue reached <span style="color:var(--ink);font-weight:600;border-bottom:2px solid var(--ok)">€4.82M</span> <span style="font-size:12px;color:var(--ok)">● live</span>, up 14% year-on-year, driven by the enterprise segment.</p>
<div class="grid" style="grid-template-columns:2fr 1fr 1fr;margin-top:18px;max-width:460px">
<div class="h" style="text-align:left">Region</div><div class="h">Revenue</div><div class="h">YoY</div>
<div class="c">EMEA</div><div class="c">€2.1M</div><div class="c">+11%</div>
<div class="c">Americas</div><div class="c">€1.9M</div><div class="c">+18%</div>
<div class="c">APAC</div><div class="c">€0.82M</div><div class="c">+9%</div>
</div></div></div>`;
S.budget = `<div class="ribbon"><div class="rtabs"><b class="on">Home</b><b>Insert</b><b>Data</b><b>Formulas</b><b>View</b></div>
<div class="rtools"><span class="rt">€ Format</span><span class="rt">Σ AutoSum</span><span class="rt">📈 Chart</span><span class="rt">▦ Conditional</span><span class="rt">▼ Filter</span><span class="rt">✓ Validation</span><span class="rsep"></span><span class="rt">🔗 Live source</span><span class="rt">Find & replace</span></div></div>
<div class="pad"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="muted" style="font-family:monospace;font-size:13px">C7</span><div class="gcard" style="padding:7px 12px;margin:0;flex:1;font-family:monospace;font-size:13px">=SUM(C4:C6)</div></div>
<div class="grid">
<div class="h"></div><div class="h">A</div><div class="h">B</div><div class="h">C</div><div class="h">D</div><div class="h">E</div>
<div class="h">1</div><div class="c" style="font-weight:600">Item</div><div class="c"></div><div class="c" style="font-weight:600">Q3</div><div class="c"></div><div class="c"></div>
<div class="h">4</div><div class="c">Salaries</div><div class="c"></div><div class="c">1.20</div><div class="c"></div><div class="c"></div>
<div class="h">5</div><div class="c">Tools</div><div class="c"></div><div class="c">0.34</div><div class="c"></div><div class="c"></div>
<div class="h">6</div><div class="c">Travel</div><div class="c"></div><div class="c">0.18</div><div class="c"></div><div class="c"></div>
<div class="h">7</div><div class="c" style="font-weight:600">Total</div><div class="c"></div><div class="c sel">1.72 <span style="color:var(--ok)">●</span></div><div class="c"></div><div class="c"></div>
</div><div class="muted" style="margin-top:10px;font-size:12.5px">C7 is a live source — the total flows into your report automatically.</div></div>`;
S.mail = `<div class="pad" style="max-width:100%;padding:0"><div style="display:grid;grid-template-columns:180px 300px 1fr;height:100%;min-height:600px">
<div style="border-right:.5px solid var(--hair);padding:16px"><div class="prow hi">Inbox <span class="r">3</span></div><div class="prow">Sent</div><div class="prow">Drafts</div><div class="prow">Trash</div></div>
<div style="border-right:.5px solid var(--hair);overflow:auto">
<div style="padding:14px 16px;border-bottom:.5px solid var(--hair)"><div style="font-weight:600">Priya Nair</div><div class="muted" style="font-size:12.5px">Q3 forecast — needs a reply</div></div>
<div style="padding:14px 16px;border-bottom:.5px solid var(--hair)"><div>Sam Ortega</div><div class="muted" style="font-size:12.5px">Onboarding deck review</div></div>
<div style="padding:14px 16px;border-bottom:.5px solid var(--hair)"><div>Newsletter</div><div class="muted" style="font-size:12.5px">Weekly digest</div></div>
</div>
<div style="padding:24px"><div style="font-size:19px;font-weight:640">Re: Q3 forecast</div><div class="muted" style="margin:4px 0 16px">Priya Nair · to you</div><p style="line-height:1.7">Could you send the updated Q3 revenue forecast before our call tomorrow?</p><div class="muted" style="font-size:12px;margin:14px 0">🔒 Remote images blocked</div><div class="actions"><button class="b blue">Reply</button><button class="b quiet">Reply all</button><button class="b quiet">Forward</button></div></div>
</div></div>`;
S.calendar = `<div class="pad"><h1>Calendar</h1><div class="lede">This week.</div>
<div class="gcard" style="border-left:3px solid var(--warn-ink)"><b style="color:var(--warn-ink)">Two meetings overlap Thursday 2pm</b><p class="muted" style="margin:6px 0 12px">Board sync and the vendor call are booked at the same time.</p><div class="actions"><button class="b blue">Propose a fix</button><button class="b quiet">Ignore</button></div></div>
<div class="grid" style="grid-template-columns:repeat(5,1fr);margin-top:16px">
<div class="h">Mon</div><div class="h">Tue</div><div class="h">Wed</div><div class="h">Thu</div><div class="h">Fri</div>
<div class="c" style="min-height:60px">Standup</div><div class="c"></div><div class="c">1:1</div><div class="c" style="background:var(--warn-bg)">Board · Vendor</div><div class="c">Review</div>
</div></div>`;
S.chats = `<div class="pad" style="padding:0"><div style="display:grid;grid-template-columns:220px 1fr;height:100%;min-height:600px">
<div style="border-right:.5px solid var(--hair);padding:16px"><div class="muted" style="font-size:11px;font-weight:600;text-transform:uppercase;margin-bottom:6px">Teams · Slack · Matrix</div><div class="prow hi"># product <span class="r">2</span></div><div class="prow"># general</div><div class="prow">Sam Ortega</div></div>
<div style="padding:24px"><div style="font-weight:640;font-size:17px;margin-bottom:14px"># product</div>
<div class="gcard"><div style="font-weight:600">Sam Ortega</div><p style="margin:4px 0 0">Can you confirm the launch date for the Q3 feature?</p></div>
<div class="gcard" style="border-left:3px solid var(--blue)"><b>Draft ready</b><p class="muted" style="margin:6px 0 12px">Your assistant drafted a reply: “Confirmed for Sept 15 — I’ll share the plan today.”</p><div class="actions"><button class="b blue">Send it</button><button class="b quiet">Edit</button></div></div>
</div></div></div>`;
S.browser = `<div class="pad" style="max-width:100%"><div class="gcard" style="padding:8px 14px;margin-bottom:14px;font-family:monospace;font-size:13px;color:var(--ink-2)">🔒 research.example.com/market-2026</div>
<div style="display:grid;grid-template-columns:1fr 260px;gap:18px">
<div class="gcard"><div style="font-size:20px;font-weight:640">2026 Market Outlook</div><p class="muted" style="line-height:1.7;margin-top:10px">The category is projected to reach a market size of <b style="color:var(--ink)">$4.2B</b> by end of year, growing 22% annually…</p></div>
<div class="gcard"><b>Assistant</b><p class="muted" style="font-size:13px;margin:8px 0 14px">I can read this page and pull data into your work — you approve each action. Nothing happens without your ok.</p><button class="b blue" style="width:100%">Capture $4.2B as a live number</button></div>
</div></div>`;
S.agents = `<div class="pad"><h1>Assistants</h1><div class="lede">Everything your assistants are doing right now.</div>
<div style="display:flex;gap:8px;margin-bottom:16px"><button class="b quiet">Approve all safe changes (2) — never sends anything</button><button class="b quiet">+ New task</button></div>
<div class="gcard"><div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:99px;background:var(--ok)"></span><b>Writing assistant</b><span class="muted" style="margin-left:auto;font-family:monospace;font-size:12px">$0.04</span></div><p class="muted" style="margin:8px 0 0">Editing report.docx — updated Q3 revenue.</p></div>
<div class="gcard"><div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:99px;background:var(--ok)"></span><b>Email assistant</b><span class="muted" style="margin-left:auto;font-family:monospace;font-size:12px">$0.02</span></div><p class="muted" style="margin:8px 0 0">Drafted a reply to Priya — waiting for you.</p></div>
<div class="gcard" style="opacity:.7"><div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:99px;background:var(--ink-3)"></span><b>Research assistant</b><span class="muted" style="margin-left:auto">idle</span></div></div></div>`;
S.settings = `<div class="pad"><h1>Settings</h1>
<div class="gcard"><b>Apps you’ve connected</b>
<div class="prow" style="margin-top:6px">GitHub<span class="r" style="color:var(--ok)">Connected</span></div>
<div class="prow">Slack<span class="r" style="color:var(--ok)">Connected</span></div>
<div class="prow">Notion<span class="r">Connect</span></div>
<div class="prow">Sentry<span class="r">Connect</span></div></div>
<div class="gcard"><b>Your brand</b><div style="display:flex;gap:8px;margin-top:10px"><span style="width:26px;height:26px;border-radius:7px;background:#5B5BD6"></span><span style="width:26px;height:26px;border-radius:7px;background:#111"></span><span class="muted" style="align-self:center">Colors, logo & voice — used when an assistant writes for you.</span></div></div>
<div class="gcard"><b>Email accounts</b><div class="muted" style="margin-top:6px">you@work.com · Connected</div></div>
<div class="gcard" style="display:flex;align-items:center;gap:10px"><svg class="ic" viewBox="0 0 24 24"><path d="M6 10V8a6 6 0 0 1 12 0v2"/><rect x="5" y="10" width="14" height="10" rx="2"/></svg><div><b>Privacy</b><div class="muted">Everything stays on your Mac.</div></div></div></div>`;

// Home right pane default — "Today at a glance" (fills the space usefully)
const DASH = `<div class="peekbody" style="max-width:none;padding:26px 30px">
 <div style="font-size:20px;font-weight:640;letter-spacing:-.02em">Good morning, Clemens</div>
 <div class="muted" style="margin-bottom:20px">Wednesday · your day at a glance</div>
 <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
  <div class="gcard"><div class="muted" style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Next up</div>
   <div style="margin-top:10px;font-weight:600">10:00 · Board sync</div><div class="muted" style="font-size:13px">then · 1:1 with Sam</div></div>
  <div class="gcard"><div class="muted" style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Live numbers</div>
   <div style="margin-top:10px;font-weight:600">Q3 revenue · €4.82M <span style="color:var(--ok);font-size:12px">●</span></div><div class="muted" style="font-size:13px">Runway · 14 months <span style="color:var(--ok)">●</span></div></div>
 </div>
 <div class="gcard" style="margin-top:14px"><div class="muted" style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Recent</div>
  <div class="prow" data-open="report" style="margin-top:6px"><svg class="ic" viewBox="0 0 24 24"><path d="M8 4h8l4 4v12H4V4z"/></svg> report.docx</div>
  <div class="prow" data-open="budget"><svg class="ic" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/></svg> budget.xlsx</div></div>
 <div class="gcard" style="margin-top:14px"><div class="muted" style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Assistants finished today</div>
  <div class="muted" style="margin-top:8px;font-size:13.5px">✓ Refreshed the Q3 figures · ✓ Filed 4 receipts · ✓ Summarised 3 long threads</div></div>
</div>`;
// ── Home (two-pane triage + peek) ──
const HOME = `<div class="split"><div class="feed">
<h1>Ready for you</h1><div class="lede"><span id="needN">2</span> need a decision · <span id="workN2">1</span> still working</div>
<div class="command"><input id="askInput" placeholder="Ask an assistant to do something…"/><button class="ask" id="askBtn">Ask →</button></div>
<div class="sec"><h2>Needs a decision</h2><span class="n" id="needN2">2</span></div>
<div id="homeCards">
 <div class="card" data-card="report">
  <div class="top"><div class="who"><svg class="ic" viewBox="0 0 24 24"><path d="M8 4h7l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M9 13h6M9 16h4"/></svg></div>
  <div><h3>Updated Q3 revenue</h3><div class="by">Writing assistant · report.docx</div></div><span class="go" data-open="report">open →</span></div>
  <span class="tag"><svg class="ic ok" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg> Reversible — undo anytime</span></div>
 <div class="card" data-card="priya">
  <div class="top"><div class="who"><svg class="ic" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M5 8l7 5 7-5"/></svg></div>
  <div><h3>Drafted a reply to Priya</h3><div class="by">Email assistant · “Q3 forecast”</div></div><span class="go" data-open="mail">open →</span></div>
  <span class="tag willsend"><svg class="ic" viewBox="0 0 24 24"><path d="M12 9v4M12 16h.01M10.3 4.3l-7 12A1 1 0 0 0 4 18h16a1 1 0 0 0 .8-1.6l-7-12z"/></svg> Not sent yet</span></div>
</div></div>
<div class="peek" id="peek">${DASH}</div></div>`;

const PEEK = {
 report:`<div class="peekhead"><div><div class="pt">Q3 revenue change</div><div class="sub">Writing assistant · already applied</div></div><div class="spacer"></div><div class="act" data-popout="report"><svg class="ic" style="width:14px;height:14px" viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8"/></svg> Open full</div></div>
 <div class="peekbody"><div class="gcard"><b>What changed in report.docx</b><p class="muted" style="margin:10px 0">Q3 revenue set to the live figure <b style="color:var(--ink)">€4.82M</b> and the summary table refreshed to match.</p></div>
 <div class="tag" style="margin:6px 0 16px"><svg class="ic ok" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg> Already changed on your Mac — reversible</div>
 <div class="actions"><button class="b blue" data-resolve="report">Keep</button><button class="b quiet" data-resolve="report">Undo</button></div></div>`,
 priya:`<div class="peekhead"><div><div class="pt">Reply to Priya</div><div class="sub">Email assistant · reviewing before you send</div></div><div class="spacer"></div><div class="act" data-popout="mail"><svg class="ic" style="width:14px;height:14px" viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8"/></svg> Open in Mail</div></div>
 <div class="peekbody"><div class="mail"><div class="mailrow"><span class="l">To</span>Priya Nair</div><div class="mailrow"><span class="l">Subject</span>Re: Q3 forecast</div><div class="mailbody">Hi Priya,<br><br>Yes — I’ll send the updated Q3 forecast before our call, with both the finance-model and sales-adjusted views so you can compare directly.<br><br>Talk soon,<br>Clemens</div></div>
 <div class="willbar"><svg class="ic" viewBox="0 0 24 24"><path d="M12 9v4M12 16h.01M10.3 4.3l-7 12A1 1 0 0 0 4 18h16a1 1 0 0 0 .8-1.6l-7-12a1 1 0 0 0-1.5 0z"/></svg> This will send an email to Priya. Nothing sent yet.</div>
 <div class="actions"><button class="b blue" data-resolve="priya">Send it</button><button class="b quiet" data-resolve="priya">Edit first</button></div></div>`
};

// ── State + render ──
const body=document.getElementById('body'), tabs=document.getElementById('tabs');
let openTabs=['home'];
const TABMETA={home:{t:'Home'},report:{t:'report.docx'},budget:{t:'budget.xlsx'},mail:{t:'Mail'}};
const SURFACE_OF={report:'report',budget:'budget',mail:'mail'};

function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800);}
function railActive(s){document.querySelectorAll('.ritem').forEach(r=>r.classList.toggle('on',r.dataset.s===s));}

function show(id){ // id is a surface key or 'home'
  body.innerHTML = id==='home'?HOME:(S[id]||'<div class="pad muted">…</div>');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tab===id));
  const rail = id==='report'||id==='budget'?'files':(id==='mail'?'mail':id);
  railActive(['files','mail','calendar','chats','browser','agents','settings','home'].includes(rail)?rail:'home');
  if(id==='home') wireHome();
  wireOpeners();
}
function renderTabs(){ tabs.innerHTML=openTabs.map(id=>{const m=TABMETA[id]||{t:id};
  const close=id==='home'?'':`<span class="po" data-popout="${id}">⤢</span><span class="x" data-close="${id}">×</span>`;
  return `<div class="tab ${id===current?'on':''}" data-tab="${id}"><svg class="ic" viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/></svg> ${m.t} ${close}</div>`;}).join('');
  tabs.querySelectorAll('.tab').forEach(t=>t.onclick=e=>{if(e.target.dataset.close!==undefined){closeTab(e.target.dataset.close);return;}if(e.target.dataset.popout!==undefined){popout(e.target.dataset.popout);return;}go(t.dataset.tab);});
}
let current='home';
function go(id){current=id;show(id);renderTabs();}
function openTab(surfaceKey){const id=surfaceKey;if(!openTabs.includes(id)){openTabs.push(id);TABMETA[id]=TABMETA[id]||{t:id};}go(id);}
function closeTab(id){openTabs=openTabs.filter(t=>t!==id);go('home');}

// rail
document.querySelectorAll('.ritem[data-s]').forEach(r=>r.onclick=()=>{const s=r.dataset.s;if(s==='home'){go('home');}else{if(!openTabs.includes(s)){/*surfaces open as their own view, not a doc tab*/}go(s);current=s;railActive(s);}});
document.getElementById('workingChip').onclick=()=>{current='agents';show('agents');railActive('agents');};

// Open a document INTO Home's right working pane (keeps the triage feed on the left).
function openInHome(surfaceKey){
  const t=TABMETA[surfaceKey]?.t||surfaceKey;
  const peek=document.getElementById('peek'); if(!peek) return;
  peek.innerHTML=`<div class="peekhead"><div><div class="pt">${t}</div><div class="sub">working here — your list stays on the left</div></div><div class="spacer"></div>
    <div class="act" data-fullscreen="${surfaceKey}"><svg class="ic" style="width:14px;height:14px" viewBox="0 0 24 24"><path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"/></svg> Full screen</div>
    <div class="act" data-popout="${surfaceKey}"><svg class="ic" style="width:14px;height:14px" viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8"/></svg> New window</div></div>
    <div style="flex:1;overflow:auto">${S[surfaceKey]||''}</div>`;
  wireOpeners();
}
function wireOpeners(){
  body.querySelectorAll('[data-open]').forEach(el=>el.onclick=e=>{e.stopPropagation();const k=el.dataset.open;const s=SURFACE_OF[k]||k;
    if(current==='home'){openInHome(s);} else {openTab(s);toast('Opened '+(TABMETA[s]?.t||k));}});
  body.querySelectorAll('[data-fullscreen]').forEach(el=>el.onclick=e=>{e.stopPropagation();openTab(el.dataset.fullscreen);toast('Opened full');});
  body.querySelectorAll('[data-popout]').forEach(el=>el.onclick=e=>{e.stopPropagation();popout(el.dataset.popout);});
  body.querySelectorAll('[data-resolve]').forEach(el=>el.onclick=e=>{e.stopPropagation();resolve(el.dataset.resolve,el.textContent.trim());});
}
function wireHome(){
  const cards=body.querySelectorAll('.card[data-card]');
  cards.forEach(c=>c.onclick=()=>{cards.forEach(x=>x.classList.remove('sel'));c.classList.add('sel');const peek=document.getElementById('peek');peek.innerHTML=PEEK[c.dataset.card]||'';wireOpeners();});
  const ask=document.getElementById('askBtn');if(ask)ask.onclick=()=>{const v=document.getElementById('askInput').value||'that';toast('Working on it…');document.getElementById('workCount').textContent='3';const wn=document.getElementById('workN2');if(wn)wn.textContent='2';document.getElementById('askInput').value='';};
}
let needCount=2;
function resolve(card,label){
  const el=document.querySelector(`.card[data-card="${card}"]`);if(el){el.classList.add('gone');}
  needCount--;['needN','needN2'].forEach(id=>{const n=document.getElementById(id);if(n)n.textContent=needCount;});
  const wc=document.getElementById('workCount');if(wc)wc.textContent=Math.max(0,parseInt(wc.textContent)-1);
  document.getElementById('peek').innerHTML='<div class="peekempty">Nice — all caught up here.</div>';
  toast(/send/i.test(label)?'Sent ✓':/undo/i.test(label)?'Undone':'Kept ✓');
}

// ── ⌘K palette ──
const PData=[
 {g:'Files',items:[['report.docx','report'],['budget.xlsx','budget'],['deck.pptx','deck']]},
 {g:'Do something',items:[['New spreadsheet',null],['Reply to Priya','mail'],['Ask an assistant to…',null]]},
 {g:'Go to',items:[['Mail','mail'],['Calendar','calendar'],['Browser','browser'],['Assistants','agents']]},
];
const pov=document.getElementById('paletteOv'),pin=document.getElementById('pInput'),pres=document.getElementById('pResults');
function openPalette(){pov.classList.add('on');pin.value='';renderP('');pin.focus();}
function closePalette(){pov.classList.remove('on');}
function renderP(q){q=q.toLowerCase();pres.innerHTML=PData.map(grp=>{const its=grp.items.filter(i=>i[0].toLowerCase().includes(q));if(!its.length)return'';return `<div class="pgroup">${grp.g}</div>`+its.map(i=>`<div class="prow" data-nav="${i[1]||''}"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>${i[0]}<span class="r">↵</span></div>`).join('');}).join('')||'<div class="pgroup">No matches</div>';
 pres.querySelectorAll('[data-nav]').forEach(r=>r.onclick=()=>{const n=r.dataset.nav;closePalette();if(!n){toast('Done');return;}if(['mail','calendar','browser','agents'].includes(n)){current=n;show(n);railActive(n);}else{openTab(SURFACE_OF[n]||n);}});}
pin.oninput=()=>renderP(pin.value);
document.getElementById('cmdkBtn').onclick=openPalette;
pov.onclick=closePalette;
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette();}if(e.key==='Escape'){closePalette();document.getElementById('popOv').classList.remove('on');}});

// ── pop-out ──
const popOv=document.getElementById('popOv');
function popout(id){document.getElementById('popTitle').textContent=(TABMETA[id]?.t||id);document.getElementById('popBody').innerHTML=(id==='home'?HOME:S[id]||S.mail);popOv.classList.add('on');}
popOv.onclick=()=>popOv.classList.remove('on');

// init
renderTabs();show('home');
