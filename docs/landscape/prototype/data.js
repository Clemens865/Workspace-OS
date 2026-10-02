// Illustrative sample data — names, times and contents are not real.
window.WL = {
  agents: [
    // front row
    { id:"ada",  name:"Ada",  p:"codex",  role:"Researcher", status:"working", mini:"article", caseId:"c024" },
    { id:"milo", name:"Milo", p:"claude", role:"Developer",  status:"working", mini:"research", caseId:"c031" },
    { id:"lena", name:"Lena", p:"claude", role:"Designer",   status:"review",  mini:"doc", caseId:"c017" },
    { id:"noor", name:"Noor", p:"codex",  role:"Analyst",    status:"question", mini:"question", caseId:"c029" },
    { id:"sam",  name:"Sam",  p:"codex",  role:"Researcher", status:"paused",  mini:"paused", caseId:"c012" },
    { id:"juno", name:"Juno", p:"claude", role:"Strategist", status:"idle",    mini:"idle" },
    // back row
    { id:"heiko",name:"Heiko",p:"codex",  role:"Editor",     status:"idle", sub:"Ready when you are" },
    { id:"mike", name:"Mike", p:"claude", role:"Writer",     status:"idle", sub:"Standing by for next task" },
    { id:"iris", name:"Iris", p:"codex",  role:"Research editor", status:"idle", sub:"No task running" },
    { id:"theo", name:"Theo", p:"claude", role:"Planner",    status:"idle", sub:"Ready when needed" },
    { id:"remy", name:"Remy", p:"codex",  role:"Analyst",    status:"idle", sub:"No task assigned" },
    { id:"nia",  name:"Nia",  p:"claude", role:"Writer",     status:"idle", sub:"Available" },
    { id:"kai",  name:"Kai",  p:"claude", role:"Reviewer",   status:"idle", sub:"Ready when you are" },
    { id:"lou",  name:"Lou",  p:"codex",  role:"Researcher", status:"idle", sub:"No task running" },
    // front row, beyond the first view
    { id:"otto", name:"Otto", p:"codex",  role:"Developer",  status:"idle", mini:"idle", sub:"Standing by" },
    { id:"vera", name:"Vera", p:"claude", role:"Editor",     status:"idle", mini:"idle", sub:"Available" },
  ],
  statusLabel: { working:"Working", review:"Ready for review", question:"Needs your answer", paused:"Paused", idle:"Idle", accepted:"Accepted" },
  providerLabel: { codex:"Codex", claude:"Claude Code" },

  tasks: {
    ada:  { title:"Compare onboarding", brief:"Review the onboarding flow for clarity, note differences, and capture key takeaways.",
            steps:[["Opened source","Just now",1],["Read setup guide","3 minutes ago",1],["Saved notes","In progress",0]] },
    milo: { title:"Research help patterns", brief:"Collect in-product help patterns and summarize what works for first-time users.",
            steps:[["Opened 4 sources","12 minutes ago",1],["Clustered patterns","5 minutes ago",1],["Writing summary","In progress",0]] },
    lena: { title:"Launch plan", brief:"Draft a launch plan covering approach, milestones and next steps.",
            steps:[["Read project brief","1 hour ago",1],["Drafted plan","24 minutes ago",1],["Ready for review","10:24",1]] },
    noor: { title:"Confirm audience", brief:"Define the target audience for the onboarding redesign.",
            steps:[["Read research notes","20 minutes ago",1],["Asked a question","8 minutes ago",1],["Waiting for your answer","Paused",0]] },
    sam:  { title:"Staging walkthrough", brief:"Walk through the staging environment and record friction points.",
            steps:[["Opened staging","32 minutes ago",1],["Blocked on access","Paused",0]] },
  },

  chat: {
    noor: [
      ["you","How would you approach the onboarding comparison?","10:24 AM"],
      ["agent","I would compare setup, the first useful action, and how each product explains the next step.","10:24 AM"],
      ["you","Keep it focused on first-time users.","10:26 AM"],
      ["agent","That gives us a clear scope. We can turn it into a research brief when you are ready.","10:27 AM",true],
    ],
  },

  cases: [
    { id:"c024", n:"024", title:"Onboarding research", goal:"Find a clearer first experience for new users.", project:"Website launch",
      status:"review", updated:"Updated today", agent:"ada",
      files:[["Research brief","doc"],["Findings v2","sheet"],["Source notes","note"]],
      sources:6, messages:18, runs:2,
      activity:[["09:10","You","Focus on first-time users","user"],["09:24","Ada","Saved six sources","agent"],["09:42","Ada","Findings v2 is ready","agent"]],
      next:"Review the findings", cta:"Open findings" },
    { id:"c017", n:"017", title:"Launch copy", goal:"Write launch messaging that explains the change in one breath.", project:"Website launch",
      status:"review", updated:"Updated 3 days ago", agent:"lena",
      files:[["Launch plan.md","doc"],["Tone notes","note"]], sources:3, messages:11, runs:3,
      activity:[["Mon 14:02","You","Keep it plain","user"],["Mon 16:40","Lena","Draft v3 saved","agent"]],
      next:"Read launch plan", cta:"Open plan" },
    { id:"c012", n:"012", title:"Competitor notes", goal:"Summarize how three comparable products onboard teams.", project:"Website launch",
      status:"paused", updated:"Updated 1 week ago", agent:"sam",
      files:[["Comparison table","sheet"]], sources:9, messages:7, runs:1,
      activity:[["Sep 24","Sam","Blocked on staging access","agent"]],
      next:"Grant staging access", cta:"Open work" },
    { id:"c029", n:"029", title:"Audience definition", goal:"Decide who the first release is for.", project:"Website launch",
      status:"question", updated:"Updated 8 min ago", agent:"noor",
      files:[["Research notes","note"]], sources:2, messages:6, runs:1,
      activity:[["10:31","Noor","Asked: new users or administrators?","agent"]],
      next:"Answer Noor's question", cta:"Answer" },
    { id:"c031", n:"031", title:"Help patterns", goal:"Learn which in-product help patterns reduce drop-off.", project:"Website launch",
      status:"working", updated:"Live now", agent:"milo",
      files:[["Pattern clusters","note"]], sources:4, messages:3, runs:1,
      activity:[["10:05","Milo","Opened 4 sources","agent"]],
      next:"Wait for summary", cta:"View live" },
    { id:"c009", n:"009", title:"Pricing page review", goal:"Check that pricing reads clearly for small teams.", project:"Website launch",
      status:"review", updated:"Updated 2 weeks ago", agent:"theo", files:[["Pricing notes","note"]], sources:5, messages:9, runs:2,
      activity:[["Sep 17","Theo","Notes v2 saved","agent"]], next:"Review the notes", cta:"Open notes" },
    { id:"c006", n:"006", title:"Support macros", goal:"Draft reply templates for the first week after launch.", project:"Website launch",
      status:"paused", updated:"Updated 3 weeks ago", agent:"mike", files:[["Macros draft","doc"]], sources:1, messages:5, runs:1,
      activity:[["Sep 10","You","Paused until launch date is set","user"]], next:"Set launch date", cta:"Open work" },
    { id:"c003", n:"003", title:"Brand voice audit", goal:"Collect where our tone drifts across pages.", project:"Brand",
      status:"review", updated:"Updated last month", agent:"nia", files:[["Audit table","sheet"],["Examples","note"]], sources:12, messages:14, runs:3,
      activity:[["Aug 28","Nia","Audit table v3","agent"]], next:"Read the audit", cta:"Open audit" },
  ],

  project: {
    title:"Website launch", goal:"Make the first session clear, useful and easy to finish.",
    team:["ada","milo","lena","noor","sam","juno"],
    columns:[
      { key:"planned", title:"Planned", sub:"Ideas and next steps.", items:[
        { t:"Draft welcome guide", a:"juno", files:2, action:"Start", note:"Claude Code busy", disabled:true },
        { t:"Follow-up summary", a:"lena", action:"Start", note:"Waiting for accepted research", disabled:true } ]},
      { key:"working", title:"Working", sub:"In progress right now.", items:[
        { t:"Compare onboarding", a:"ada", files:3, action:"View work", go:"agent:ada" },
        { t:"Research help patterns", a:"milo", files:5, action:"View work", go:"agent:milo" } ]},
      { key:"input", title:"Needs input", sub:"Waiting for your answer.", warm:true, items:[
        { t:"Confirm audience", a:"noor", files:1, action:"Answer", go:"inbox:noor", amber:true } ]},
      { key:"review", title:"Review", sub:"Ready to check.", items:[
        { t:"Launch plan", a:"lena", files:4, action:"Review result", go:"inbox:lena" } ]},
      { key:"accepted", title:"Accepted", sub:"Reviewed and accepted.", items:[
        { t:"Project brief", a:"sam", files:4, action:"Hand off result", go:"handoff" } ]},
    ]
  },

  library: {
    project:[
      { t:"Project brief", pin:true, body:["Website launch","Make the first session clear, useful and easy to finish.",["Audience: first-time users","Scope: setup and first task","Done when: new users finish setup unaided"]], meta:"Updated 28 Sep · 09:12 · Version 5 · Added by you" },
      { t:"Voice guidelines", body:["Voice guidelines","How we write and speak about this project.",["Use plain English","Keep instructions short","Show the next action"]], meta:"Updated 1 Oct · 14:32 · Version 3 · Added by you" },
      { t:"brief.pdf", pdf:true, body:["brief.pdf","Extracted text · 4 pages",["Goals and constraints for the launch","Stakeholders and review dates","Open questions"]], meta:"Imported 26 Sep · 10 MB limit · Added by you" },
      { t:"Source notes", body:["Source notes","Captured during research — illustrative.",["Six sources saved by Ada","Capture times recorded","Text snapshot, not full archive"]], meta:"Updated today · 09:24 · Added by Ada" },
    ]
  },

  inbox: [
    { id:"noor", kind:"question", title:"New users or administrators?", text:"This will help me set up the right onboarding flow.", options:["New users","Administrators","Both"] },
    { id:"sam",  kind:"paused", title:"Paused · Open work", text:"I'm blocked waiting for access to the staging environment." },
    { id:"lena", kind:"review", title:"Launch plan.md", text:"A launch plan covering approach, milestones and next steps." },
  ],
};
