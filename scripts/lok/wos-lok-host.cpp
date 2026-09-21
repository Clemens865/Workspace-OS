// wos-lok-host — out-of-process LibreOfficeKit sidecar for Workspace OS (Phase 3a M1).
//
// Owns the headless LibreOffice engine on a single thread. Reads newline-delimited
// text commands on stdin, writes length-framed responses on stdout, logs on stderr.
//
//   wos-lok-host <install_path/> <fundamentalrc>
//
// Request (stdin, UTF-8 text, one per line):
//   <id> ping
//   <id> open <abs-path>          (path = rest of line)
//   <id> size
//   <id> tile <cw> <ch> <tx> <ty> <tw> <th>
//   <id> tiles <n> (<cw> <ch> <tx> <ty> <tw> <th>)×n
//   <id> close
//
// Response frame: [uint32 LE length][type:1][body]
//   fd3: 'J' body = JSON UTF-8 (responses + callbacks {"cb":<type>,"payload":…})
//   fd4: 'T' body = [uint32 LE id][uint32 LE cw][uint32 LE ch][BGRA cw*ch*4]
//        'B' body = [uint32 LE id][uint32 LE n] then n × ([u32 cw][u32 ch][BGRA])
// Tiles ride their own pipe so bulk pixels never queue behind callbacks or
// vice versa. INVALIDATE_TILES callbacks are coalesced engine-side (rect union).

#define LOK_USE_UNSTABLE_API
#include "LibreOfficeKit/LibreOfficeKit.h"
#include "LibreOfficeKit/LibreOfficeKitInit.h"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <list>
#include <iostream>
#include <unistd.h>
#include <cerrno>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <deque>
#include <chrono>
#include <sys/stat.h>

static LibreOfficeKit* g_lok = nullptr;
// g_doc/g_docUrl/g_docPath always mirror the CURRENT document so the command
// handlers below stay single-doc-simple. The real state is g_cache.
static LibreOfficeKitDocument* g_doc = nullptr;
static std::string g_docUrl;   // file:// URL of the current document (for save)
static std::string g_docPath;  // filesystem path of the current document
static std::string g_docFOpts; // filter options the doc was LOADED with (csv
                               // delimiter token) — reused on save so a
                               // semicolon csv saves back as semicolon csv

// Multiple documents stay resident at once so switching tabs is instant — no
// reload, no re-layout, none of the races that come from destroy+reload. The
// cache is LRU-capped: opening past the cap evicts the least-recently-used doc,
// which transparently reloads if the user returns to its tab. This is what lets
// the app hold many open files (Word/Excel/PowerPoint) without thrashing.
// `view` is the doc's OWN view id, captured right after documentLoad. View ids
// are global across documents — with several resident docs, view 0 belongs to
// the FIRST one. setView(d, 0) on any later doc binds it to a foreign view, so
// getDocumentSize reports 0×0 and the tab can't render. Always setView to the
// doc's stored id when making it current.
struct DocEntry { LibreOfficeKitDocument* doc; std::string url; std::string path; int view; std::string fopts; };
static std::list<DocEntry> g_cache;  // front = most-recently-used
static const size_t MAX_DOCS = 12;

static void setCurrent(const DocEntry& e) {
    g_doc = e.doc; g_docUrl = e.url; g_docPath = e.path; g_docFOpts = e.fopts;
    e.doc->pClass->setView(e.doc, e.view);
}

// Set while a Basic macro (runMacro: borders/resize) is executing. The macro
// mutates the model, which floods the engine callback stream; forwarding those
// frames from inside the macro (on the one host thread) stalls runMacro and can
// hang the engine. We suppress callbacks for the macro's duration — the renderer
// repaints explicitly after the call returns, so nothing is lost.
static bool g_inMacro = false;

// ---- framed output -------------------------------------------------------
// Frames go on dedicated pipes, NOT stdout — the LibreOffice engine writes
// stray messages to stdout, which would corrupt the framed protocol.
//   fd 3: JSON responses + callbacks (small, latency-sensitive)
//   fd 4: tile frames 'T'/'B' (large) — kept off the callback pipe so a
//         multi-MB repaint never delays cursor/selection callbacks and a
//         callback flood never delays tile delivery.
static const int FRAME_FD = 3;
static const int TILE_FD = 4;

// Output is decoupled from the engine thread by a dedicated writer thread. The
// engine thread (commands, runMacro, and the SYNCHRONOUS callback flood it
// triggers) only ever ENQUEUES frames — it never touches the pipe, so it can
// never block on I/O. This is what finally killed the freezes (resize hang, the
// freeze on editing a 2nd/Nth cell): a blocking pipe write on the one engine
// thread would stall the whole engine whenever the renderer drained slowly.
static std::deque<std::vector<unsigned char>> g_outQ;   // fd3: JSON + callbacks
static std::mutex g_outMtx;
static std::condition_variable g_outCv;
static bool g_outDone = false;
static std::deque<std::vector<unsigned char>> g_tileQ;  // fd4: 'T'/'B' tile frames
static std::mutex g_tileMtx;
static std::condition_variable g_tileCv;
static bool g_tileDone = false;
static const size_t Q_DROP_AT = 256;   // drop advisory callbacks past this depth
static const size_t Q_HARD_CAP = 8192;  // never grow unbounded

// ---- INVALIDATE_TILES coalescing ------------------------------------------
// A drag / typing burst emits dozens of invalidates back-to-back. Instead of
// forwarding each one, union them into a single pending rect and enqueue ONE
// marker; the writer materializes the union at write time, so everything that
// arrived while the pipe was busy collapses into a single callback frame.
static std::mutex g_invalMtx;
static bool g_invalMarkerQueued = false;  // a marker frame is already in g_outQ
static bool g_invalFull = false;          // an "EMPTY" (invalidate-all) arrived
static bool g_invalHas = false;           // a finite union rect is pending
static long g_ix0, g_iy0, g_ix1, g_iy1;   // union bounds (twips)

static std::vector<unsigned char> buildFrame(char type, const unsigned char* body, uint32_t len) {
    uint32_t total = len + 1;
    std::vector<unsigned char> frame;
    frame.reserve(5 + len);
    frame.push_back((unsigned char)(total & 0xFF));
    frame.push_back((unsigned char)((total >> 8) & 0xFF));
    frame.push_back((unsigned char)((total >> 16) & 0xFF));
    frame.push_back((unsigned char)((total >> 24) & 0xFF));
    frame.push_back((unsigned char)type);
    if (len) frame.insert(frame.end(), body, body + len);
    return frame;
}

// Snapshots + clears the pending invalidate union as a ready-to-write 'J'
// callback frame ({} if nothing pending). Called by the writer thread when it
// dequeues an invalidate marker.
static std::vector<unsigned char> buildInvalFrame() {
    std::string payload;
    {
        std::lock_guard<std::mutex> lk(g_invalMtx);
        g_invalMarkerQueued = false;
        if (g_invalFull) payload = "EMPTY";
        else if (g_invalHas)
            payload = std::to_string(g_ix0) + ", " + std::to_string(g_iy0) + ", "
                    + std::to_string(g_ix1 - g_ix0) + ", " + std::to_string(g_iy1 - g_iy0);
        g_invalFull = false;
        g_invalHas = false;
    }
    if (payload.empty()) return {};
    const std::string json = "{\"cb\":0,\"payload\":\"" + payload + "\"}";
    return buildFrame('J', reinterpret_cast<const unsigned char*>(json.data()), (uint32_t)json.size());
}

// `droppable` frames (ALL engine callbacks: cursor/selection/invalidate/formula
// bar) are dropped when the queue is backed up — they're advisory (the next
// supersedes; the renderer repaints explicitly after edits). Command RESPONSES
// are always queued so the renderer gets its reply. Tile frames ('T'/'B') go
// on their own pipe + queue so bulk pixels and small callbacks never block
// each other.
static void writeFrame(char type, const unsigned char* body, uint32_t len, bool droppable = false) {
    std::vector<unsigned char> frame = buildFrame(type, body, len);
    if (type == 'T' || type == 'B') {
        { std::lock_guard<std::mutex> lk(g_tileMtx); g_tileQ.push_back(std::move(frame)); }
        g_tileCv.notify_one();
        return;
    }
    {
        std::lock_guard<std::mutex> lk(g_outMtx);
        if (droppable && g_outQ.size() >= Q_DROP_AT) return;
        if (g_outQ.size() >= Q_HARD_CAP) { if (droppable) return; }
        g_outQ.push_back(std::move(frame));
    }
    g_outCv.notify_one();
}

// Writer threads: drain a queue to its fd with blocking writes (their own
// threads — blocking here never affects the engine).
static void drainLoop(std::deque<std::vector<unsigned char>>& q, std::mutex& mtx,
                      std::condition_variable& cv, bool& done, int fd) {
    for (;;) {
        std::vector<unsigned char> frame;
        {
            std::unique_lock<std::mutex> lk(mtx);
            cv.wait(lk, [&] { return !q.empty() || done; });
            if (q.empty()) { if (done) return; else continue; }
            frame = std::move(q.front());
            q.pop_front();
        }
        // An empty frame is an invalidate marker — materialize the union now.
        if (frame.empty()) {
            frame = buildInvalFrame();
            if (frame.empty()) continue; // already flushed by an earlier marker
        }
        const unsigned char* p = frame.data();
        size_t n = frame.size();
        while (n) {
            ssize_t k = write(fd, p, n);
            if (k > 0) { p += k; n -= (size_t)k; continue; }
            if (k < 0 && errno == EINTR) continue;
            break; // pipe closed / fatal — drop the rest
        }
    }
}
static void writerLoop() { drainLoop(g_outQ, g_outMtx, g_outCv, g_outDone, FRAME_FD); }
static void tileWriterLoop() { drainLoop(g_tileQ, g_tileMtx, g_tileCv, g_tileDone, TILE_FD); }

static void sendJson(const std::string& json) {
    writeFrame('J', reinterpret_cast<const unsigned char*>(json.data()), (uint32_t)json.size());
}

static void put32(std::vector<unsigned char>& v, uint32_t x) {
    v.push_back(x & 0xFF); v.push_back((x >> 8) & 0xFF);
    v.push_back((x >> 16) & 0xFF); v.push_back((x >> 24) & 0xFF);
}

// Escapes a string for embedding in a JSON string literal. Crucially handles
// control chars (esp. newlines in multi-line slide/sheet names) — leaving them
// raw produces invalid JSON, which silently drops the whole frame on the client.
static std::string jsonEscape(const std::string& s) {
    std::string esc;
    esc.reserve(s.size());
    for (char c : s) {
        if (c == '"' || c == '\\') { esc.push_back('\\'); esc.push_back(c); }
        else if (c == '\n') esc += "\\n";
        else if (c == '\r') esc += "\\r";
        else if (c == '\t') esc += "\\t";
        else if ((unsigned char)c >= 0x20) esc.push_back(c);
        // other control chars dropped
    }
    return esc;
}

// ---- LOKit callback → 'C' frames ----------------------------------------
// pData carries the document the callback came from (set at registerCallback).
// Only the CURRENT document's callbacks are forwarded — background docs would
// otherwise drive the renderer's cursor/selection for the wrong tab.
static void lokCallback(int nType, const char* pPayload, void* pData) {
    if (g_inMacro) return;           // don't forward the macro's own change-flood
    if (pData != (void*)g_doc) return;
    if (nType == 0) { // LOK_CALLBACK_INVALIDATE_TILES — coalesce bursts (see above)
        long x = 0, y = 0, w = 0, h = 0;
        const bool full = !pPayload || strncmp(pPayload, "EMPTY", 5) == 0
                       || sscanf(pPayload, "%ld, %ld, %ld, %ld", &x, &y, &w, &h) != 4;
        bool enqueueMarker = false;
        {
            std::lock_guard<std::mutex> lk(g_invalMtx);
            if (full) g_invalFull = true;
            else if (!g_invalHas) { g_ix0 = x; g_iy0 = y; g_ix1 = x + w; g_iy1 = y + h; g_invalHas = true; }
            else {
                g_ix0 = std::min(g_ix0, x); g_iy0 = std::min(g_iy0, y);
                g_ix1 = std::max(g_ix1, x + w); g_iy1 = std::max(g_iy1, y + h);
            }
            if (!g_invalMarkerQueued) { g_invalMarkerQueued = true; enqueueMarker = true; }
        }
        if (enqueueMarker) {
            // Empty frame = marker; NOT droppable (it stands for the whole union).
            { std::lock_guard<std::mutex> lk(g_outMtx); g_outQ.push_back({}); }
            g_outCv.notify_one();
        }
        return;
    }
    std::string esc = jsonEscape(pPayload ? pPayload : "");
    // ALL callbacks are droppable (non-blocking). They fire synchronously on the
    // one host thread — often in dense bursts (document load, typing, a resize
    // macro mutating the model). If a callback's blocking write ever stalls on a
    // full pipe, it freezes the whole engine mid-operation (this was the resize
    // hang + the typing wedge). Dropping under backpressure is safe: callbacks
    // are advisory (the next supersedes) and the renderer repaints explicitly
    // after edits/resizes. At click time the pipe has room, so the cell cursor
    // still lands reliably.
    const std::string json = std::string("{\"cb\":") + std::to_string(nType) + ",\"payload\":\"" + esc + "\"}";
    // GRAPHIC_SELECTION (6) must NOT be dropped: it keeps the renderer's shape
    // handles in sync with the engine's real selection. If it's dropped under
    // load, the overlay shows shape A selected while the engine has shape B, so
    // a fill/color op hits the wrong shape ("can't change the color"). It fires
    // only on user selection changes (never during macros — suppressed above),
    // so it can't flood the pipe like the invalidate/cursor bursts.
    const bool droppable = (nType != 6);
    writeFrame('J', reinterpret_cast<const unsigned char*>(json.data()), (uint32_t)json.size(), droppable);
}

// ---- commands ------------------------------------------------------------
// One-time rendering setup for a freshly loaded document. The callback is
// registered with the document handle so lokCallback can route by current doc.
// Returns the doc's own view id (current right after documentLoad) — NOT 0,
// which belongs to whichever doc loaded first (see DocEntry).
static int initDoc(LibreOfficeKitDocument* d) {
    d->pClass->initializeForRendering(d, "");
    d->pClass->registerCallback(d, lokCallback, (void*)d);
    return d->pClass->getView(d);
}

// Sends the open-style metadata response for the current document.
static void reportOpenMeta(long id) {
    long w = 0, h = 0; g_doc->pClass->getDocumentSize(g_doc, &w, &h);
    int type = g_doc->pClass->getDocumentType(g_doc);
    int parts = g_doc->pClass->getParts(g_doc);
    int cur = g_doc->pClass->getPart(g_doc);
    // Part names (sheet/slide tabs) as a JSON array.
    std::string names = "[";
    for (int i = 0; i < parts; i++) {
        char* nm = g_doc->pClass->getPartName(g_doc, i);
        std::string s = nm ? nm : "";
        if (nm) free(nm);
        names += "\"" + jsonEscape(s) + "\"";
        if (i < parts - 1) names += ",";
    }
    names += "]";
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true,\"type\":" + std::to_string(type)
             + ",\"parts\":" + std::to_string(parts) + ",\"cur\":" + std::to_string(cur)
             + ",\"names\":" + names + ",\"w\":" + std::to_string(w)
             + ",\"h\":" + std::to_string(h) + "}");
}

static std::string extOf(const std::string& path) {
    auto dot = path.find_last_of('.');
    return dot == std::string::npos ? "" : path.substr(dot + 1);
}

// Destroys least-recently-used documents until the cache is within the cap. The
// current doc is at the front, so the back is always evictable.
static void evictLRU() {
    while (g_cache.size() > MAX_DOCS) {
        DocEntry victim = g_cache.back();
        g_cache.pop_back();
        if (victim.doc != g_doc) victim.doc->pClass->destroy(victim.doc);
    }
}

// Adds a freshly loaded doc to the front of the cache, makes it current, evicts.
static void adoptCurrent(LibreOfficeKitDocument* d, const std::string& url, const std::string& path, const std::string& fopts = "") {
    int view = initDoc(d);
    g_cache.push_front(DocEntry{d, url, path, view, fopts});
    setCurrent(g_cache.front());
    evictLRU();
}

// `fopts`: optional filter-options string for the LOAD (a CSV import token:
// "sep,textdelim,charset,firstrow,…"). LOK passes unrecognized option strings
// through as FilterOptions to the import filter — which is exactly how a
// headless client picks the CSV delimiter the desktop import dialog would ask
// about. Empty → the normal path (UpdateDocMode=0).
static void cmdOpen(long id, const std::string& path, const std::string& fopts = "") {
    // Already resident? Switch to it instantly — no reload, no race.
    for (auto it = g_cache.begin(); it != g_cache.end(); ++it) {
        if (it->path == path) {
            g_cache.splice(g_cache.begin(), g_cache, it); // mark most-recently-used
            setCurrent(g_cache.front()); // setView's to the doc's OWN view
            reportOpenMeta(id);
            return;
        }
    }
    std::string url = "file://" + path;
    // UpdateDocMode=0 (NO_UPDATE): don't refresh embedded/linked content on load —
    // safer/faster, and avoids recalc-on-load hangs. (Not combined with fopts:
    // a CSV token must reach the import filter verbatim.)
    LibreOfficeKitDocument* d = g_lok->pClass->documentLoadWithOptions(
        g_lok, url.c_str(), fopts.empty() ? "UpdateDocMode=0" : fopts.c_str());
    if (!d) {
        char* e = g_lok->pClass->getError(g_lok);
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"load failed: " + (e ? e : "") + "\"}");
        return;
    }
    adoptCurrent(d, url, path, fopts);
    reportOpenMeta(id);
}

// Creates a blank document of `factory` (swriter/scalc/simpress), saves it to
// `path`, and leaves it open + resident — reported like cmdOpen.
static void cmdNew(long id, const std::string& factory, const std::string& path) {
    if (factory != "swriter" && factory != "scalc" && factory != "simpress") {
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad factory\"}"); return;
    }
    std::string furl = "private:factory/" + factory;
    LibreOfficeKitDocument* d = g_lok->pClass->documentLoad(g_lok, furl.c_str());
    if (!d) {
        char* e = g_lok->pClass->getError(g_lok);
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"factory failed: " + (e ? e : "") + "\"}");
        return;
    }
    std::string url = "file://" + path;
    std::string fmt = extOf(path);
    int ok = d->pClass->saveAs(d, url.c_str(), fmt.empty() ? nullptr : fmt.c_str(), nullptr);
    if (!ok) { d->pClass->destroy(d); sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"saveAs failed\"}"); return; }
    adoptCurrent(d, url, path);
    reportOpenMeta(id);
}

// Closes a single document (a tab the user closed), freeing its memory. If it
// was current, the next resident doc becomes current.
static void cmdCloseDoc(long id, const std::string& path) {
    for (auto it = g_cache.begin(); it != g_cache.end(); ++it) {
        if (it->path == path) {
            LibreOfficeKitDocument* d = it->doc;
            bool wasCurrent = (d == g_doc);
            g_cache.erase(it);
            d->pClass->destroy(d);
            if (wasCurrent) {
                if (!g_cache.empty()) { setCurrent(g_cache.front()); }
                else { g_doc = nullptr; g_docUrl.clear(); g_docPath.clear(); }
            }
            break;
        }
    }
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
}

static void cmdSize(long id) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    long w = 0, h = 0; g_doc->pClass->getDocumentSize(g_doc, &w, &h);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true,\"w\":" + std::to_string(w)
             + ",\"h\":" + std::to_string(h) + "}");
}

// Re-queries the current part list (sheets/slides) after a structural change.
static void cmdParts(long id) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    int parts = g_doc->pClass->getParts(g_doc);
    int cur = g_doc->pClass->getPart(g_doc);
    std::string names = "[";
    for (int i = 0; i < parts; i++) {
        char* nm = g_doc->pClass->getPartName(g_doc, i);
        std::string s = nm ? nm : "";
        if (nm) free(nm);
        names += "\"" + jsonEscape(s) + "\"";
        if (i < parts - 1) names += ",";
    }
    names += "]";
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true,\"parts\":" + std::to_string(parts)
             + ",\"cur\":" + std::to_string(cur) + ",\"names\":" + names + "}");
}

// Returns getCommandValues(command) raw JSON (e.g. .uno:WordCount) as `value`.
static void cmdVals(long id, const std::string& command) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    char* v = g_doc->pClass->getCommandValues(g_doc, command.c_str());
    std::string s = v ? v : "";
    if (v) free(v);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true,\"value\":" + (s.empty() ? "null" : s) + "}");
}

static void cmdTile(long id, int cw, int ch, int tx, int ty, int tw, int th) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    if (cw <= 0 || ch <= 0 || cw > 4096 || ch > 4096) {
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad tile size\"}"); return;
    }
    std::vector<unsigned char> buf((size_t)cw * ch * 4, 0xFF);
    g_doc->pClass->paintTile(g_doc, buf.data(), cw, ch, tx, ty, tw, th);
    std::vector<unsigned char> frame;
    frame.reserve(12 + buf.size());
    put32(frame, (uint32_t)id); put32(frame, (uint32_t)cw); put32(frame, (uint32_t)ch);
    frame.insert(frame.end(), buf.begin(), buf.end());
    writeFrame('T', frame.data(), (uint32_t)frame.size());
}

// Paints N tiles into ONE 'B' response frame — a full-viewport repaint costs a
// single frame (and a single renderer→main IPC) instead of N. Tiles render
// directly into the frame buffer, so there's no per-tile copy either.
static void cmdTiles(long id, const std::string& rest) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    const char* p = rest.c_str();
    int n = 0, used = 0;
    if (sscanf(p, "%d%n", &n, &used) != 1 || n <= 0 || n > 256) {
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad tile count\"}"); return;
    }
    p += used;
    // Two passes: validate + size everything first so the frame buffer is
    // reserved ONCE (a growing resize per tile re-memcpys the accumulated
    // megabytes quadratically), then paint straight into it.
    struct Spec { int cw, ch, tx, ty, tw, th; };
    std::vector<Spec> specs;
    specs.reserve(n);
    size_t total = 8; // id + n
    for (int i = 0; i < n; i++) {
        Spec s;
        if (sscanf(p, "%d %d %d %d %d %d%n", &s.cw, &s.ch, &s.tx, &s.ty, &s.tw, &s.th, &used) != 6) {
            sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad tiles args\"}"); return;
        }
        p += used;
        if (s.cw <= 0 || s.ch <= 0 || s.cw > 4096 || s.ch > 4096) {
            sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad tile size\"}"); return;
        }
        total += 8 + (size_t)s.cw * s.ch * 4;
        specs.push_back(s);
    }
    std::vector<unsigned char> frame;
    frame.reserve(total);
    put32(frame, (uint32_t)id);
    put32(frame, (uint32_t)n);
    for (const Spec& s : specs) {
        size_t off = frame.size();
        put32(frame, (uint32_t)s.cw); put32(frame, (uint32_t)s.ch);
        frame.resize(frame.size() + (size_t)s.cw * s.ch * 4, 0xFF);
        g_doc->pClass->paintTile(g_doc, frame.data() + off + 8, s.cw, s.ch, s.tx, s.ty, s.tw, s.th);
    }
    writeFrame('B', frame.data(), (uint32_t)frame.size());
}

// Paints a tile of a SPECIFIC part (slide/sheet) without changing the active
// view — used for slide thumbnails. Same T-frame shape as cmdTile.
static void cmdPartTile(long id, int part, int cw, int ch, int tx, int ty, int tw, int th) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    if (cw <= 0 || ch <= 0 || cw > 4096 || ch > 4096) {
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad tile size\"}"); return;
    }
    std::vector<unsigned char> buf((size_t)cw * ch * 4, 0xFF);
    g_doc->pClass->paintPartTile(g_doc, buf.data(), part, 0, cw, ch, tx, ty, tw, th);
    std::vector<unsigned char> frame;
    frame.reserve(12 + buf.size());
    put32(frame, (uint32_t)id); put32(frame, (uint32_t)cw); put32(frame, (uint32_t)ch);
    frame.insert(frame.end(), buf.begin(), buf.end());
    writeFrame('T', frame.data(), (uint32_t)frame.size());
}

// ---- dialog windows (LOK_CALLBACK_WINDOW) --------------------------------
static void cmdWPaint(long id, int winId, int w, int h) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    if (w <= 0 || h <= 0 || w > 4096 || h > 4096) {
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad window size\"}"); return;
    }
    std::vector<unsigned char> buf((size_t)w * h * 4, 0xFF);
    g_doc->pClass->paintWindow(g_doc, (unsigned)winId, buf.data(), 0, 0, w, h);
    std::vector<unsigned char> frame;
    frame.reserve(12 + buf.size());
    put32(frame, (uint32_t)id); put32(frame, (uint32_t)w); put32(frame, (uint32_t)h);
    frame.insert(frame.end(), buf.begin(), buf.end());
    writeFrame('T', frame.data(), (uint32_t)frame.size());
}

static void cmdWMouse(long id, int winId, int type, int x, int y, int count, int buttons, int modifier) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    g_doc->pClass->postWindowMouseEvent(g_doc, (unsigned)winId, type, x, y, count, buttons, modifier);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
}

static void cmdWKey(long id, int winId, int type, int charCode, int keyCode) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    g_doc->pClass->postWindowKeyEvent(g_doc, (unsigned)winId, type, charCode, keyCode);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
}

// JSDialog event: {"id":"<control>","cmd":"<action>","data":"...","type":"<widget>"}
// straight to the dialog's welded widgets (LOK sendDialogEvent).
static void cmdDlgEvent(long id, unsigned long long winId, const std::string& json) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    try {
        g_doc->pClass->sendDialogEvent(g_doc, winId, json.c_str());
    } catch (const std::exception& e) {
        std::string msg = e.what();
        for (char& c : msg) if (c == '"' || c == '\\' || c < 0x20) c = ' ';
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"dialog event failed: " + msg + "\"}");
        return;
    }
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
}

static void cmdWClose(long id, int winId) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    g_doc->pClass->postWindow(g_doc, (unsigned)winId, 0 /*LOK_WINDOW_CLOSE*/, nullptr);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
}

static void cmdSetPart(long id, int n) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    int parts = g_doc->pClass->getParts(g_doc);
    if (n < 0 || n >= parts) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad part\"}"); return; }
    g_doc->pClass->setPart(g_doc, n);
    long w = 0, h = 0; g_doc->pClass->getDocumentSize(g_doc, &w, &h);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true,\"cur\":" + std::to_string(n)
             + ",\"w\":" + std::to_string(w) + ",\"h\":" + std::to_string(h) + "}");
}

static void cmdKey(long id, int type, int charCode, int keyCode) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    g_doc->pClass->postKeyEvent(g_doc, type, charCode, keyCode);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
}

static void cmdMouse(long id, int type, int x, int y, int count, int buttons, int modifier) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    g_doc->pClass->postMouseEvent(g_doc, type, x, y, count, buttons, modifier);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
}

static void cmdUno(long id, const std::string& command, const std::string& args) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    // Malformed JSON args throw out of the engine (boost json_parser_error);
    // uncaught, that took the whole host — and every open document — down with
    // one bad menu pick. Report it instead.
    try {
        g_doc->pClass->postUnoCommand(g_doc, command.c_str(), args.empty() ? nullptr : args.c_str(), false);
    } catch (const std::exception& e) {
        std::string msg = e.what();
        for (char& c : msg) if (c == '"' || c == '\\' || c < 0x20) c = ' ';
        sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"uno failed: " + msg + "\"}");
        return;
    }
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
}

// ---------------------------------------------------------------- clipboard
//
// WOS-009. `.uno:Copy` writes into the ENGINE's own clipboard, which lives in
// this process and is invisible to macOS — so copying in a .docx put nothing on
// the system pasteboard, and nothing copied elsewhere could be pasted in.
// These two commands move the bytes across that boundary; the decision about
// WHICH direction to use for a given command is made in main (handlers/lok.ts).
//
// Payloads are base64 so arbitrary bytes (HTML, newlines, UTF-8) survive a
// line-delimited request protocol and a JSON response.

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string b64Encode(const unsigned char* data, size_t n) {
    std::string out;
    out.reserve(((n + 2) / 3) * 4);
    for (size_t i = 0; i < n; i += 3) {
        uint32_t v = data[i] << 16;
        if (i + 1 < n) v |= data[i + 1] << 8;
        if (i + 2 < n) v |= data[i + 2];
        out.push_back(B64[(v >> 18) & 0x3F]);
        out.push_back(B64[(v >> 12) & 0x3F]);
        out.push_back(i + 1 < n ? B64[(v >> 6) & 0x3F] : '=');
        out.push_back(i + 2 < n ? B64[v & 0x3F] : '=');
    }
    return out;
}

static std::vector<unsigned char> b64Decode(const std::string& s) {
    int rev[256];
    for (int i = 0; i < 256; i++) rev[i] = -1;
    for (int i = 0; i < 64; i++) rev[(unsigned char)B64[i]] = i;

    std::vector<unsigned char> out;
    out.reserve((s.size() / 4) * 3);
    uint32_t acc = 0;
    int bits = 0;
    for (char c : s) {
        int d = rev[(unsigned char)c];
        if (d < 0) continue; // skips '=' padding and any stray whitespace
        acc = (acc << 6) | (uint32_t)d;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back((unsigned char)((acc >> bits) & 0xFF));
        }
    }
    return out;
}

/** Read the current selection out of the document in `mime` (base64 in reply). */
static void cmdGetSel(long id, const std::string& mime) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    char* used = nullptr;
    char* sel = g_doc->pClass->getTextSelection(g_doc, mime.c_str(), &used);
    // An empty selection is a legitimate answer, not an error — a shape or image
    // selection yields nothing for text mime types, and main needs to tell that
    // apart from a failure so it can leave the pasteboard alone.
    std::string b64 = sel ? b64Encode(reinterpret_cast<const unsigned char*>(sel), strlen(sel)) : "";
    if (sel) free(sel);
    if (used) free(used);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true,\"b64\":\"" + b64 + "\"}");
}

/** Insert `b64` (decoded, interpreted as `mime`) at the cursor. */
static void cmdPasteBuf(long id, const std::string& mime, const std::string& b64) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    std::vector<unsigned char> bytes = b64Decode(b64);
    bool ok = g_doc->pClass->paste(g_doc, mime.c_str(),
                                   reinterpret_cast<const char*>(bytes.data()), bytes.size());
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":" + (ok ? "true" : "false") + "}");
}

// Model-level formatting (cell borders, …) that postUnoCommand can't reach is
// done by a seeded Basic macro run via LOK's runMacro — it executes in the
// engine's own context where ThisComponent IS the loaded document, so changes
// persist. No UNO linking needed. Params are passed via a small args file the
// macro reads (runMacro takes only a URL).
// Writes the current doc's filesystem path so a macro can resolve the right
// component — Basic's ThisComponent goes stale across multi-doc tab switches.
static void writeActiveDocFile() {
    FILE* df = fopen("/tmp/wos-macro-doc.txt", "w");
    if (df) { fputs(g_docPath.c_str(), df); fputc('\n', df); fclose(df); }
}

static void cmdSetBorder(long id, const std::string& preset, long color, int width) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    if (width <= 0) width = 26;
    writeActiveDocFile();
    FILE* af = fopen("/tmp/wos-macro-args.txt", "w");
    if (af) { fprintf(af, "%s|%ld|%d\n", preset.c_str(), color, width); fclose(af); }
    g_inMacro = true;
    int ok = g_lok->pClass->runMacro(g_lok, "macro:///Standard.Module1.WosSetBorder");
    g_inMacro = false;
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":" + (ok ? "true" : "false") + "}");
}

// Resizes a column/row via the seeded Basic macro (same runMacro bridge as
// borders). kind = "col"|"row", size in 1/100 mm (size <= 0 means autofit).
static void cmdSetSize(long id, const std::string& kind, long index, long size) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    writeActiveDocFile();
    FILE* af = fopen("/tmp/wos-macro-size.txt", "w");
    if (af) { fprintf(af, "%s|%ld|%ld\n", kind.c_str(), index, size); fclose(af); }
    g_inMacro = true;
    int ok = g_lok->pClass->runMacro(g_lok, "macro:///Standard.Module1.WosSetSize");
    g_inMacro = false;
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":" + (ok ? "true" : "false") + "}");
}

// Generic model-API macro runner: writes `args` to a temp file the macro reads,
// then runs macro:///Standard.Module1.<name>. Restricted to our own Wos* macros.
static void cmdRunMacro(long id, const std::string& name, const std::string& args) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    bool okName = name.rfind("Wos", 0) == 0 && !name.empty();
    for (char c : name) if (!isalnum((unsigned char)c)) okName = false;
    if (!okName) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad macro name\"}"); return; }
    writeActiveDocFile();
    FILE* af = fopen("/tmp/wos-macro-generic.txt", "w");
    if (af) { fputs(args.c_str(), af); fputc('\n', af); fclose(af); }
    // The Wos* library is split across Module1 + Module2 (StarBasic ~64KB/module
    // limit). Try Module1 first; runMacro returns 0 only when the name is NOT
    // found there, so a real Module1 macro (found + run, even if it internally
    // no-ops under On Error Resume Next) never double-runs — only an unknown name
    // falls through to Module2.
    g_inMacro = true;
    int ok = g_lok->pClass->runMacro(g_lok, ("macro:///Standard.Module1." + name).c_str());
    if (!ok) ok = g_lok->pClass->runMacro(g_lok, ("macro:///Standard.Module2." + name).c_str());
    if (!ok) ok = g_lok->pClass->runMacro(g_lok, ("macro:///Standard.Module3." + name).c_str());
    g_inMacro = false;
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":" + (ok ? "true" : "false") + "}");
}

// Exports a copy of the open doc to `path` in `format` (pdf/docx/odt/…),
// leaving the original document untouched.
static void cmdExport(long id, const std::string& format, const std::string& path) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    std::string url = "file://" + path;
    int ok = g_doc->pClass->saveAs(g_doc, url.c_str(), format.c_str(), nullptr);
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":" + (ok ? "true" : "false") + "}");
}

static void cmdSave(long id) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    // Format from the original extension (docx/xlsx/pptx). Filter options: the
    // ones the doc was LOADED with (csv delimiter token) so a semicolon csv
    // saves back as a semicolon csv — else null as before.
    std::string fmt;
    auto dot = g_docPath.find_last_of('.');
    if (dot != std::string::npos) fmt = g_docPath.substr(dot + 1);
    int ok = g_doc->pClass->saveAs(g_doc, g_docUrl.c_str(), fmt.empty() ? nullptr : fmt.c_str(),
                                   g_docFOpts.empty() ? nullptr : g_docFOpts.c_str());
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":" + (ok ? "true" : "false") + "}");
}

// SPIKE (spike/vector-rendering): measure IN-PROCESS vector export of the
// already-loaded document — the open question vs the 4.4s cold-spawn CLI path.
// Clocks the saveAs("svg") on the live model and reports elapsed ms + output
// bytes. Decides whether native vector rendering is fast enough to be viable.
static void cmdSvgSpike(long id, const std::string& path) {
    if (!g_doc) { sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"no document\"}"); return; }
    std::string url = "file://" + path;
    auto t0 = std::chrono::steady_clock::now();
    int ok = g_doc->pClass->saveAs(g_doc, url.c_str(), "svg", nullptr);
    auto t1 = std::chrono::steady_clock::now();
    long ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();
    long bytes = 0;
    if (ok) { struct stat st; if (::stat(path.c_str(), &st) == 0) bytes = (long)st.st_size; }
    sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":" + (ok ? "true" : "false")
             + ",\"ms\":" + std::to_string(ms) + ",\"bytes\":" + std::to_string(bytes) + "}");
}

int main(int argc, char** argv) {
    if (argc < 3) { fprintf(stderr, "usage: %s <install_path/> <fundamentalrc>\n", argv[0]); return 2; }
    std::thread writer(writerLoop);         // drains JSON/callback frames (fd3) off the engine thread
    std::thread tileWriter(tileWriterLoop); // drains tile frames (fd4)
    setenv("URE_BOOTSTRAP", (std::string("vnd.sun.star.pathname:") + argv[2]).c_str(), 1);
    g_lok = lok_init_2(argv[1], "file:///tmp/wos-lok-host-profile");
    if (!g_lok) {
        fprintf(stderr, "[host] lok_init failed\n");
        { std::lock_guard<std::mutex> lk(g_outMtx); g_outDone = true; } g_outCv.notify_one(); writer.join();
        { std::lock_guard<std::mutex> lk(g_tileMtx); g_tileDone = true; } g_tileCv.notify_one(); tileWriter.join();
        return 1;
    }
    fprintf(stderr, "[host] engine ready\n");
    sendJson("{\"event\":\"ready\"}");

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        // parse: <id> <cmd> [rest]
        size_t s1 = line.find(' ');
        if (s1 == std::string::npos) continue;
        long id = strtol(line.substr(0, s1).c_str(), nullptr, 10);
        size_t s2 = line.find(' ', s1 + 1);
        std::string cmd = line.substr(s1 + 1, (s2 == std::string::npos ? std::string::npos : s2 - s1 - 1));
        std::string rest = (s2 == std::string::npos) ? "" : line.substr(s2 + 1);

        if (cmd == "ping") {
            sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true,\"pong\":true}");
        } else if (cmd == "open") {
            cmdOpen(id, rest);
        } else if (cmd == "openopts") {
            // "openopts <filterOptions>\t<path>" — tab-separated, since a path
            // can contain spaces and a filter token never contains a tab.
            size_t tab = rest.find('\t');
            if (tab == std::string::npos)
                sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad openopts args\"}");
            else
                cmdOpen(id, rest.substr(tab + 1), rest.substr(0, tab));
        } else if (cmd == "new") {
            size_t sp = rest.find(' ');
            if (sp == std::string::npos)
                sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad new args\"}");
            else
                cmdNew(id, rest.substr(0, sp), rest.substr(sp + 1));
        } else if (cmd == "size") {
            cmdSize(id);
        } else if (cmd == "parts") {
            cmdParts(id);
        } else if (cmd == "cmdvals") {
            cmdVals(id, rest);
        } else if (cmd == "tile") {
            int cw, ch, tx, ty, tw, th;
            if (sscanf(rest.c_str(), "%d %d %d %d %d %d", &cw, &ch, &tx, &ty, &tw, &th) == 6)
                cmdTile(id, cw, ch, tx, ty, tw, th);
            else
                sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad tile args\"}");
        } else if (cmd == "tiles") {
            cmdTiles(id, rest);
        } else if (cmd == "parttile") {
            int part, cw, ch, tx, ty, tw, th;
            if (sscanf(rest.c_str(), "%d %d %d %d %d %d %d", &part, &cw, &ch, &tx, &ty, &tw, &th) == 7)
                cmdPartTile(id, part, cw, ch, tx, ty, tw, th);
            else
                sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad parttile args\"}");
        } else if (cmd == "key") {
            int t, cc, kc;
            if (sscanf(rest.c_str(), "%d %d %d", &t, &cc, &kc) == 3) cmdKey(id, t, cc, kc);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad key args\"}");
        } else if (cmd == "mouse") {
            int t, x, y, n, b, m;
            if (sscanf(rest.c_str(), "%d %d %d %d %d %d", &t, &x, &y, &n, &b, &m) == 6) cmdMouse(id, t, x, y, n, b, m);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad mouse args\"}");
        } else if (cmd == "uno") {
            // "<.uno:Command> [json-args]" — args (with spaces) optional.
            size_t sp = rest.find(' ');
            if (sp == std::string::npos) cmdUno(id, rest, "");
            else cmdUno(id, rest.substr(0, sp), rest.substr(sp + 1));
        } else if (cmd == "getsel") {
            // WOS-009: "<mime>" — defaults to plain text.
            cmdGetSel(id, rest.empty() ? "text/plain;charset=utf-8" : rest);
        } else if (cmd == "pastebuf") {
            // WOS-009: "<mime> <base64>". Mime types never contain a space.
            size_t sp = rest.find(' ');
            if (sp == std::string::npos)
                sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad pastebuf args\"}");
            else
                cmdPasteBuf(id, rest.substr(0, sp), rest.substr(sp + 1));
        } else if (cmd == "wpaint") {
            int wi, w, h;
            if (sscanf(rest.c_str(), "%d %d %d", &wi, &w, &h) == 3) cmdWPaint(id, wi, w, h);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad wpaint\"}");
        } else if (cmd == "wmouse") {
            int wi, t, x, y, n, b, m;
            if (sscanf(rest.c_str(), "%d %d %d %d %d %d %d", &wi, &t, &x, &y, &n, &b, &m) == 7) cmdWMouse(id, wi, t, x, y, n, b, m);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad wmouse\"}");
        } else if (cmd == "wkey") {
            int wi, t, cc, kc;
            if (sscanf(rest.c_str(), "%d %d %d %d", &wi, &t, &cc, &kc) == 4) cmdWKey(id, wi, t, cc, kc);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad wkey\"}");
        } else if (cmd == "dlgevent") {
            // "<winId> <json>"
            size_t sp = rest.find(' ');
            if (sp == std::string::npos) sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad dlgevent\"}");
            else cmdDlgEvent(id, strtoull(rest.substr(0, sp).c_str(), nullptr, 10), rest.substr(sp + 1));
        } else if (cmd == "wclose") {
            int wi;
            if (sscanf(rest.c_str(), "%d", &wi) == 1) cmdWClose(id, wi);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad wclose\"}");
        } else if (cmd == "setpart") {
            int n;
            if (sscanf(rest.c_str(), "%d", &n) == 1) cmdSetPart(id, n);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad part arg\"}");
        } else if (cmd == "export") {
            size_t sp = rest.find(' ');
            if (sp == std::string::npos)
                sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad export args\"}");
            else
                cmdExport(id, rest.substr(0, sp), rest.substr(sp + 1));
        } else if (cmd == "setborder") {
            char preset[32] = {0}; long color = 0; int width = 0;
            if (sscanf(rest.c_str(), "%31s %ld %d", preset, &color, &width) >= 1) cmdSetBorder(id, preset, color, width);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad setborder\"}");
        } else if (cmd == "setsize") {
            char kind[8] = {0}; long index = 0, size = 0;
            if (sscanf(rest.c_str(), "%7s %ld %ld", kind, &index, &size) == 3) cmdSetSize(id, kind, index, size);
            else sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad setsize\"}");
        } else if (cmd == "macro") {
            size_t sp = rest.find(' ');
            std::string name = sp == std::string::npos ? rest : rest.substr(0, sp);
            std::string args = sp == std::string::npos ? "" : rest.substr(sp + 1);
            cmdRunMacro(id, name, args);
        } else if (cmd == "svgspike") {
            cmdSvgSpike(id, rest);
        } else if (cmd == "testcb") {
            // Test hook: inject a callback through the REAL lokCallback path
            // (coalescing, droppability, framing) — the engine rarely emits
            // INVALIDATE_TILES headlessly, so protocol tests use this.
            int t = 0, used = 0;
            if (sscanf(rest.c_str(), "%d%n", &t, &used) == 1) {
                std::string payload = rest.substr(used);
                if (!payload.empty() && payload[0] == ' ') payload.erase(0, 1);
                lokCallback(t, payload.c_str(), (void*)g_doc);
                sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
            } else {
                sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"bad testcb\"}");
            }
        } else if (cmd == "save") {
            cmdSave(id);
        } else if (cmd == "closedoc") {
            cmdCloseDoc(id, rest);
        } else if (cmd == "close") {
            for (auto& e : g_cache) e.doc->pClass->destroy(e.doc);
            g_cache.clear();
            g_doc = nullptr; g_docUrl.clear(); g_docPath.clear();
            sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":true}");
        } else {
            sendJson("{\"id\":" + std::to_string(id) + ",\"ok\":false,\"err\":\"unknown cmd\"}");
        }
    }

    for (auto& e : g_cache) e.doc->pClass->destroy(e.doc);
    g_cache.clear();
    g_lok->pClass->destroy(g_lok);
    { std::lock_guard<std::mutex> lk(g_outMtx); g_outDone = true; } // flush + stop the writers
    g_outCv.notify_one();
    writer.join();
    { std::lock_guard<std::mutex> lk(g_tileMtx); g_tileDone = true; }
    g_tileCv.notify_one();
    tileWriter.join();
    fprintf(stderr, "[host] exit\n");
    return 0;
}
