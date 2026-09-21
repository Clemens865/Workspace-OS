// wos-uno-helper — UNO model operations (cell borders, …) exposed as a C ABI.
// The host dlopen()s this AFTER lok_init has bootstrapped the engine, so the UNO
// libraries never load at process start (which hangs the bundled engine's
// lok_init). By the time this loads, the process component context is ready.
#include <com/sun/star/uno/Reference.hxx>
#include <com/sun/star/uno/XComponentContext.hpp>
#include <comphelper/processfactory.hxx>
#include <cppuhelper/bootstrap.hxx>
#include <com/sun/star/frame/Desktop.hpp>
#include <com/sun/star/frame/XModel.hpp>
#include <com/sun/star/frame/XController.hpp>
#include <com/sun/star/view/XSelectionSupplier.hpp>
#include <com/sun/star/lang/XComponent.hpp>
#include <com/sun/star/lang/XMultiServiceFactory.hpp>
#include <com/sun/star/container/XEnumerationAccess.hpp>
#include <com/sun/star/container/XEnumeration.hpp>
#include <rtl/ustring.hxx>
#include <com/sun/star/beans/XPropertySet.hpp>
#include <com/sun/star/table/TableBorder2.hpp>
#include <com/sun/star/table/BorderLine2.hpp>
#include <com/sun/star/table/BorderLineStyle.hpp>
#include <rtl/string.hxx>
#include <cstdio>
#include <cstring>

using namespace com::sun::star;

// Returns 1 on success, 0 on failure. preset ∈ all/outer/inner/none/top/bottom/left/right.
#define HLOG(msg) do { fprintf(stderr, "[helper] " msg "\n"); fflush(stderr); } while (0)

extern "C" int wos_set_border(const char* presetC, long color, int width, const char* urlC) {
    if (!presetC) return 0;
    std::string preset(presetC);
    if (width <= 0) width = 26;
    HLOG("enter");
    try {
        uno::Reference<uno::XComponentContext> ctx;
        try { ctx = ::comphelper::getProcessComponentContext(); HLOG("got process ctx"); }
        catch (const uno::Exception&) { HLOG("process ctx threw (null factory)"); }
        if (!ctx.is()) {
            // The bundled engine's lok_init leaves the process service factory null;
            // bootstrap a context from the same in-process URE (shared service
            // manager → getCurrentComponent still sees the LOK-loaded doc), and
            // adopt it as the process context so later calls reuse it.
            ctx = ::cppu::defaultBootstrap_InitialComponentContext();
            uno::Reference<lang::XMultiServiceFactory> smgr(ctx->getServiceManager(), uno::UNO_QUERY);
            if (smgr.is()) ::comphelper::setProcessServiceFactory(smgr);
            fprintf(stderr, "[helper] bootstrapped fallback context: %d\n", ctx.is());
        }
        if (!ctx.is()) { fprintf(stderr, "[helper] no ctx\n"); return 0; }
        uno::Reference<frame::XDesktop2> desktop = frame::Desktop::create(ctx);
        if (!desktop.is()) { HLOG("no desktop"); return 0; }
        HLOG("got desktop");
        // Target the exact model LOK has open by matching its URL — the
        // bootstrapped desktop's getCurrentComponent may point elsewhere.
        uno::Reference<frame::XModel> model;
        if (urlC && *urlC) {
            uno::Reference<container::XEnumerationAccess> ea(desktop->getComponents(), uno::UNO_QUERY);
            if (ea.is()) {
                uno::Reference<container::XEnumeration> en = ea->createEnumeration();
                rtl::OUString want = rtl::OUString::fromUtf8(urlC);
                while (en.is() && en->hasMoreElements()) {
                    uno::Reference<frame::XModel> m(en->nextElement(), uno::UNO_QUERY);
                    if (m.is() && m->getURL() == want) { model = m; break; }
                }
            }
        }
        if (!model.is()) model.set(desktop->getCurrentComponent(), uno::UNO_QUERY);
        if (!model.is()) { HLOG("no model"); return 0; }
        HLOG("got model");
        uno::Reference<view::XSelectionSupplier> selsup(model->getCurrentController(), uno::UNO_QUERY);
        if (!selsup.is()) { HLOG("no selsup"); return 0; }
        uno::Reference<beans::XPropertySet> props(selsup->getSelection(), uno::UNO_QUERY);
        if (!props.is()) { HLOG("no selection props"); return 0; }
        HLOG("got selection");

        table::BorderLine2 line; line.LineStyle = table::BorderLineStyle::SOLID; line.LineWidth = width; line.Color = (sal_Int32)color;
        table::BorderLine2 empty; empty.LineStyle = table::BorderLineStyle::NONE; empty.LineWidth = 0; empty.Color = 0;
        table::TableBorder2 b{};
        auto outer = [&](const table::BorderLine2& l) { b.TopLine = l; b.BottomLine = l; b.LeftLine = l; b.RightLine = l; b.IsTopLineValid = b.IsBottomLineValid = b.IsLeftLineValid = b.IsRightLineValid = true; };
        auto inner = [&](const table::BorderLine2& l) { b.HorizontalLine = l; b.VerticalLine = l; b.IsHorizontalLineValid = b.IsVerticalLineValid = true; };
        if (preset == "all") { outer(line); inner(line); }
        else if (preset == "outer") { outer(line); inner(empty); }
        else if (preset == "inner") { inner(line); }
        else if (preset == "none") { outer(empty); inner(empty); }
        else if (preset == "top") { b.TopLine = line; b.IsTopLineValid = true; }
        else if (preset == "bottom") { b.BottomLine = line; b.IsBottomLineValid = true; }
        else if (preset == "left") { b.LeftLine = line; b.IsLeftLineValid = true; }
        else if (preset == "right") { b.RightLine = line; b.IsRightLineValid = true; }
        else return 0;

        props->setPropertyValue("TableBorder2", uno::Any(b));
        HLOG("applied");
        return 1;
    } catch (const uno::Exception& e) {
        fprintf(stderr, "[helper] uno exception: %s\n",
                rtl::OUStringToOString(e.Message, RTL_TEXTENCODING_UTF8).getStr());
        return 0;
    }
}
