// M0 validation probe: prove a LibreOffice build can be driven via
// LibreOfficeKit on macOS — init the engine, load a doc, paint the first tile,
// write it as a PPM, and report whether anything was actually rendered.
//
//   lokprobe <install_path/> <doc> <out.ppm> [fundamentalrc]
//
// install_path must end with '/' and contain libmergedlo.dylib.
// The macOS .app splits libs (Contents/Frameworks) from the URE bootstrap
// (Contents/Resources); pass the Resources/fundamentalrc as the 4th arg and the
// probe sets URE_BOOTSTRAP so the engine can find it.
//
// Exit codes: 0 = rendered (non-blank tile), 1 = failed, 2 = bad args,
//             3 = painted but blank.
//
// The stock TDF macOS desktop build is expected to FAIL here (no svp headless
// VCL plugin → Aqua init crashes off the main thread). A build configured with
// --enable-headless --disable-gui is expected to PASS. That contrast is the
// whole point of this probe.

#define LOK_USE_UNSTABLE_API
#include "LibreOfficeKit/LibreOfficeKit.h"
#include "LibreOfficeKit/LibreOfficeKitInit.h"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

int main(int argc, char** argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: %s <install_path/> <doc> <out.ppm> [fundamentalrc]\n", argv[0]);
        return 2;
    }
    const char* install = argv[1];
    const char* docPath = argv[2];
    const char* outPath = argv[3];

    if (argc >= 5) {
        std::string boot = std::string("vnd.sun.star.pathname:") + argv[4];
        setenv("URE_BOOTSTRAP", boot.c_str(), 1);
        fprintf(stderr, "[probe] URE_BOOTSTRAP=%s\n", boot.c_str());
    }

    const char* profile = "file:///tmp/wos-lok-profile";
    fprintf(stderr, "[probe] lok_init_2(install=%s)\n", install);
    LibreOfficeKit* lok = lok_init_2(install, profile);
    if (!lok) {
        fprintf(stderr, "[probe] FAIL: lok_init_2 returned NULL\n");
        return 1;
    }
    fprintf(stderr, "[probe] engine initialized OK\n");

    std::string url = std::string("file://") + docPath;
    LibreOfficeKitDocument* doc = lok->pClass->documentLoad(lok, url.c_str());
    if (!doc) {
        char* err = lok->pClass->getError(lok);
        fprintf(stderr, "[probe] FAIL: documentLoad: %s\n", err ? err : "(null)");
        return 1;
    }
    fprintf(stderr, "[probe] documentLoad OK (type=%d, parts=%d)\n",
            doc->pClass->getDocumentType(doc), doc->pClass->getParts(doc));

    doc->pClass->initializeForRendering(doc, "");

    long twW = 0, twH = 0;
    doc->pClass->getDocumentSize(doc, &twW, &twH);
    fprintf(stderr, "[probe] document size: %ld x %ld twips (%.1f x %.1f in)\n",
            twW, twH, twW / 1440.0, twH / 1440.0);
    if (twW <= 0 || twH <= 0) { fprintf(stderr, "[probe] FAIL: zero doc size\n"); return 1; }

    const int canvasW = 1024;
    long tileW = twW;
    long tileH = (twH < tileW * 11 / 8) ? twH : tileW * 11 / 8; // cap ~one page
    int canvasH = (int)((double)canvasW * tileH / tileW);
    if (canvasH < 1) canvasH = 1;

    std::vector<unsigned char> buf((size_t)canvasW * canvasH * 4, 0);
    fprintf(stderr, "[probe] paintTile canvas=%dx%d tile=%ldx%ld twips\n",
            canvasW, canvasH, tileW, tileH);
    doc->pClass->paintTile(doc, buf.data(), canvasW, canvasH, 0, 0, (int)tileW, (int)tileH);

    long nonWhite = 0;
    for (size_t i = 0; i + 3 < buf.size(); i += 4) {
        if (buf[i] < 250 || buf[i+1] < 250 || buf[i+2] < 250) nonWhite++;
    }
    fprintf(stderr, "[probe] non-white pixels: %ld / %d\n", nonWhite, canvasW * canvasH);

    FILE* f = fopen(outPath, "wb");
    if (!f) { fprintf(stderr, "[probe] FAIL: cannot open %s\n", outPath); return 1; }
    fprintf(f, "P6\n%d %d\n255\n", canvasW, canvasH);
    for (size_t i = 0; i + 3 < buf.size(); i += 4) {
        unsigned char rgb[3] = { buf[i+2], buf[i+1], buf[i] };
        fwrite(rgb, 1, 3, f);
    }
    fclose(f);
    fprintf(stderr, "[probe] wrote %s\n", outPath);

    doc->pClass->destroy(doc);
    lok->pClass->destroy(lok);
    fprintf(stderr, "[probe] SUCCESS\n");
    return (nonWhite > 0) ? 0 : 3;
}
