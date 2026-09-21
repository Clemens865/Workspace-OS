#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/main/case-cli.ts
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);

// src/main/cases.ts
var STATUS_FLOWS = {
  application: ["drafted", "applied", "interview", "offer", "accepted", "rejected", "not-applied"],
  /**
   * The generic flow, for everything that is not an application.
   *
   * A case is not a job-application feature — it is the thread any piece of
   * ongoing work leaves behind: a tender, a customer, a piece of research, a
   * house purchase. Those do not share a vocabulary of stages, so they get a
   * plain one and can grow their own when a second real instance shows what it
   * should be. Designing five speculative flows now would be guessing.
   */
  task: ["open", "in-progress", "waiting", "done", "dropped"]
};
function statusesFor(type) {
  return STATUS_FLOWS[type] ?? STATUS_FLOWS.task;
}
var NOTE_RE = /^-\s+(\S+)\s+·\s+(you|agent|system)\s+·\s+([\s\S]*)$/;
function slugify(title) {
  return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "case";
}
var esc = (v) => String(v ?? "").replace(/\r?\n/g, " ").trim();
function serializeCase(c) {
  const lines = [
    "---",
    `type: ${esc(c.type)}`,
    `title: ${esc(c.title)}`,
    `description: ${esc(c.description)}`,
    `subject: ${esc(c.subject)}`,
    `status: ${esc(c.status)}`,
    `created: ${esc(c.created)}`,
    `updated: ${esc(c.updated)}`,
    "artifacts:",
    ...c.artifacts.map((a) => `  - ${esc(a)}`),
    "acted:",
    ...(c.acted ?? []).map((a) => `  - ${esc(a)}`),
    "---",
    "",
    `# ${c.title}`,
    "",
    c.description ? c.description : "",
    "",
    c.subject ? `Source: ${c.subject}` : "",
    "",
    "## Notes",
    "",
    // Newest last, so the file reads as a story from the top.
    ...c.notes.map((n) => `- ${n.at} \xB7 ${n.author} \xB7 ${n.text.replace(/\r?\n/g, " ")}`),
    "",
    // The declared view, preserved verbatim so a save never drops it.
    ...c.viewBlock ? ["## View", "", "```json", c.viewBlock.trim(), "```", ""] : []
  ];
  return lines.filter((l, i) => !(l === "" && lines[i - 1] === "")).join("\n");
}
function parseCase(id, md) {
  const text = String(md ?? "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const front = m ? m[1] : "";
  const field = (k) => {
    const f = new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(front);
    return f ? f[1].trim() : "";
  };
  const list = (key) => {
    const out = [];
    let inside = false;
    for (const line of front.split(/\r?\n/)) {
      if (new RegExp(`^${key}:\\s*$`).test(line)) {
        inside = true;
        continue;
      }
      if (!inside) continue;
      const a = /^\s+-\s+(.+)$/.exec(line);
      if (a) out.push(a[1].trim());
      else if (line.trim() !== "") break;
    }
    return out;
  };
  const notes = [];
  for (const line of text.split(/\r?\n/)) {
    const n = NOTE_RE.exec(line.trim());
    if (n) notes.push({ at: n[1], author: n[2], text: n[3].trim() });
  }
  const title = field("title") || id;
  return {
    id,
    type: field("type") || "task",
    title,
    description: field("description"),
    subject: field("subject"),
    status: field("status") || "drafted",
    artifacts: list("artifacts"),
    acted: list("acted"),
    notes,
    viewBlock: (/```json\s*([\s\S]*?)```/.exec(text)?.[1] ?? "").trim() || void 0,
    created: field("created") || (/* @__PURE__ */ new Date(0)).toISOString(),
    updated: field("updated") || field("created") || (/* @__PURE__ */ new Date(0)).toISOString()
  };
}

// src/main/case-cli.ts
var DIR = "Cases";
function workspaceRoot() {
  const r = process.env["WOS_WORKSPACE"];
  if (!r) fail("no workspace open (WOS_WORKSPACE unset) \u2014 open a workspace in Workspace OS first.");
  return r;
}
var casesDir = () => import_path.default.join(workspaceRoot(), DIR);
var casePath = (id) => import_path.default.join(casesDir(), id + ".md");
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
function loadCase(id) {
  try {
    return parseCase(id, import_fs.default.readFileSync(casePath(id), "utf8"));
  } catch {
    return null;
  }
}
function writeCase(c) {
  import_fs.default.mkdirSync(casesDir(), { recursive: true });
  import_fs.default.writeFileSync(casePath(c.id), serializeCase(c), "utf8");
}
function relToWorkspace(p) {
  const abs = import_path.default.resolve(p);
  const root = import_path.default.resolve(workspaceRoot());
  return abs === root || abs.startsWith(root + import_path.default.sep) ? import_path.default.relative(root, abs) : p;
}
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      const v = next && !next.startsWith("--") ? argv[++i] : "true";
      (flags[k] ||= []).push(v);
    } else positional.push(a);
  }
  return { positional, flags };
}
function fail(msg) {
  console.error("wos-case: " + msg);
  process.exit(1);
}
function need(id) {
  if (!id) fail("missing <id>");
  const c = loadCase(id);
  if (!c) fail(`no such case "${id}"`);
  return c;
}
function done(json, obj, human) {
  console.log(json ? JSON.stringify(obj, null, 2) : human);
}
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const json = "json" in flags;
  const f1 = (k) => flags[k]?.[0];
  switch (cmd) {
    case "new": {
      const title = positional[0];
      if (!title) fail('usage: wos-case new "<title>" [--type task] [--desc ...] [--attach file]...');
      const type = f1("type") || "task";
      const id = slugify(title);
      if (loadCase(id)) fail(`case "${id}" already exists (use: wos-case note/attach/status ${id})`);
      const c = {
        id,
        type,
        title,
        description: f1("desc") || f1("description") || "",
        subject: f1("subject") || "",
        status: f1("status") || statusesFor(type)[0] || "open",
        artifacts: (flags["attach"] || []).map(relToWorkspace),
        acted: [],
        notes: [],
        created: nowIso(),
        updated: nowIso()
      };
      writeCase(c);
      done(json, { id, path: casePath(id) }, `created case "${id}" \u2192 ${import_path.default.relative(workspaceRoot(), casePath(id))}`);
      break;
    }
    case "ls": {
      const dir = casesDir();
      const ids = import_fs.default.existsSync(dir) ? import_fs.default.readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, "")) : [];
      const cases = ids.map(loadCase).filter((c) => !!c);
      if (json) return void console.log(JSON.stringify(cases.map((c) => ({ id: c.id, status: c.status, type: c.type, title: c.title, artifacts: c.artifacts.length, notes: c.notes.length })), null, 2));
      if (!cases.length) return void console.log("(no cases)");
      for (const c of cases) console.log(`${c.id.padEnd(28)} ${c.status.padEnd(12)} ${c.title}`);
      break;
    }
    case "get": {
      const c = need(positional[0]);
      console.log(json ? JSON.stringify(c, null, 2) : serializeCase(c));
      break;
    }
    case "note": {
      const c = need(positional[0]);
      const text = positional[1];
      if (!text) fail('usage: wos-case note <id> "<text>" [--author agent|you|system]');
      const author = f1("author") || "agent";
      c.notes.push({ at: nowIso(), author, text });
      c.updated = nowIso();
      writeCase(c);
      done(json, { id: c.id, notes: c.notes.length }, `noted on "${c.id}"`);
      break;
    }
    case "attach": {
      const c = need(positional[0]);
      const files = positional.slice(1);
      if (!files.length) fail("usage: wos-case attach <id> <file>...");
      for (const f of files) {
        const rel = relToWorkspace(f);
        if (!c.artifacts.includes(rel)) c.artifacts.push(rel);
      }
      c.updated = nowIso();
      writeCase(c);
      done(json, { id: c.id, artifacts: c.artifacts }, `attached ${files.length} file(s) to "${c.id}"`);
      break;
    }
    case "status": {
      const c = need(positional[0]);
      const s = positional[1];
      if (!s) fail("usage: wos-case status <id> <status>");
      const allowed = statusesFor(c.type);
      if (!allowed.includes(s)) fail(`invalid status "${s}" for type ${c.type}. allowed: ${allowed.join(", ")}`);
      c.notes.push({ at: nowIso(), author: "system", text: `Status \u2192 ${s}` });
      c.status = s;
      c.updated = nowIso();
      writeCase(c);
      done(json, { id: c.id, status: s }, `"${c.id}" \u2192 ${s}`);
      break;
    }
    case "view": {
      const c = need(positional[0]);
      const src = positional[1];
      if (!src) fail("usage: wos-case view <id> <spec.json|->  (- reads stdin)");
      const raw = (src === "-" ? import_fs.default.readFileSync(0, "utf8") : import_fs.default.readFileSync(src, "utf8")).trim();
      try {
        JSON.parse(raw);
      } catch {
        fail("view spec is not valid JSON");
      }
      c.viewBlock = raw;
      c.updated = nowIso();
      writeCase(c);
      done(json, { id: c.id }, `view set on "${c.id}"`);
      break;
    }
    default:
      console.error("wos-case \u2014 commands: new, ls, get, note, attach, status, view");
      process.exit(cmd ? 1 : 0);
  }
}
main();
