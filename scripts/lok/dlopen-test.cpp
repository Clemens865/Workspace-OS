#define LOK_USE_UNSTABLE_API
#include "LibreOfficeKit/LibreOfficeKit.h"
#include "LibreOfficeKit/LibreOfficeKitInit.h"
#include <dlfcn.h>
#include <cstdio>
#include <cstdlib>
#include <string>
// argv: <install/> <fundamentalrc> <file-url> <helper.dylib>
int main(int argc, char** argv) {
  setenv("URE_BOOTSTRAP", (std::string("vnd.sun.star.pathname:") + argv[2]).c_str(), 1);
  LibreOfficeKit* lok = lok_init_2(argv[1], "file:///tmp/wos-lok-host-profile");
  if (!lok) { fprintf(stderr, "lok_init failed\n"); return 1; }
  fprintf(stderr, "INIT_OK\n");
  LibreOfficeKitDocument* doc = lok->pClass->documentLoad(lok, argv[3]);
  if (!doc) { fprintf(stderr, "load failed\n"); return 1; }
  fprintf(stderr, "LOAD_OK\n");
  void* h = dlopen(argv[4], RTLD_NOW | RTLD_LOCAL);
  if (!h) { fprintf(stderr, "dlopen failed: %s\n", dlerror()); return 1; }
  fprintf(stderr, "DLOPEN_OK\n");
  typedef int (*fn)(const char*, long, int);
  fn f = (fn)dlsym(h, "wos_set_border");
  if (!f) { fprintf(stderr, "dlsym failed\n"); return 1; }
  int r = f("all", 0, 26);
  fprintf(stderr, "SETBORDER=%d\n", r);
  int ok = doc->pClass->saveAs(doc, argv[3], "xlsx", nullptr);
  fprintf(stderr, "SAVE=%d\n", ok);
  return 0;
}
