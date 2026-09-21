// Feasibility probe: can the LOK host reach the loaded document's UNO model and
// apply a model-level format (cell border) that LOK dispatch can't? If yes, the
// UNO host bridge is viable (unlocks borders, page setup, conditional formatting…).
#define LOK_USE_UNSTABLE_API
#include "LibreOfficeKit/LibreOfficeKit.h"
#include "LibreOfficeKit/LibreOfficeKitInit.h"

#include <com/sun/star/uno/Reference.hxx>
#include <com/sun/star/uno/XComponentContext.hpp>
#include <comphelper/processfactory.hxx>
#include <com/sun/star/frame/Desktop.hpp>
#include <com/sun/star/lang/XComponent.hpp>
#include <com/sun/star/sheet/XSpreadsheetDocument.hpp>
#include <com/sun/star/sheet/XSpreadsheets.hpp>
#include <com/sun/star/sheet/XSpreadsheet.hpp>
#include <com/sun/star/container/XIndexAccess.hpp>
#include <com/sun/star/table/XCellRange.hpp>
#include <com/sun/star/beans/XPropertySet.hpp>
#include <com/sun/star/table/TableBorder2.hpp>
#include <com/sun/star/table/BorderLine2.hpp>
#include <com/sun/star/table/BorderLineStyle.hpp>

#include <cstdio>
#include <string>

using namespace com::sun::star;
using uno::Reference;
using uno::UNO_QUERY;
using uno::UNO_QUERY_THROW;

int main(int argc, char** argv) {
  if (argc < 3) { fprintf(stderr, "usage: uno-probe <install/> <fundamentalrc> [file.xlsx]\n"); return 2; }
  LibreOfficeKit* lok = lok_init_2(argv[1], "file:///tmp/wos-lok-host-profile");
  if (!lok) { fprintf(stderr, "lok_init failed\n"); return 1; }

  const char* url = (argc > 3) ? argv[3] : "file:///tmp/wos-test/unoborder.xlsx";
  LibreOfficeKitDocument* doc = lok->pClass->documentLoad(lok, url);
  if (!doc) { fprintf(stderr, "documentLoad failed for %s\n", url); return 1; }
  fprintf(stderr, "[probe] LOK loaded %s\n", url);

  try {
    Reference<uno::XComponentContext> ctx = ::comphelper::getProcessComponentContext();
    if (!ctx.is()) { fprintf(stderr, "[probe] NO process component context\n"); return 1; }
    Reference<frame::XDesktop2> desktop = frame::Desktop::create(ctx);
    Reference<lang::XComponent> comp = desktop->getCurrentComponent();
    if (!comp.is()) { fprintf(stderr, "[probe] NO current component\n"); return 1; }

    Reference<sheet::XSpreadsheetDocument> sdoc(comp, UNO_QUERY);
    if (!sdoc.is()) { fprintf(stderr, "[probe] current component is not a spreadsheet\n"); return 1; }
    Reference<container::XIndexAccess> sheets(sdoc->getSheets(), UNO_QUERY_THROW);
    Reference<sheet::XSpreadsheet> sheet(sheets->getByIndex(0), UNO_QUERY_THROW);
    Reference<table::XCellRange> range(sheet->getCellRangeByName("A1:B2"), UNO_QUERY_THROW);
    Reference<beans::XPropertySet> props(range, UNO_QUERY_THROW);

    table::BorderLine2 line;
    line.LineStyle = table::BorderLineStyle::SOLID;
    line.LineWidth = 26; // ~0.5pt in 1/100 mm
    line.Color = 0x000000;
    table::TableBorder2 border;
    border.TopLine = line; border.BottomLine = line; border.LeftLine = line; border.RightLine = line;
    border.IsTopLineValid = border.IsBottomLineValid = border.IsLeftLineValid = border.IsRightLineValid = true;
    props->setPropertyValue("TableBorder2", uno::Any(border));
    fprintf(stderr, "[probe] border applied via UNO model OK\n");
  } catch (const uno::Exception& e) {
    fprintf(stderr, "[probe] UNO exception: %s\n", std::string(rtl::OUStringToOString(e.Message, RTL_TEXTENCODING_UTF8).getStr()).c_str());
    return 1;
  }

  // Save via LOK so we exercise the same save path the host uses.
  int ok = doc->pClass->saveAs(doc, url, "xlsx", nullptr);
  fprintf(stderr, "[probe] saveAs returned %d\n", ok);
  printf("PROBE_OK\n");
  return 0;
}
