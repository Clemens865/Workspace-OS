import fs from 'fs'
import path from 'path'
import { assertBasicModuleValid } from './validateBasicModule'

/**
 * Engine profile + model-API macro seeding for the LOK sidecar. Split out of
 * lokHost.ts — this is configuration payload (registry XCU + the Wos* Basic
 * macro library), not protocol logic.
 */

// The host's LibreOffice user profile (must match wos-lok-host.cpp's lok_init).
const ENGINE_PROFILE = '/tmp/wos-lok-host-profile'

// Disable LibreOffice document locking. The bundled engine is the SOLE editor of
// these files, so the per-document `.~lock.<file>#` files serve no purpose and,
// after any unclean exit, make the file reopen READ-ONLY (renders but won't
// accept input — the "can't type into the sheet" bug). Turning locking off also
// makes LO ignore any pre-existing stale lock, so already-locked files become
// editable again.
// Registry: disable doc locking (above) + allow macro execution (MacroSecurityLevel
// 0) so the model-API Basic macros below can run via LOK's runMacro.
const PROFILE_XCU =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
  ' <item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseDocumentSystemFileLocking" oor:op="fuse"><value>false</value></prop></item>\n' +
  ' <item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseDocumentOOoLockFile" oor:op="fuse"><value>false</value></prop></item>\n' +
  ' <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>0</value></prop></item>\n' +
  '</oor:items>\n'

const BASIC_XLC =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE library:libraries PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "libraries.dtd">\n' +
  '<library:libraries xmlns:library="http://openoffice.org/2000/library" xmlns:xlink="http://www.w3.org/1999/xlink">\n' +
  ' <library:library library:name="Standard" xlink:href="$(USER)/basic/Standard/script.xlb/" xlink:type="simple" library:link="false"/>\n' +
  '</library:libraries>\n'

const BASIC_XLB =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd">\n' +
  '<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false">\n' +
  ' <library:element library:name="Module1"/>\n' +
  ' <library:element library:name="Module2"/>\n' +
  ' <library:element library:name="Module3"/>\n' +
  '</library:library>\n'

// Model-API macros run by the host via LOK runMacro. Reaches ThisComponent (the
// real loaded doc) in the engine's own context, so changes persist — the only
// way to set cell borders etc. in the bundled engine (where the UNO process
// factory is unset). Params come from /tmp/wos-macro-args.txt (runMacro takes
// only a URL).
export const BASIC_MODULE =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">\n' +
  '<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">\n' +
  // Resolves the document the host considers active (matched by filesystem path),
  // since Basic ThisComponent goes stale across multi-doc switches. Falls back to
  // ThisComponent when the path file is missing/unmatched (single-doc case).
  'Function WosActiveDoc As Object\n' +
  '  Dim sPath As String, f As Integer, oEnum, oComp\n' +
  '  WosActiveDoc = ThisComponent\n' +
  '  On Error Resume Next\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-doc.txt" For Input As #f\n' +
  '  Line Input #f, sPath\n' +
  '  Close #f\n' +
  '  If Len(sPath) = 0 Then Exit Function\n' +
  '  oEnum = StarDesktop.Components.createEnumeration()\n' +
  '  Do While oEnum.hasMoreElements()\n' +
  '    oComp = oEnum.nextElement()\n' +
  '    If Not IsNull(oComp) Then\n' +
  '      If oComp.supportsService("com.sun.star.document.OfficeDocument") Then\n' +
  '        If ConvertFromURL(oComp.URL) = sPath Then\n' +
  '          WosActiveDoc = oComp\n' +
  '          Exit Function\n' +
  '        End If\n' +
  '      End If\n' +
  '    End If\n' +
  '  Loop\n' +
  'End Function\n' +
  // Returns the draw page that shapes should be added to for the given doc:
  // Calc = active sheet's draw page, Writer = the doc draw page, Impress/Draw =
  // the current slide. Lets the shape/component macros work in all three apps.
  'Function WosTargetPage(oDoc As Object) As Object\n' +
  '  On Error Resume Next\n' +
  '  WosTargetPage = Nothing\n' +
  '  If oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then\n' +
  '    WosTargetPage = oDoc.CurrentController.ActiveSheet.DrawPage\n' +
  '  ElseIf oDoc.supportsService("com.sun.star.text.TextDocument") Then\n' +
  '    WosTargetPage = oDoc.DrawPage\n' +
  '  ElseIf oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then\n' +
  '    WosTargetPage = oDoc.CurrentController.CurrentPage\n' +
  '  Else\n' +
  '    WosTargetPage = oDoc.DrawPages.getByIndex(0)\n' +
  '  End If\n' +
  '  If IsNull(WosTargetPage) Then WosTargetPage = oDoc.DrawPages.getByIndex(0)\n' +
  'End Function\n' +
  'Sub WosSetBorder\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-args.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim preset As String, col As Long, wid As Long\n' +
  '  preset = parts(0)\n' +
  '  col = CLng(parts(1))\n' +
  '  wid = CLng(parts(2))\n' +
  '  Dim oSel\n' +
  '  oSel = WosActiveDoc().CurrentController.Selection\n' +
  '  Dim oLine As New com.sun.star.table.BorderLine2\n' +
  '  Dim oEmpty As New com.sun.star.table.BorderLine2\n' +
  '  oLine.LineWidth = wid\n' +
  '  oLine.Color = col\n' +
  '  Dim oTB As New com.sun.star.table.TableBorder2\n' +
  '  If preset = "all" Then\n' +
  '    oTB.TopLine = oLine : oTB.BottomLine = oLine : oTB.LeftLine = oLine : oTB.RightLine = oLine\n' +
  '    oTB.HorizontalLine = oLine : oTB.VerticalLine = oLine\n' +
  '    oTB.IsTopLineValid = True : oTB.IsBottomLineValid = True : oTB.IsLeftLineValid = True : oTB.IsRightLineValid = True\n' +
  '    oTB.IsHorizontalLineValid = True : oTB.IsVerticalLineValid = True\n' +
  '  ElseIf preset = "outer" Then\n' +
  '    oTB.TopLine = oLine : oTB.BottomLine = oLine : oTB.LeftLine = oLine : oTB.RightLine = oLine\n' +
  '    oTB.HorizontalLine = oEmpty : oTB.VerticalLine = oEmpty\n' +
  '    oTB.IsTopLineValid = True : oTB.IsBottomLineValid = True : oTB.IsLeftLineValid = True : oTB.IsRightLineValid = True\n' +
  '    oTB.IsHorizontalLineValid = True : oTB.IsVerticalLineValid = True\n' +
  '  ElseIf preset = "inner" Then\n' +
  '    oTB.HorizontalLine = oLine : oTB.VerticalLine = oLine\n' +
  '    oTB.IsHorizontalLineValid = True : oTB.IsVerticalLineValid = True\n' +
  '  ElseIf preset = "none" Then\n' +
  '    oTB.TopLine = oEmpty : oTB.BottomLine = oEmpty : oTB.LeftLine = oEmpty : oTB.RightLine = oEmpty\n' +
  '    oTB.HorizontalLine = oEmpty : oTB.VerticalLine = oEmpty\n' +
  '    oTB.IsTopLineValid = True : oTB.IsBottomLineValid = True : oTB.IsLeftLineValid = True : oTB.IsRightLineValid = True\n' +
  '    oTB.IsHorizontalLineValid = True : oTB.IsVerticalLineValid = True\n' +
  '  ElseIf preset = "top" Then\n' +
  '    oTB.TopLine = oLine : oTB.IsTopLineValid = True\n' +
  '  ElseIf preset = "bottom" Then\n' +
  '    oTB.BottomLine = oLine : oTB.IsBottomLineValid = True\n' +
  '  ElseIf preset = "left" Then\n' +
  '    oTB.LeftLine = oLine : oTB.IsLeftLineValid = True\n' +
  '  ElseIf preset = "right" Then\n' +
  '    oTB.RightLine = oLine : oTB.IsRightLineValid = True\n' +
  '  End If\n' +
  '  oSel.TableBorder2 = oTB\n' +
  'End Sub\n' +
  'Sub WosSetSize\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-size.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  Dim kind As String, idx As Long, sz As Long\n' +
  '  Dim oSheet, oCol, oRow\n' +
  '  parts = Split(args, "|")\n' +
  '  kind = parts(0)\n' +
  '  idx = CLng(parts(1))\n' +
  '  sz = CLng(parts(2))\n' +
  '  oSheet = WosActiveDoc().CurrentController.ActiveSheet\n' +
  '  If kind = "col" Then\n' +
  '    oCol = oSheet.Columns.getByIndex(idx)\n' +
  '    If sz &lt;= 0 Then\n' +
  '      oCol.OptimalWidth = True\n' +
  '    Else\n' +
  '      oCol.Width = sz\n' +
  '    End If\n' +
  '  Else\n' +
  '    oRow = oSheet.Rows.getByIndex(idx)\n' +
  '    If sz &lt;= 0 Then\n' +
  '      oRow.OptimalHeight = True\n' +
  '    Else\n' +
  '      oRow.Height = sz\n' +
  '    End If\n' +
  '  End If\n' +
  'End Sub\n' +
  // Calc sheet management via the model API.
  'Sub WosSheetOp\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim op As String\n' +
  '  op = parts(0)\n' +
  '  Dim oDoc, oSheets, oCtrl, cur As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSheets = oDoc.Sheets\n' +
  '  oCtrl = oDoc.CurrentController\n' +
  '  cur = oCtrl.ActiveSheet.RangeAddress.Sheet\n' +
  '  If op = "insert" Then\n' +
  '    Dim nm As String, n As Integer\n' +
  '    n = oSheets.Count + 1\n' +
  '    nm = "Sheet" &amp; n\n' +
  '    Do While oSheets.hasByName(nm)\n' +
  '      n = n + 1 : nm = "Sheet" &amp; n\n' +
  '    Loop\n' +
  '    oSheets.insertNewByName(nm, cur + 1)\n' +
  '    oCtrl.setActiveSheet(oSheets.getByName(nm))\n' +
  '  ElseIf op = "delete" Then\n' +
  '    If oSheets.Count &gt; 1 Then oSheets.removeByName(oCtrl.ActiveSheet.Name)\n' +
  '  ElseIf op = "rename" Then\n' +
  '    Dim nn As String\n' +
  '    nn = parts(1)\n' +
  '    If Len(nn) &gt; 0 And Not oSheets.hasByName(nn) Then oCtrl.ActiveSheet.Name = nn\n' +
  '  ElseIf op = "moveleft" Then\n' +
  '    If cur &gt; 0 Then oSheets.moveByName(oCtrl.ActiveSheet.Name, cur - 1)\n' +
  '  ElseIf op = "moveright" Then\n' +
  '    If cur &lt; oSheets.Count - 1 Then oSheets.moveByName(oCtrl.ActiveSheet.Name, cur + 1)\n' +
  // moveto|<index>: drop the active sheet at an absolute position (tab drag).
  '  ElseIf op = "moveto" Then\n' +
  '    Dim tgt As Integer\n' +
  '    tgt = CInt(parts(1))\n' +
  '    If tgt &gt; cur Then tgt = tgt + 1\n' +
  '    If tgt &gt;= 0 And tgt &lt;= oSheets.Count Then oSheets.moveByName(oCtrl.ActiveSheet.Name, tgt)\n' +
  // duplicate: a copy right after the active sheet, named "<name> (2)" (or 3, 4…).
  '  ElseIf op = "duplicate" Then\n' +
  '    Dim src As String, cp As String, k As Integer\n' +
  '    src = oCtrl.ActiveSheet.Name\n' +
  '    k = 2 : cp = src &amp; " (" &amp; k &amp; ")"\n' +
  '    Do While oSheets.hasByName(cp)\n' +
  '      k = k + 1 : cp = src &amp; " (" &amp; k &amp; ")"\n' +
  '    Loop\n' +
  '    oSheets.copyByName(src, cp, cur + 1)\n' +
  '    oCtrl.setActiveSheet(oSheets.getByName(cp))\n' +
  // hide: never the last visible sheet.
  '  ElseIf op = "hide" Then\n' +
  '    Dim vis As Integer, q As Integer\n' +
  '    vis = 0\n' +
  '    For q = 0 To oSheets.Count - 1\n' +
  '      If oSheets.getByIndex(q).IsVisible Then vis = vis + 1\n' +
  '    Next q\n' +
  '    If vis &gt; 1 Then\n' +
  '      oCtrl.ActiveSheet.IsVisible = False\n' +
  '      For q = 0 To oSheets.Count - 1\n' +
  '        If oSheets.getByIndex(q).IsVisible Then\n' +
  '          oCtrl.setActiveSheet(oSheets.getByIndex(q))\n' +
  '          Exit For\n' +
  '        End If\n' +
  '      Next q\n' +
  '    End If\n' +
  // show|<name>
  '  ElseIf op = "show" Then\n' +
  '    If oSheets.hasByName(parts(1)) Then\n' +
  '      oSheets.getByName(parts(1)).IsVisible = True\n' +
  '      oCtrl.setActiveSheet(oSheets.getByName(parts(1)))\n' +
  '    End If\n' +
  // color|<long RGB> (-1 = none)
  '  ElseIf op = "color" Then\n' +
  '    oCtrl.ActiveSheet.TabColor = CLng(parts(1))\n' +
  '  End If\n' +
  'End Sub\n' +
  // Writer table editing at the view cursor via the model API.
  'Sub WosTableOp\n' +
  '  On Error Resume Next\n' +
  '  Dim op As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, op\n' +
  '  Close #f\n' +
  '  Dim oVC, oTable, oCell, nm As String\n' +
  '  oVC = WosActiveDoc().CurrentController.ViewCursor\n' +
  '  oTable = oVC.TextTable\n' +
  '  If IsNull(oTable) Then Exit Sub\n' +
  '  oCell = oVC.Cell\n' +
  '  If IsNull(oCell) Then Exit Sub\n' +
  '  nm = oCell.CellName\n' +
  '  Dim i As Integer, colS As String, rw As Integer, cl As Integer, j As Integer\n' +
  '  i = 1\n' +
  '  Do While i &lt;= Len(nm) And Not (Mid(nm, i, 1) &gt;= "0" And Mid(nm, i, 1) &lt;= "9")\n' +
  '    i = i + 1\n' +
  '  Loop\n' +
  '  colS = Left(nm, i - 1)\n' +
  '  rw = CInt(Mid(nm, i)) - 1\n' +
  '  cl = 0\n' +
  '  For j = 1 To Len(colS)\n' +
  '    cl = cl * 26 + (Asc(Mid(colS, j, 1)) - 64)\n' +
  '  Next j\n' +
  '  cl = cl - 1\n' +
  '  If op = "rowafter" Then\n' +
  '    oTable.Rows.insertByIndex(rw + 1, 1)\n' +
  '  ElseIf op = "rowbefore" Then\n' +
  '    oTable.Rows.insertByIndex(rw, 1)\n' +
  '  ElseIf op = "colafter" Then\n' +
  '    oTable.Columns.insertByIndex(cl + 1, 1)\n' +
  '  ElseIf op = "colbefore" Then\n' +
  '    oTable.Columns.insertByIndex(cl, 1)\n' +
  '  ElseIf op = "delrow" Then\n' +
  '    oTable.Rows.removeByIndex(rw, 1)\n' +
  '  ElseIf op = "delcol" Then\n' +
  '    oTable.Columns.removeByIndex(cl, 1)\n' +
  '  End If\n' +
  'End Sub\n' +
  // Impress/Draw: insert a shape on the current slide (rect/ellipse/line/arrow/
  // text box), give it a default fill, and select it. args = "kind|color".
  'Sub WosShapeInsert\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim kind As String, col As Long\n' +
  '  kind = parts(0)\n' +
  '  col = RGB(91, 155, 213)\n' +
  '  If UBound(parts) &gt;= 1 Then col = CLng(parts(1))\n' +
  '  Dim oDoc, oPage, oShape, svc As String\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPage = WosTargetPage(oDoc)\n' +
  '  If kind = "ellipse" Then\n' +
  '    svc = "com.sun.star.drawing.EllipseShape"\n' +
  '  ElseIf kind = "line" Or kind = "arrow" Then\n' +
  '    svc = "com.sun.star.drawing.LineShape"\n' +
  '  ElseIf kind = "text" Then\n' +
  '    svc = "com.sun.star.drawing.TextShape"\n' +
  '  Else\n' +
  '    svc = "com.sun.star.drawing.RectangleShape"\n' +
  '  End If\n' +
  '  oShape = oDoc.createInstance(svc)\n' +
  '  Dim oSize As New com.sun.star.awt.Size, oPos As New com.sun.star.awt.Point\n' +
  '  If kind = "line" Or kind = "arrow" Then\n' +
  '    oSize.Width = 8000 : oSize.Height = 1\n' +
  '  Else\n' +
  '    oSize.Width = 7000 : oSize.Height = 4500\n' +
  '  End If\n' +
  '  oPos.X = 5000 : oPos.Y = 5000\n' +
  '  oPage.add(oShape)\n' +
  '  oShape.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PAGE\n' +
  '  oShape.Size = oSize\n' +
  '  oShape.Position = oPos\n' +
  '  If kind = "line" Or kind = "arrow" Then\n' +
  '    oShape.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '    oShape.LineWidth = 60\n' +
  '    oShape.LineColor = RGB(64, 64, 64)\n' +
  '    If kind = "arrow" Then\n' +
  '      oShape.LineEndName = "Arrow"\n' +
  '      oShape.LineEndWidth = 400\n' +
  '    End If\n' +
  '  ElseIf kind = "text" Then\n' +
  '    oShape.TextAutoGrowHeight = True\n' +
  '    oShape.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '    oShape.setString("Text")\n' +
  '  Else\n' +
  '    oShape.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '    oShape.FillColor = col\n' +
  '    oShape.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '    oShape.LineColor = RGB(31, 78, 121)\n' +
  '    If kind = "roundrect" Then oShape.CornerRadius = 900\n' +
  '  End If\n' +
  '  oDoc.CurrentController.select(oShape)\n' +
  // The renderer never sees a selection made inside a macro (callbacks are
  // muted); it clicks the new shape instead, so report where it landed (1/100 mm).
  '  Dim sf As Integer\n' +
  '  sf = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #sf\n' +
  '  Print #sf, oShape.Position.X &amp; "|" &amp; oShape.Position.Y &amp; "|" &amp; oShape.Size.Width &amp; "|" &amp; oShape.Size.Height\n' +
  '  Close #sf\n' +
  'End Sub\n' +
  // Impress/Draw: recolor the selected shape(s). which = fill|line; a negative
  // color clears it (no fill / no line). args = "which|color".
  'Sub WosShapeColor\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim which As String, col As Long\n' +
  '  which = parts(0)\n' +
  '  col = CLng(parts(1))\n' +
  '  Dim oDoc, oSel, oShape, i As Integer, n As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  For i = 0 To n - 1\n' +
  '    oShape = oSel.getByIndex(i)\n' +
  '    If which = "fill" Then\n' +
  '      If col &lt; 0 Then\n' +
  '        oShape.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '      Else\n' +
  '        oShape.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '        oShape.FillColor = col\n' +
  '      End If\n' +
  '    ElseIf which = "line" Then\n' +
  '      If col &lt; 0 Then\n' +
  '        oShape.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '      Else\n' +
  '        oShape.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '        If oShape.LineWidth &lt; 1 Then oShape.LineWidth = 35\n' +
  '        oShape.LineColor = col\n' +
  '      End If\n' +
  '    End If\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Impress: set the slide background fill. scope = one|all; negative color clears
  // it. args = "scope|color".
  'Sub WosSlideBg\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim scope As String, col As Long\n' +
  '  scope = parts(0)\n' +
  '  col = CLng(parts(1))\n' +
  '  Dim oDoc, oSlides, oSlide, k As Integer, startI As Integer, endI As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSlides = oDoc.DrawPages\n' +
  '  If scope = "all" Then\n' +
  '    startI = 0 : endI = oSlides.Count - 1\n' +
  '  Else\n' +
  '    Dim cur As Integer\n' +
  '    cur = 0\n' +
  '    cur = oDoc.CurrentController.CurrentPage.Number - 1\n' +
  '    If cur &lt; 0 Then cur = 0\n' +
  '    startI = cur : endI = cur\n' +
  '  End If\n' +
  // The slide Background property is non-functional in this engine, so the
  // background is a full-slide, locked, back-most rectangle named "WosBg".
  '  Dim j As Integer, sh, oRect\n' +
  '  For k = startI To endI\n' +
  '    oSlide = oSlides.getByIndex(k)\n' +
  '    For j = oSlide.Count - 1 To 0 Step -1\n' +
  '      sh = oSlide.getByIndex(j)\n' +
  '      If sh.Name = "WosBg" Then oSlide.remove(sh)\n' +
  '    Next j\n' +
  '    If col &gt;= 0 Then\n' +
  '      Dim oSize As New com.sun.star.awt.Size, oPos As New com.sun.star.awt.Point\n' +
  '      oRect = oDoc.createInstance("com.sun.star.drawing.RectangleShape")\n' +
  '      oSlide.add(oRect)\n' +
  '      oSize.Width = oSlide.Width : oSize.Height = oSlide.Height\n' +
  '      oPos.X = 0 : oPos.Y = 0\n' +
  '      oRect.Size = oSize\n' +
  '      oRect.Position = oPos\n' +
  '      oRect.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '      oRect.FillColor = col\n' +
  '      oRect.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '      oRect.Name = "WosBg"\n' +
  '      oRect.ZOrder = 0\n' +
  '      oRect.MoveProtect = True\n' +
  '      oRect.SizeProtect = True\n' +
  '    End If\n' +
  '  Next k\n' +
  'End Sub\n' +
  // Impress: style the text of the selected shape(s). prop = color|size|font|
  // bold|italic|align (bold/italic toggle). args = "prop|value".
  'Sub WosShapeText\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim prop As String, sval As String\n' +
  '  prop = parts(0)\n' +
  '  sval = ""\n' +
  '  If UBound(parts) &gt;= 1 Then sval = parts(1)\n' +
  '  Dim oDoc, oSel, oShape, oText, oCur, i As Integer, n As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  For i = 0 To n - 1\n' +
  '    oShape = oSel.getByIndex(i)\n' +
  '    oText = oShape.Text\n' +
  '    oCur = oText.createTextCursor()\n' +
  '    oCur.gotoStart(False)\n' +
  '    oCur.gotoEnd(True)\n' +
    // settext acts on the whole shape, not the cursor.
  '    If prop = "settext" Then\n' +
  '      oShape.setString(sval)\n' +
  '    ElseIf prop = "color" Then\n' +
  '      oCur.CharColor = CLng(sval)\n' +
  '    ElseIf prop = "size" Then\n' +
  '      oCur.CharHeight = CSng(sval)\n' +
  '    ElseIf prop = "font" Then\n' +
  '      oCur.CharFontName = sval\n' +
  '    ElseIf prop = "bold" Then\n' +
  '      If oCur.CharWeight &gt;= com.sun.star.awt.FontWeight.BOLD Then\n' +
  '        oCur.CharWeight = com.sun.star.awt.FontWeight.NORMAL\n' +
  '      Else\n' +
  '        oCur.CharWeight = com.sun.star.awt.FontWeight.BOLD\n' +
  '      End If\n' +
  '    ElseIf prop = "italic" Then\n' +
  '      If oCur.CharPosture = com.sun.star.awt.FontSlant.ITALIC Then\n' +
  '        oCur.CharPosture = com.sun.star.awt.FontSlant.NONE\n' +
  '      Else\n' +
  '        oCur.CharPosture = com.sun.star.awt.FontSlant.ITALIC\n' +
  '      End If\n' +
  '    ElseIf prop = "align" Then\n' +
  '      If sval = "center" Then\n' +
  '        oCur.ParaAdjust = com.sun.star.style.ParagraphAdjust.CENTER\n' +
  '      ElseIf sval = "right" Then\n' +
  '        oCur.ParaAdjust = com.sun.star.style.ParagraphAdjust.RIGHT\n' +
  '      Else\n' +
  '        oCur.ParaAdjust = com.sun.star.style.ParagraphAdjust.LEFT\n' +
  '      End If\n' +
  '    End If\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Impress: fill/effect on the selected shape(s). eff = gradient (parts 1,2 =
  // start/end color) or shadow (toggle). args = "eff|start|end".
  'Sub WosShapeEffect\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim eff As String\n' +
  '  eff = parts(0)\n' +
  '  Dim oDoc, oSel, oShape, i As Integer, n As Integer\n' +
  '  Dim oGrad As New com.sun.star.awt.Gradient\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  For i = 0 To n - 1\n' +
  '    oShape = oSel.getByIndex(i)\n' +
  '    If eff = "gradient" Then\n' +
  '      oGrad.Style = com.sun.star.awt.GradientStyle.LINEAR\n' +
  '      oGrad.StartColor = CLng(parts(1))\n' +
  '      oGrad.EndColor = CLng(parts(2))\n' +
  '      oGrad.Angle = 450\n' +
  '      oGrad.StartIntensity = 100\n' +
  '      oGrad.EndIntensity = 100\n' +
  '      oGrad.Border = 0\n' +
  '      oShape.FillStyle = com.sun.star.drawing.FillStyle.GRADIENT\n' +
  '      oShape.FillGradient = oGrad\n' +
  '    ElseIf eff = "shadow" Then\n' +
  '      If oShape.Shadow Then\n' +
  '        oShape.Shadow = False\n' +
  '      Else\n' +
  '        oShape.Shadow = True\n' +
  '        oShape.ShadowColor = RGB(80, 80, 80)\n' +
  '        oShape.ShadowTransparence = 30\n' +
  '        oShape.ShadowXDistance = 120\n' +
  '        oShape.ShadowYDistance = 120\n' +
  '      End If\n' +
  '    End If\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Impress: insert an image onto the current slide, scaled to its aspect, and
  // select it. args = the image filesystem path.
  'Sub WosInsertImage\n' +
  '  On Error Resume Next\n' +
  '  Dim path As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, path\n' +
  '  Close #f\n' +
  '  If Len(path) = 0 Then Exit Sub\n' +
  '  Dim oDoc, oPage, oImg, oProvider, oGraphic\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPage = WosTargetPage(oDoc)\n' +
  '  oImg = oDoc.createInstance("com.sun.star.drawing.GraphicObjectShape")\n' +
  '  oPage.add(oImg)\n' +
  '  oImg.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PAGE\n' +
  '  oProvider = createUnoService("com.sun.star.graphic.GraphicProvider")\n' +
  '  Dim aArgs(0) As New com.sun.star.beans.PropertyValue\n' +
  '  aArgs(0).Name = "URL"\n' +
  '  aArgs(0).Value = ConvertToURL(path)\n' +
  '  oGraphic = oProvider.queryGraphic(aArgs())\n' +
  '  oImg.Graphic = oGraphic\n' +
  '  Dim natW As Long, natH As Long, maxDim As Long\n' +
  '  natW = 8000 : natH = 6000\n' +
  '  If Not IsNull(oGraphic) Then\n' +
  '    natW = oGraphic.Size100thMM.Width\n' +
  '    natH = oGraphic.Size100thMM.Height\n' +
  '    If natW &lt;= 0 Then natW = oGraphic.SizePixel.Width * 26\n' +
  '    If natH &lt;= 0 Then natH = oGraphic.SizePixel.Height * 26\n' +
  '  End If\n' +
  '  If natW &lt;= 0 Then natW = 8000\n' +
  '  If natH &lt;= 0 Then natH = 6000\n' +
  '  maxDim = 14000\n' +
  '  If natW &gt;= natH And natW &gt; maxDim Then\n' +
  '    natH = natH * maxDim / natW : natW = maxDim\n' +
  '  ElseIf natH &gt; natW And natH &gt; maxDim Then\n' +
  '    natW = natW * maxDim / natH : natH = maxDim\n' +
  '  End If\n' +
  '  Dim oSize As New com.sun.star.awt.Size, oPos As New com.sun.star.awt.Point\n' +
  '  oSize.Width = natW : oSize.Height = natH\n' +
  '  oImg.Size = oSize\n' +
  '  oPos.X = 3000 : oPos.Y = 3000\n' +
  '  oImg.Position = oPos\n' +
  '  oDoc.CurrentController.select(oImg)\n' +
  'End Sub\n' +
  // Impress: arrange the selected shape(s). op = front|back|forward|backward,
  // left|hcenter|right|top|vmiddle|bottom (align — PowerPoint semantics: one
  // shape aligns to the slide, several align to the selection bounding box),
  // disth|distv (distribute with equal gaps, first/last fixed; needs 3+), or
  // delete.
  'Sub WosArrange\n' +
  '  On Error Resume Next\n' +
  '  Dim op As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, op\n' +
  '  Close #f\n' +
  '  Dim oDoc, oCtrl, oSel, oPage, oShape, i As Integer, n As Integer\n' +
  '  Dim sw As Long, sh As Long, sz, ps\n' +
  '  Dim bL As Long, bT As Long, bR As Long, bB As Long\n' +
  '  Dim oArr(255) As Object, oTmp As Object, j As Integer, ki As Long, kj As Long\n' +
  '  Dim sum As Long, gap As Double, cur As Double\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oCtrl = oDoc.CurrentController\n' +
  '  oSel = oCtrl.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  oPage = WosTargetPage(oDoc)\n' +
  '  sw = oPage.Width : sh = oPage.Height\n' +
  '  If op = "front" Or op = "back" Or op = "forward" Or op = "backward" Or op = "delete" Then\n' +
  '    For i = n - 1 To 0 Step -1\n' +
  '      oShape = oSel.getByIndex(i)\n' +
  '      If op = "front" Then\n' +
  '        oShape.ZOrder = oPage.Count - 1\n' +
  '      ElseIf op = "back" Then\n' +
  '        oShape.ZOrder = 0\n' +
  '      ElseIf op = "forward" Then\n' +
  '        oShape.ZOrder = oShape.ZOrder + 1\n' +
  '      ElseIf op = "backward" Then\n' +
  '        If oShape.ZOrder &gt; 0 Then oShape.ZOrder = oShape.ZOrder - 1\n' +
  '      ElseIf op = "delete" Then\n' +
  '        oPage.remove(oShape)\n' +
  '      End If\n' +
  '    Next i\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  '  If op = "disth" Or op = "distv" Then\n' +
  '    If n &lt; 3 Or n &gt; 256 Then Exit Sub\n' +
  '    For i = 0 To n - 1\n' +
  '      oArr(i) = oSel.getByIndex(i)\n' +
  '    Next i\n' +
  '    For i = 0 To n - 2\n' +
  '      For j = i + 1 To n - 1\n' +
  '        If op = "disth" Then\n' +
  '          ki = oArr(i).Position.X : kj = oArr(j).Position.X\n' +
  '        Else\n' +
  '          ki = oArr(i).Position.Y : kj = oArr(j).Position.Y\n' +
  '        End If\n' +
  '        If kj &lt; ki Then\n' +
  '          oTmp = oArr(i) : oArr(i) = oArr(j) : oArr(j) = oTmp\n' +
  '        End If\n' +
  '      Next j\n' +
  '    Next i\n' +
  '    sum = 0\n' +
  '    For i = 0 To n - 1\n' +
  '      sz = oArr(i).Size\n' +
  '      If op = "disth" Then sum = sum + sz.Width Else sum = sum + sz.Height\n' +
  '    Next i\n' +
  '    If op = "disth" Then\n' +
  '      gap = (oArr(n - 1).Position.X + oArr(n - 1).Size.Width - oArr(0).Position.X - sum) / (n - 1)\n' +
  '      cur = oArr(0).Position.X + oArr(0).Size.Width + gap\n' +
  '      For i = 1 To n - 2\n' +
  '        ps = oArr(i).Position\n' +
  '        ps.X = CLng(cur)\n' +
  '        oArr(i).Position = ps\n' +
  '        cur = cur + oArr(i).Size.Width + gap\n' +
  '      Next i\n' +
  '    Else\n' +
  '      gap = (oArr(n - 1).Position.Y + oArr(n - 1).Size.Height - oArr(0).Position.Y - sum) / (n - 1)\n' +
  '      cur = oArr(0).Position.Y + oArr(0).Size.Height + gap\n' +
  '      For i = 1 To n - 2\n' +
  '        ps = oArr(i).Position\n' +
  '        ps.Y = CLng(cur)\n' +
  '        oArr(i).Position = ps\n' +
  '        cur = cur + oArr(i).Size.Height + gap\n' +
  '      Next i\n' +
  '    End If\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  // Align: bounds = the slide for one shape, the selection bbox for several.
  '  bL = 0 : bT = 0 : bR = sw : bB = sh\n' +
  '  If n &gt; 1 Then\n' +
  '    bL = 2000000000 : bT = 2000000000 : bR = -2000000000 : bB = -2000000000\n' +
  '    For i = 0 To n - 1\n' +
  '      oShape = oSel.getByIndex(i)\n' +
  '      ps = oShape.Position : sz = oShape.Size\n' +
  '      If ps.X &lt; bL Then bL = ps.X\n' +
  '      If ps.Y &lt; bT Then bT = ps.Y\n' +
  '      If ps.X + sz.Width &gt; bR Then bR = ps.X + sz.Width\n' +
  '      If ps.Y + sz.Height &gt; bB Then bB = ps.Y + sz.Height\n' +
  '    Next i\n' +
  '  End If\n' +
  '  For i = 0 To n - 1\n' +
  '    oShape = oSel.getByIndex(i)\n' +
  '    sz = oShape.Size\n' +
  '    ps = oShape.Position\n' +
  '    If op = "left" Then\n' +
  '      ps.X = bL\n' +
  '    ElseIf op = "hcenter" Then\n' +
  '      ps.X = (bL + bR - sz.Width) / 2\n' +
  '    ElseIf op = "right" Then\n' +
  '      ps.X = bR - sz.Width\n' +
  '    ElseIf op = "top" Then\n' +
  '      ps.Y = bT\n' +
  '    ElseIf op = "vmiddle" Then\n' +
  '      ps.Y = (bT + bB - sz.Height) / 2\n' +
  '    ElseIf op = "bottom" Then\n' +
  '      ps.Y = bB - sz.Height\n' +
  '    End If\n' +
  '    oShape.Position = ps\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Impress: hatch/pattern fill on the selected shape(s). style = single|double|
  // triple; angle in 1/10 deg; distance in 1/100 mm. args = "style|angle|dist|color".
  'Sub WosShapePattern\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim styl As String, ang As Long, dist As Long, col As Long\n' +
  '  styl = parts(0)\n' +
  '  ang = CLng(parts(1))\n' +
  '  dist = CLng(parts(2))\n' +
  '  col = CLng(parts(3))\n' +
  '  Dim oDoc, oSel, oShape, i As Integer, n As Integer\n' +
  '  Dim oHatch As New com.sun.star.drawing.Hatch\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  If styl = "double" Then\n' +
  '    oHatch.Style = com.sun.star.drawing.HatchStyle.DOUBLE\n' +
  '  ElseIf styl = "triple" Then\n' +
  '    oHatch.Style = com.sun.star.drawing.HatchStyle.TRIPLE\n' +
  '  Else\n' +
  '    oHatch.Style = com.sun.star.drawing.HatchStyle.SINGLE\n' +
  '  End If\n' +
  '  oHatch.Color = col\n' +
  '  oHatch.Distance = dist\n' +
  '  oHatch.Angle = ang\n' +
  '  For i = 0 To n - 1\n' +
  '    oShape = oSel.getByIndex(i)\n' +
  '    oShape.FillStyle = com.sun.star.drawing.FillStyle.HATCH\n' +
  '    oShape.FillHatch = oHatch\n' +
  '    oShape.FillBackground = True\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Impress: stroke options on the selected shape(s). prop = width (value in
  // 1/100 mm) or dash (solid|dashed|dotted|dashdot). args = "prop|value".
  'Sub WosShapeStroke\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim prop As String, val As String\n' +
  '  prop = parts(0)\n' +
  '  val = parts(1)\n' +
  '  Dim oDoc, oSel, oShape, i As Integer, n As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  For i = 0 To n - 1\n' +
  '    oShape = oSel.getByIndex(i)\n' +
  '    If prop = "width" Then\n' +
  '      If oShape.LineStyle = com.sun.star.drawing.LineStyle.NONE Then oShape.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '      oShape.LineWidth = CLng(val)\n' +
  '    ElseIf prop = "dash" Then\n' +
  '      If val = "solid" Then\n' +
  '        oShape.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '      Else\n' +
  '        Dim oDash As New com.sun.star.drawing.LineDash\n' +
  '        If val = "dotted" Then\n' +
  '          oDash.Style = com.sun.star.drawing.DashStyle.ROUND\n' +
  '          oDash.Dots = 1 : oDash.DotLen = 1 : oDash.Dashes = 0 : oDash.DashLen = 0 : oDash.Distance = 150\n' +
  '        ElseIf val = "dashdot" Then\n' +
  '          oDash.Style = com.sun.star.drawing.DashStyle.RECT\n' +
  '          oDash.Dots = 1 : oDash.DotLen = 30 : oDash.Dashes = 1 : oDash.DashLen = 300 : oDash.Distance = 200\n' +
  '        Else\n' +
  '          oDash.Style = com.sun.star.drawing.DashStyle.RECT\n' +
  '          oDash.Dots = 0 : oDash.DotLen = 0 : oDash.Dashes = 1 : oDash.DashLen = 300 : oDash.Distance = 200\n' +
  '        End If\n' +
  '        oShape.LineDash = oDash\n' +
  '        oShape.LineStyle = com.sun.star.drawing.LineStyle.DASH\n' +
  '      End If\n' +
  '      If oShape.LineWidth &lt; 1 Then oShape.LineWidth = 35\n' +
  '    End If\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Components: set the selected shape(s) size. args = "w|h" (1/100 mm).
  'Sub WosShapeSize\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim w As Long, h As Long\n' +
  '  w = CLng(parts(0))\n' +
  '  h = CLng(parts(1))\n' +
  '  Dim oDoc, oSel, oShape, i As Integer, n As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  Dim oSz As New com.sun.star.awt.Size\n' +
  '  oSz.Width = w : oSz.Height = h\n' +
  '  For i = 0 To n - 1\n' +
  '    oShape = oSel.getByIndex(i)\n' +
  '    If w &gt; 0 And h &gt; 0 Then oShape.Size = oSz\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Interactive drag commit: OFFSET the selected shape(s) by a delta in 1/100 mm.
  // args = "dx|dy".
  //
  // The renderer no longer moves shapes by streaming mouse events: ~60
  // MOUSEMOVE/sec backlogs the single-threaded engine for tens of seconds on a
  // real deck, and collapsing the drag into ONE synthetic move doesn't make the
  // engine track it (the shape snaps back to where it started). So the overlay
  // shows the drag locally and the geometry lands here, through the model API,
  // once on release.
  //
  // A DELTA rather than an absolute position keeps this origin-agnostic: an
  // Impress shape's Position is page-relative while a Writer shape's is
  // anchor-relative, but a shift is a shift in both.
  'Sub WosShapeMove\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim dx As Long, dy As Long\n' +
  '  dx = CLng(parts(0))\n' +
  '  dy = CLng(parts(1))\n' +
  '  If dx = 0 And dy = 0 Then Exit Sub\n' +
  '  Dim oDoc, oSel, oShape, i As Integer, n As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  Dim oPt As New com.sun.star.awt.Point, oCur\n' +
  '  For i = 0 To n - 1\n' +
  '    oShape = oSel.getByIndex(i)\n' +
  '    oCur = oShape.Position\n' +
  '    oPt.X = oCur.X + dx\n' +
  '    oPt.Y = oCur.Y + dy\n' +
  '    oShape.Position = oPt\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Components: tag the selected shape(s) with a Name (the instance/asset id).
  'Sub WosTagShape\n' +
  '  On Error Resume Next\n' +
  '  Dim nm As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, nm\n' +
  '  Close #f\n' +
  '  Dim oDoc, oSel, oShape, i As Integer, n As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  n = 0\n' +
  '  n = oSel.Count\n' +
  '  If n = 0 Then Exit Sub\n' +
  '  For i = 0 To n - 1\n' +
  '    oSel.getByIndex(i).Name = nm\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Components: write the selected shape info (name|w|h|fill|text) to a file the
  // main process reads back. Empty file when nothing/many are selected.
  'Sub WosSelInfo\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oSel, oShape, out As String, df As Integer\n' +
  '  out = ""\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If Not IsNull(oSel) Then\n' +
  '    If oSel.Count = 1 Then\n' +
  '      oShape = oSel.getByIndex(0)\n' +
  '      Dim fc As Long, tx As String, isGrp As Boolean\n' +
  '      isGrp = False\n' +
  '      isGrp = oShape.supportsService("com.sun.star.drawing.GroupShape")\n' +
  '      If isGrp Then\n' +
  '        Dim gf As Long, gt As String, ch, jj As Integer\n' +
  '        gf = -1 : gt = ""\n' +
  '        For jj = 0 To oShape.Count - 1\n' +
  '          ch = oShape.getByIndex(jj)\n' +
  '          If ch.Name = "bg" Then gf = ch.FillColor\n' +
  '          If ch.Name = "title" Or ch.Name = "caption" Then gt = ch.getString()\n' +
  '        Next jj\n' +
  '        out = oShape.Name &amp; "|" &amp; oShape.Size.Width &amp; "|" &amp; oShape.Size.Height &amp; "|" &amp; gf &amp; "|" &amp; gt\n' +
  '      Else\n' +
  '        fc = -1\n' +
  '        fc = oShape.FillColor\n' +
  '        tx = ""\n' +
  '        tx = oShape.getString()\n' +
  '        out = oShape.Name &amp; "|" &amp; oShape.Size.Width &amp; "|" &amp; oShape.Size.Height &amp; "|" &amp; fc &amp; "|" &amp; tx\n' +
  '      End If\n' +
  '    End If\n' +
  '  End If\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, out\n' +
  '  Close #df\n' +
  'End Sub\n' +
  // Impress speaker notes: resolve the notes text shape on a slide's NotesPage.
  // wosIdx -1 = the current slide; otherwise the 0-based slide index. Returns the
  // notes placeholder — the shape supporting NotesTextShape, else the first XText
  // shape that is NOT the slide-image (PageShape) or the title placeholder.
  'Function WosNotesShape(wosDoc As Object, wosIdx As Integer) As Object\n' +
  '  On Error Resume Next\n' +
  '  WosNotesShape = Nothing\n' +
  '  Dim wosSlides, wosSlide, wosNP, wosI As Integer, wosSh, wosPick\n' +
  '  wosSlides = wosDoc.DrawPages\n' +
  '  If IsNull(wosSlides) Then Exit Function\n' +
  '  Dim wosUse As Integer\n' +
  '  wosUse = wosIdx\n' +
  '  If wosUse &lt; 0 Then\n' +
  '    wosUse = 0\n' +
  '    wosUse = wosDoc.CurrentController.CurrentPage.Number - 1\n' +
  '  End If\n' +
  '  If wosUse &lt; 0 Then wosUse = 0\n' +
  '  If wosUse &gt; wosSlides.Count - 1 Then wosUse = wosSlides.Count - 1\n' +
  '  wosSlide = wosSlides.getByIndex(wosUse)\n' +
  '  If IsNull(wosSlide) Then Exit Function\n' +
  '  wosNP = wosSlide.NotesPage\n' +
  '  If IsNull(wosNP) Then Exit Function\n' +
  '  wosPick = Nothing\n' +
  '  For wosI = 0 To wosNP.Count - 1\n' +
  '    wosSh = wosNP.getByIndex(wosI)\n' +
  '    If wosSh.supportsService("com.sun.star.presentation.NotesTextShape") Then\n' +
  '      WosNotesShape = wosSh\n' +
  '      Exit Function\n' +
  '    End If\n' +
  '    If IsNull(wosPick) Then\n' +
  '      If wosSh.supportsService("com.sun.star.drawing.Text") Then\n' +
  '        If Not wosSh.supportsService("com.sun.star.presentation.PageShape") Then\n' +
  '          If Not wosSh.supportsService("com.sun.star.presentation.TitleTextShape") Then\n' +
  '            wosPick = wosSh\n' +
  '          End If\n' +
  '        End If\n' +
  '      End If\n' +
  '    End If\n' +
  '  Next wosI\n' +
  '  WosNotesShape = wosPick\n' +
  'End Function\n' +
  // Read the current (or indexed) slide's speaker notes → /tmp/wos-asset-out.txt.
  // Optional arg (wos-macro-generic.txt): a 0-based slide index; empty = current.
  'Sub WosGetNotes\n' +
  '  On Error Resume Next\n' +
  '  Dim wosArg As String, wosF As Integer, wosIdx As Integer\n' +
  '  wosArg = ""\n' +
  '  wosF = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #wosF\n' +
  '  Line Input #wosF, wosArg\n' +
  '  Close #wosF\n' +
  '  wosIdx = -1\n' +
  '  If Len(wosArg) &gt; 0 Then wosIdx = CInt(wosArg)\n' +
  '  Dim wosDoc, wosShp, wosOut As String, wosDf As Integer\n' +
  '  wosOut = ""\n' +
  '  wosDoc = WosActiveDoc()\n' +
  '  wosShp = WosNotesShape(wosDoc, wosIdx)\n' +
  '  If Not IsNull(wosShp) Then wosOut = wosShp.getString()\n' +
  '  wosDf = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #wosDf\n' +
  '  Print #wosDf, wosOut\n' +
  '  Close #wosDf\n' +
  'End Sub\n' +
  // Set the current (or indexed) slide's speaker notes. args (generic file):
  // "wosIdx|text" — wosIdx -1 = current slide, else the 0-based slide index; the
  // remainder (which may itself contain "|") is the notes text.
  'Sub WosSetNotes\n' +
  '  On Error Resume Next\n' +
  '  Dim wosArg As String, wosF As Integer\n' +
  '  wosArg = ""\n' +
  '  wosF = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #wosF\n' +
  '  Line Input #wosF, wosArg\n' +
  '  Close #wosF\n' +
  '  Dim wosBar As Integer, wosIdx As Integer, wosStr As String\n' +
  '  wosBar = InStr(wosArg, "|")\n' +
  '  If wosBar = 0 Then\n' +
  '    wosIdx = -1\n' +
  '    wosStr = wosArg\n' +
  '  Else\n' +
  '    wosIdx = CInt(Left(wosArg, wosBar - 1))\n' +
  '    wosStr = Mid(wosArg, wosBar + 1)\n' +
  '  End If\n' +
  '  Dim wosDoc, wosShp\n' +
  '  wosDoc = WosActiveDoc()\n' +
  '  wosShp = WosNotesShape(wosDoc, wosIdx)\n' +
  '  If IsNull(wosShp) Then Exit Sub\n' +
  '  wosShp.setString(wosStr)\n' +
  'End Sub\n' +
  // Components (composite): insert a grouped card — background + title text —
  // and select the group. args = "fill|fontColor|w|h|title".
  'Sub WosInsertCard\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim fill As Long, fcol As Long, w As Long, h As Long, title As String\n' +
  '  fill = CLng(parts(0))\n' +
  '  fcol = CLng(parts(1))\n' +
  '  w = CLng(parts(2))\n' +
  '  h = CLng(parts(3))\n' +
  '  title = ""\n' +
  '  If UBound(parts) &gt;= 4 Then title = parts(4)\n' +
  '  Dim oDoc, oPage, oBg, oT, oColl, oGroup\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPage = WosTargetPage(oDoc)\n' +
  '  Dim szB As New com.sun.star.awt.Size, psB As New com.sun.star.awt.Point\n' +
  '  oBg = oDoc.createInstance("com.sun.star.drawing.RectangleShape")\n' +
  '  oPage.add(oBg)\n' +
  '  szB.Width = w : szB.Height = h\n' +
  '  psB.X = 4000 : psB.Y = 4000\n' +
  '  oBg.Size = szB : oBg.Position = psB\n' +
  '  oBg.CornerRadius = 600\n' +
  '  oBg.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '  oBg.FillColor = fill\n' +
  '  oBg.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '  oBg.LineColor = RGB(31, 78, 121)\n' +
  '  oBg.Name = "bg"\n' +
  '  Dim szT As New com.sun.star.awt.Size, psT As New com.sun.star.awt.Point\n' +
  '  oT = oDoc.createInstance("com.sun.star.drawing.TextShape")\n' +
  '  oPage.add(oT)\n' +
  '  szT.Width = w - 1200 : szT.Height = h - 1200\n' +
  '  psT.X = 4600 : psT.Y = 4600\n' +
  '  oT.Size = szT : oT.Position = psT\n' +
  '  oT.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '  oT.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '  oT.TextHorizontalAdjust = com.sun.star.drawing.TextHorizontalAdjust.CENTER\n' +
  '  oT.TextVerticalAdjust = com.sun.star.drawing.TextVerticalAdjust.CENTER\n' +
  '  oT.setString(title)\n' +
  '  Dim oCur\n' +
  '  oCur = oT.Text.createTextCursor()\n' +
  '  oCur.gotoStart(False) : oCur.gotoEnd(True)\n' +
  '  oCur.CharColor = fcol\n' +
  '  oCur.CharHeight = 18\n' +
  '  oT.Name = "title"\n' +
  '  oColl = createUnoService("com.sun.star.drawing.ShapeCollection")\n' +
  '  oColl.add(oBg)\n' +
  '  oColl.add(oT)\n' +
  '  oGroup = oPage.group(oColl)\n' +
  '  oGroup.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PAGE\n' +
  '  oDoc.CurrentController.select(oGroup)\n' +
  'End Sub\n' +
  // Components (composite): insert a grouped media card — background + image +
  // caption — and select the group. args = "bgfill|fontColor|w|h|caption|imgPath".
  'Sub WosInsertMedia\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim fill As Long, fcol As Long, w As Long, h As Long, cap As String, imgPath As String\n' +
  '  fill = CLng(parts(0))\n' +
  '  fcol = CLng(parts(1))\n' +
  '  w = CLng(parts(2))\n' +
  '  h = CLng(parts(3))\n' +
  '  cap = ""\n' +
  '  If UBound(parts) &gt;= 4 Then cap = parts(4)\n' +
  '  imgPath = ""\n' +
  '  If UBound(parts) &gt;= 5 Then imgPath = parts(5)\n' +
  '  Dim oDoc, oPage, oBg, oImg, oCap, oColl, oGroup\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPage = WosTargetPage(oDoc)\n' +
  '  Dim capH As Long\n' +
  '  capH = 1800\n' +
  '  Dim szB As New com.sun.star.awt.Size, psB As New com.sun.star.awt.Point\n' +
  '  oBg = oDoc.createInstance("com.sun.star.drawing.RectangleShape")\n' +
  '  oPage.add(oBg)\n' +
  '  szB.Width = w : szB.Height = h\n' +
  '  psB.X = 4000 : psB.Y = 4000\n' +
  '  oBg.Size = szB : oBg.Position = psB\n' +
  '  oBg.CornerRadius = 400\n' +
  '  oBg.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '  oBg.FillColor = fill\n' +
  '  oBg.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '  oBg.Name = "bg"\n' +
  '  oImg = oDoc.createInstance("com.sun.star.drawing.GraphicObjectShape")\n' +
  '  oPage.add(oImg)\n' +
  '  Dim szI As New com.sun.star.awt.Size, psI As New com.sun.star.awt.Point\n' +
  '  szI.Width = w - 600 : szI.Height = h - capH - 600\n' +
  '  psI.X = 4300 : psI.Y = 4300\n' +
  '  oImg.Size = szI : oImg.Position = psI\n' +
  '  If Len(imgPath) &gt; 0 Then\n' +
  '    Dim oProv, oGraphic\n' +
  '    oProv = createUnoService("com.sun.star.graphic.GraphicProvider")\n' +
  '    Dim aA(0) As New com.sun.star.beans.PropertyValue\n' +
  '    aA(0).Name = "URL" : aA(0).Value = ConvertToURL(imgPath)\n' +
  '    oGraphic = oProv.queryGraphic(aA())\n' +
  '    oImg.Graphic = oGraphic\n' +
  '  Else\n' +
  '    oImg.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '    oImg.FillColor = RGB(210, 214, 220)\n' +
  '  End If\n' +
  '  oImg.Name = "image"\n' +
  '  oCap = oDoc.createInstance("com.sun.star.drawing.TextShape")\n' +
  '  oPage.add(oCap)\n' +
  '  Dim szC As New com.sun.star.awt.Size, psC As New com.sun.star.awt.Point\n' +
  '  szC.Width = w - 600 : szC.Height = capH\n' +
  '  psC.X = 4300 : psC.Y = 4000 + h - capH - 200\n' +
  '  oCap.Size = szC : oCap.Position = psC\n' +
  '  oCap.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '  oCap.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '  oCap.TextHorizontalAdjust = com.sun.star.drawing.TextHorizontalAdjust.CENTER\n' +
  '  oCap.setString(cap)\n' +
  '  Dim oCurC\n' +
  '  oCurC = oCap.Text.createTextCursor()\n' +
  '  oCurC.gotoStart(False) : oCurC.gotoEnd(True)\n' +
  '  oCurC.CharColor = fcol\n' +
  '  oCurC.CharHeight = 12\n' +
  '  oCap.Name = "caption"\n' +
  '  oColl = createUnoService("com.sun.star.drawing.ShapeCollection")\n' +
  '  oColl.add(oBg)\n' +
  '  oColl.add(oImg)\n' +
  '  oColl.add(oCap)\n' +
  '  oGroup = oPage.group(oColl)\n' +
  '  oGroup.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PAGE\n' +
  '  oDoc.CurrentController.select(oGroup)\n' +
  'End Sub\n' +
  // Components (composite): set a property on a named child of the selected
  // group. args = "role|prop|value" (prop = fill|text|fontcolor).
  'Sub WosGroupSet\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim role As String, prop As String, val As String\n' +
  '  role = parts(0) : prop = parts(1) : val = parts(2)\n' +
  '  Dim oDoc, oSel, oGroup, child, j As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  If oSel.Count = 0 Then Exit Sub\n' +
  '  oGroup = oSel.getByIndex(0)\n' +
  '  For j = 0 To oGroup.Count - 1\n' +
  '    child = oGroup.getByIndex(j)\n' +
  '    If child.Name = role Then\n' +
  '      If prop = "fill" Then\n' +
  '        child.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '        child.FillColor = CLng(val)\n' +
  '      ElseIf prop = "text" Then\n' +
  '        child.setString(val)\n' +
  '      ElseIf prop = "fontcolor" Then\n' +
  '        Dim oCur2\n' +
  '        oCur2 = child.Text.createTextCursor()\n' +
  '        oCur2.gotoStart(False) : oCur2.gotoEnd(True)\n' +
  '        oCur2.CharColor = CLng(val)\n' +
  '      End If\n' +
  '    End If\n' +
  '  Next j\n' +
  'End Sub\n' +
  // Components (capture): serialize one shape relative to (minX,minY) as a
  // pipe-delimited line: kind|relX|relY|w|h|fill|line|lineWidth|corner|font|text.
  'Function WosSerShape(sh As Object, minX As Long, minY As Long) As String\n' +
  '  On Error Resume Next\n' +
  '  Dim k As String, p, sz, fill As Long, lc As Long, cr As Long, fcol As Long, lw As Long, tx As String\n' +
  '  p = sh.Position : sz = sh.Size\n' +
  '  k = "rect"\n' +
  '  If sh.supportsService("com.sun.star.drawing.EllipseShape") Then k = "ellipse"\n' +
  '  If sh.supportsService("com.sun.star.drawing.TextShape") Then k = "text"\n' +
  '  If sh.supportsService("com.sun.star.drawing.LineShape") Then k = "line"\n' +
  '  If sh.supportsService("com.sun.star.drawing.GraphicObjectShape") Then k = "image"\n' +
  '  cr = 0\n' +
  '  cr = sh.CornerRadius\n' +
  '  If k = "rect" And cr &gt; 0 Then k = "roundrect"\n' +
  '  fill = -1\n' +
  '  If sh.FillStyle &lt;&gt; com.sun.star.drawing.FillStyle.NONE Then fill = sh.FillColor\n' +
  '  lc = -1 : lw = 0\n' +
  '  If sh.LineStyle &lt;&gt; com.sun.star.drawing.LineStyle.NONE Then\n' +
  '    lc = sh.LineColor : lw = sh.LineWidth\n' +
  '  End If\n' +
  '  fcol = 0 : tx = ""\n' +
  '  tx = sh.getString()\n' +
  '  If Len(tx) &gt; 0 Then\n' +
  '    Dim oc\n' +
  '    oc = sh.Text.createTextCursor()\n' +
  '    oc.gotoStart(False) : oc.gotoEnd(True)\n' +
  '    fcol = oc.CharColor\n' +
  '  End If\n' +
  '  tx = Join(Split(tx, "|"), " ")\n' +
  '  tx = Join(Split(tx, Chr(10)), " ")\n' +
  '  tx = Join(Split(tx, Chr(13)), " ")\n' +
  '  WosSerShape = k &amp; "|" &amp; (p.X - minX) &amp; "|" &amp; (p.Y - minY) &amp; "|" &amp; sz.Width &amp; "|" &amp; sz.Height &amp; "|" &amp; fill &amp; "|" &amp; lc &amp; "|" &amp; lw &amp; "|" &amp; cr &amp; "|" &amp; fcol &amp; "|" &amp; tx\n' +
  'End Function\n' +
  // Components (capture): write the selected shapes (groups flattened) to the
  // out file as a header line (bboxW|bboxH|count) + one serialized line each.
  'Sub WosCapture\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oSel, s, i As Integer, j As Integer\n' +
  '  Dim oList(255) As Object, cnt As Integer\n' +
  '  cnt = 0\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  Dim out As String\n' +
  '  out = ""\n' +
  '  If Not IsNull(oSel) Then\n' +
  '    For i = 0 To oSel.Count - 1\n' +
  '      s = oSel.getByIndex(i)\n' +
  '      If s.supportsService("com.sun.star.drawing.GroupShape") Then\n' +
  '        For j = 0 To s.Count - 1\n' +
  '          oList(cnt) = s.getByIndex(j) : cnt = cnt + 1\n' +
  '        Next j\n' +
  '      Else\n' +
  '        oList(cnt) = s : cnt = cnt + 1\n' +
  '      End If\n' +
  '    Next i\n' +
  '  End If\n' +
  '  If cnt &gt; 0 Then\n' +
  '    Dim minX As Long, minY As Long, maxX As Long, maxY As Long, pp, ss\n' +
  '    minX = 2000000000 : minY = 2000000000 : maxX = -2000000000 : maxY = -2000000000\n' +
  '    For i = 0 To cnt - 1\n' +
  '      pp = oList(i).Position : ss = oList(i).Size\n' +
  '      If pp.X &lt; minX Then minX = pp.X\n' +
  '      If pp.Y &lt; minY Then minY = pp.Y\n' +
  '      If pp.X + ss.Width &gt; maxX Then maxX = pp.X + ss.Width\n' +
  '      If pp.Y + ss.Height &gt; maxY Then maxY = pp.Y + ss.Height\n' +
  '    Next i\n' +
  '    out = (maxX - minX) &amp; "|" &amp; (maxY - minY) &amp; "|" &amp; cnt &amp; Chr(10)\n' +
  '    For i = 0 To cnt - 1\n' +
  '      out = out &amp; WosSerShape(oList(i), minX, minY) &amp; Chr(10)\n' +
  '    Next i\n' +
  '  End If\n' +
  '  Dim df As Integer\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, out\n' +
  '  Close #df\n' +
  'End Sub\n' +
  // Components (build): rebuild captured elements from /tmp/wos-build-in.txt
  // (same format WosCapture writes), group them, and select the result.
  'Sub WosBuildCaptured\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oPage, oColl, sh, f As Integer, ln As String, first As Boolean\n' +
  '  Dim baseX As Long, baseY As Long, cnt As Integer, firstText As Boolean, firstFill As Boolean\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPage = WosTargetPage(oDoc)\n' +
  '  oColl = createUnoService("com.sun.star.drawing.ShapeCollection")\n' +
  '  baseX = 4000 : baseY = 4000 : cnt = 0 : firstText = True : firstFill = True\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-build-in.txt" For Input As #f\n' +
  '  first = True\n' +
  '  Do While Not EOF(f)\n' +
  '    Line Input #f, ln\n' +
  '    If first Then\n' +
  '      first = False\n' +
  '    ElseIf Len(ln) &gt; 0 Then\n' +
  '      Dim pa() As String, k As String, svc As String\n' +
  '      Dim relX As Long, relY As Long, w As Long, h As Long, fill As Long, lc As Long, lw As Long, cr As Long, fcol As Long, tx As String\n' +
  '      pa = Split(ln, "|")\n' +
  '      k = pa(0)\n' +
  '      relX = CLng(pa(1)) : relY = CLng(pa(2)) : w = CLng(pa(3)) : h = CLng(pa(4))\n' +
  '      fill = CLng(pa(5)) : lc = CLng(pa(6)) : lw = CLng(pa(7)) : cr = CLng(pa(8)) : fcol = CLng(pa(9))\n' +
  '      tx = ""\n' +
  '      If UBound(pa) &gt;= 10 Then tx = pa(10)\n' +
  '      svc = "com.sun.star.drawing.RectangleShape"\n' +
  '      If k = "ellipse" Then\n' +
  '        svc = "com.sun.star.drawing.EllipseShape"\n' +
  '      ElseIf k = "line" Then\n' +
  '        svc = "com.sun.star.drawing.LineShape"\n' +
  '      ElseIf k = "text" Then\n' +
  '        svc = "com.sun.star.drawing.TextShape"\n' +
  '      End If\n' +
  '      sh = oDoc.createInstance(svc)\n' +
  '      oPage.add(sh)\n' +
  '      sh.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PAGE\n' +
  '      Dim oSz As New com.sun.star.awt.Size, oPs As New com.sun.star.awt.Point\n' +
  '      oSz.Width = w : oSz.Height = h\n' +
  '      oPs.X = baseX + relX : oPs.Y = baseY + relY\n' +
  '      sh.Size = oSz : sh.Position = oPs\n' +
  '      If k = "roundrect" Then sh.CornerRadius = cr\n' +
  '      If k = "image" Then\n' +
  '        sh.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '        sh.FillColor = RGB(210, 214, 220)\n' +
  '      ElseIf fill &gt;= 0 Then\n' +
  '        sh.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '        sh.FillColor = fill\n' +
  '      Else\n' +
  '        sh.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '      End If\n' +
  '      If lc &gt;= 0 Then\n' +
  '        sh.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '        sh.LineColor = lc\n' +
  '        If lw &gt; 0 Then sh.LineWidth = lw\n' +
  '      Else\n' +
  '        sh.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '      End If\n' +
  '      If Len(tx) &gt; 0 Then\n' +
  '        sh.setString(tx)\n' +
  '        Dim oc3\n' +
  '        oc3 = sh.Text.createTextCursor()\n' +
  '        oc3.gotoStart(False) : oc3.gotoEnd(True)\n' +
  '        oc3.CharColor = fcol\n' +
  '      End If\n' +
  '      If k = "text" And firstText Then\n' +
  '        sh.Name = "title" : firstText = False\n' +
  '      ElseIf fill &gt;= 0 And firstFill Then\n' +
  '        sh.Name = "bg" : firstFill = False\n' +
  '      End If\n' +
  '      oColl.add(sh)\n' +
  '      cnt = cnt + 1\n' +
  '    End If\n' +
  '  Loop\n' +
  '  Close #f\n' +
  '  If cnt &gt; 1 Then\n' +
  '    Dim oGroup\n' +
  '    oGroup = oPage.group(oColl)\n' +
  '    oGroup.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PAGE\n' +
  '    oDoc.CurrentController.select(oGroup)\n' +
  '  ElseIf cnt = 1 Then\n' +
  '    oDoc.CurrentController.select(oColl.getByIndex(0))\n' +
  '  End If\n' +
  'End Sub\n' +
  // Frame→live-slide bridge v1 (canvas→slide). Impress only: APPEND a new slide
  // and build NATIVE, editable shapes on it from a spec file — the "canvas becomes
  // real office, not a picture" seam. Payload /tmp/wos-slide-in.txt: line 1 =
  // "slideW|slideH" (1/100 mm); then one line per shape =
  // "kind|x|y|w|h|fill|stroke|fontSize|text" (kind=rect|ellipse|text|line; colours
  // decimal 0xRRGGBB or -1). Sets the new slide CURRENT so any image-fallback
  // WosInsertImage lands on it, and writes the new slide's 0-based index to
  // /tmp/wos-asset-out.txt for the handler.
  'Sub WosBuildSlide\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oSlides, oSlide, newIx As Integer, f As Integer, ln As String, firstLine As Boolean\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oSlides = oDoc.DrawPages\n' +
  '  newIx = oSlides.Count\n' +
  '  oSlides.insertNewByIndex(newIx)\n' +
  '  oSlide = oSlides.getByIndex(newIx)\n' +
  '  oSlide.Layout = 20\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-slide-in.txt" For Input As #f\n' +
  '  firstLine = True\n' +
  '  Do While Not EOF(f)\n' +
  '    Line Input #f, ln\n' +
  '    If firstLine Then\n' +
  '      firstLine = False\n' +
  '    ElseIf Len(ln) &gt; 0 Then\n' +
  '      Dim pa() As String, kd As String, svc As String\n' +
  '      Dim sx As Long, sy As Long, wd As Long, ht As Long, fc As Long, sc As Long, fsz As Long, tx As String\n' +
  '      pa = Split(ln, "|")\n' +
  '      kd = pa(0)\n' +
  '      sx = CLng(pa(1)) : sy = CLng(pa(2)) : wd = CLng(pa(3)) : ht = CLng(pa(4))\n' +
  '      fc = CLng(pa(5)) : sc = CLng(pa(6)) : fsz = CLng(pa(7))\n' +
  '      tx = ""\n' +
  '      If UBound(pa) &gt;= 8 Then tx = pa(8)\n' +
  '      svc = "com.sun.star.drawing.RectangleShape"\n' +
  '      If kd = "ellipse" Then\n' +
  '        svc = "com.sun.star.drawing.EllipseShape"\n' +
  '      ElseIf kd = "line" Then\n' +
  '        svc = "com.sun.star.drawing.LineShape"\n' +
  '      ElseIf kd = "text" Then\n' +
  '        svc = "com.sun.star.drawing.TextShape"\n' +
  '      End If\n' +
  '      Dim oSh, oSz As New com.sun.star.awt.Size, oPt As New com.sun.star.awt.Point\n' +
  '      oSh = oDoc.createInstance(svc)\n' +
  '      oSlide.add(oSh)\n' +
  '      If wd &lt; 1 Then wd = 1\n' +
  '      If ht &lt; 1 Then ht = 1\n' +
  '      oSz.Width = wd : oSz.Height = ht\n' +
  '      oPt.X = sx : oPt.Y = sy\n' +
  '      oSh.Size = oSz\n' +
  '      oSh.Position = oPt\n' +
  '      If kd = "line" Then\n' +
  '        oSh.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '        oSh.LineWidth = 60\n' +
  '        If sc &gt;= 0 Then oSh.LineColor = sc Else oSh.LineColor = RGB(64, 64, 64)\n' +
  '      ElseIf kd = "text" Then\n' +
  '        oSh.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '        oSh.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '        oSh.TextAutoGrowHeight = True\n' +
  '      Else\n' +
  '        If fc &gt;= 0 Then\n' +
  '          oSh.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '          oSh.FillColor = fc\n' +
  '        Else\n' +
  '          oSh.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '        End If\n' +
  '        If sc &gt;= 0 Then\n' +
  '          oSh.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '          oSh.LineColor = sc\n' +
  '        Else\n' +
  '          oSh.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '        End If\n' +
  '      End If\n' +
  '      If Len(tx) &gt; 0 And kd &lt;&gt; "line" Then\n' +
  '        oSh.setString(tx)\n' +
  '        Dim oCur\n' +
  '        oCur = oSh.Text.createTextCursor()\n' +
  '        oCur.gotoStart(False) : oCur.gotoEnd(True)\n' +
  '        If fsz &gt; 0 Then oCur.CharHeight = fsz\n' +
  '        If kd = "text" And fc &gt;= 0 Then oCur.CharColor = fc\n' +
  '      End If\n' +
  '    End If\n' +
  '  Loop\n' +
  '  Close #f\n' +
  '  oDoc.CurrentController.CurrentPage = oSlide\n' +
  '  Dim fo As Integer\n' +
  '  fo = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #fo\n' +
  '  Print #fo, newIx\n' +
  '  Close #fo\n' +
  'End Sub\n' +
  // Components: mark a field as overridden on the selected instance (stored in
  // the shape Description so it persists with the doc). args = field name.
  'Sub WosSetOverride\n' +
  '  On Error Resume Next\n' +
  '  Dim field As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, field\n' +
  '  Close #f\n' +
  '  Dim oDoc, oSel, oShape, d As String\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  If oSel.Count = 0 Then Exit Sub\n' +
  '  oShape = oSel.getByIndex(0)\n' +
  '  d = oShape.Description\n' +
  '  If InStr(d, field) = 0 Then\n' +
  '    If Len(d) &gt; 0 Then d = d &amp; ","\n' +
  '    oShape.Description = d &amp; field\n' +
  '  End If\n' +
  'End Sub\n' +
  // Components: push master props to every instance of the component on all
  // slides, skipping per-instance overrides (read from each shape Description).
  // args = "compId|type|fill|fillKind|gradTo|line|lineWidth|dash|fontColor|text|w|h".
  'Sub WosPropagate\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim p() As String\n' +
  '  p = Split(args, "|")\n' +
  '  Dim compId As String, typ As String, fill As Long, fk As String, gradTo As Long\n' +
  '  Dim lc As Long, lw As Long, fcol As Long, txt As String, w As Long, h As Long\n' +
  '  compId = p(0) : typ = p(1) : fill = CLng(p(2)) : fk = p(3) : gradTo = CLng(p(4))\n' +
  '  lc = CLng(p(5)) : lw = CLng(p(6)) : fcol = CLng(p(8)) : txt = p(9) : w = CLng(p(10)) : h = CLng(p(11))\n' +
  '  Dim tag As String\n' +
  '  tag = "WosA_" &amp; compId\n' +
  '  Dim oDoc, oSlides, slide, sh, ov As String, si As Integer, sj As Integer, ci As Integer, ch\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSlides = oDoc.DrawPages\n' +
  '  For si = 0 To oSlides.Count - 1\n' +
  '    slide = oSlides.getByIndex(si)\n' +
  '    For sj = 0 To slide.Count - 1\n' +
  '      sh = slide.getByIndex(sj)\n' +
  '      If sh.Name = tag Then\n' +
  '        ov = ""\n' +
  '        ov = sh.Description\n' +
  '        If typ = "shape" Then\n' +
  '          If InStr(ov, "fill") = 0 Then\n' +
  '            If fk = "gradient" Then\n' +
  '              Dim g As New com.sun.star.awt.Gradient\n' +
  '              g.Style = com.sun.star.awt.GradientStyle.LINEAR\n' +
  '              g.StartColor = fill : g.EndColor = gradTo : g.Angle = 450\n' +
  '              g.StartIntensity = 100 : g.EndIntensity = 100\n' +
  '              sh.FillStyle = com.sun.star.drawing.FillStyle.GRADIENT : sh.FillGradient = g\n' +
  '            Else\n' +
  '              sh.FillStyle = com.sun.star.drawing.FillStyle.SOLID : sh.FillColor = fill\n' +
  '            End If\n' +
  '          End If\n' +
  '          If InStr(ov, "line") = 0 Then\n' +
  '            sh.LineStyle = com.sun.star.drawing.LineStyle.SOLID : sh.LineColor = lc\n' +
  '            If lw &gt; 0 Then sh.LineWidth = lw\n' +
  '          End If\n' +
  '          If InStr(ov, "text") = 0 And Len(txt) &gt; 0 Then sh.setString(txt)\n' +
  '          If InStr(ov, "size") = 0 And w &gt; 0 And h &gt; 0 Then\n' +
  '            Dim z As New com.sun.star.awt.Size : z.Width = w : z.Height = h : sh.Size = z\n' +
  '          End If\n' +
  '        Else\n' +
  '          For ci = 0 To sh.Count - 1\n' +
  '            ch = sh.getByIndex(ci)\n' +
  '            If ch.Name = "bg" And InStr(ov, "fill") = 0 Then\n' +
  '              ch.FillStyle = com.sun.star.drawing.FillStyle.SOLID : ch.FillColor = fill\n' +
  '            End If\n' +
  '            If (ch.Name = "title" Or ch.Name = "caption") And InStr(ov, "text") = 0 And Len(txt) &gt; 0 Then ch.setString(txt)\n' +
  '          Next ci\n' +
  '        End If\n' +
  '      End If\n' +
  '    Next sj\n' +
  '  Next si\n' +
  'End Sub\n' +
  // ── End of Module1. The Wos* library is split across Module1 + Module2 because
  // StarBasic enforces a ~64KB per-module limit: over it, macros still resolve by
  // name (runMacro returns ok) but their bodies SILENTLY no-op. Each module is
  // kept comfortably under that limit (asserted at seed time). ──
  '</script:module>\n'

// Second half of the Wos* macro library (see BASIC_MODULE above for the split
// rationale). script:name="Module2". The shared helpers WosActiveDoc and
// WosTargetPage are DUPLICATED here so this module is fully self-contained — a
// macro must never call a helper that lives in the other module. The host runs
// generic macros against Module1 first and falls back to Module2 by name.
export const BASIC_MODULE_2 =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">\n' +
  '<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module2" script:language="StarBasic">\n' +
  // ── Duplicated shared helpers (identical to Module1) ──
  'Function WosActiveDoc As Object\n' +
  '  Dim sPath As String, f As Integer, oEnum, oComp\n' +
  '  WosActiveDoc = ThisComponent\n' +
  '  On Error Resume Next\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-doc.txt" For Input As #f\n' +
  '  Line Input #f, sPath\n' +
  '  Close #f\n' +
  '  If Len(sPath) = 0 Then Exit Function\n' +
  '  oEnum = StarDesktop.Components.createEnumeration()\n' +
  '  Do While oEnum.hasMoreElements()\n' +
  '    oComp = oEnum.nextElement()\n' +
  '    If Not IsNull(oComp) Then\n' +
  '      If oComp.supportsService("com.sun.star.document.OfficeDocument") Then\n' +
  '        If ConvertFromURL(oComp.URL) = sPath Then\n' +
  '          WosActiveDoc = oComp\n' +
  '          Exit Function\n' +
  '        End If\n' +
  '      End If\n' +
  '    End If\n' +
  '  Loop\n' +
  'End Function\n' +
  'Function WosTargetPage(oDoc As Object) As Object\n' +
  '  On Error Resume Next\n' +
  '  WosTargetPage = Nothing\n' +
  '  If oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then\n' +
  '    WosTargetPage = oDoc.CurrentController.ActiveSheet.DrawPage\n' +
  '  ElseIf oDoc.supportsService("com.sun.star.text.TextDocument") Then\n' +
  '    WosTargetPage = oDoc.DrawPage\n' +
  '  ElseIf oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then\n' +
  '    WosTargetPage = oDoc.CurrentController.CurrentPage\n' +
  '  Else\n' +
  '    WosTargetPage = oDoc.DrawPages.getByIndex(0)\n' +
  '  End If\n' +
  '  If IsNull(WosTargetPage) Then WosTargetPage = oDoc.DrawPages.getByIndex(0)\n' +
  'End Function\n' +
  // Word content blocks: insert a reusable text block at the cursor (flows in the
  // document, not a floating shape). args = "blockKind|title|body|color".
  'Sub WosInsertBlock\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim bk As String, title As String, body As String, col As Long\n' +
  '  bk = parts(0)\n' +
  '  title = "" : body = "" : col = 15658734\n' +
  '  If UBound(parts) &gt;= 1 Then title = parts(1)\n' +
  '  If UBound(parts) &gt;= 2 Then body = parts(2)\n' +
  '  If UBound(parts) &gt;= 3 Then col = CLng(parts(3))\n' +
  '  Dim oDoc, oVC, oText\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oVC = oDoc.CurrentController.ViewCursor\n' +
  '  oText = oVC.Text\n' +
  '  Dim PB As Integer\n' +
  '  PB = com.sun.star.text.ControlCharacter.PARAGRAPH_BREAK\n' +
  '  If bk = "callout" Then\n' +
  '    Dim oTable, oCell\n' +
  '    oTable = oDoc.createInstance("com.sun.star.text.TextTable")\n' +
  '    oTable.initialize(1, 1)\n' +
  '    oText.insertTextContent(oVC, oTable, False)\n' +
  '    oCell = oTable.getCellByName("A1")\n' +
  '    oCell.BackColor = col\n' +
  '    If Len(body) &gt; 0 Then\n' +
  '      oCell.setString(title &amp; Chr(10) &amp; body)\n' +
  '    Else\n' +
  '      oCell.setString(title)\n' +
  '    End If\n' +
  '  ElseIf bk = "heading" Then\n' +
  '    oVC.ParaStyleName = "Heading 1"\n' +
  '    oText.insertString(oVC, title, False)\n' +
  '    oText.insertControlCharacter(oVC, PB, False)\n' +
  '    oVC.ParaStyleName = "Default Paragraph Style"\n' +
  '    oText.insertString(oVC, body, False)\n' +
  '    oText.insertControlCharacter(oVC, PB, False)\n' +
  '  ElseIf bk = "quote" Then\n' +
  '    oVC.ParaStyleName = "Quotations"\n' +
  '    oText.insertString(oVC, body, False)\n' +
  '    oText.insertControlCharacter(oVC, PB, False)\n' +
  '    oVC.ParaStyleName = "Default Paragraph Style"\n' +
  '    If Len(title) &gt; 0 Then\n' +
  '      oText.insertString(oVC, "— " &amp; title, False)\n' +
  '      oText.insertControlCharacter(oVC, PB, False)\n' +
  '    End If\n' +
  '  ElseIf bk = "signature" Then\n' +
  '    oVC.ParaStyleName = "Default Paragraph Style"\n' +
  '    oText.insertString(oVC, title, False)\n' +
  '    oText.insertControlCharacter(oVC, PB, False)\n' +
  '    oText.insertString(oVC, body, False)\n' +
  '    oText.insertControlCharacter(oVC, PB, False)\n' +
  '  End If\n' +
  'End Sub\n' +
  // Excel: insert a NATIVE chart bound to a cell range that round-trips as real
  // chart XML in the saved .xlsx (xl/charts/chart1.xml + a c:ser bound to the
  // range). args = "chartType|range" where chartType = column|bar|line|pie|area
  // and range is optional (e.g. "A1:B4" or "Sheet1.A1:B4"). The range is
  // resolved in this priority: explicit arg → the live selection (if >1 cell) →
  // the sheet's used area. This makes the chart independent of the fragile live
  // selection (a 1×1 selection yields a series-less, empty chart). NB: avoid the
  // StarBasic reserved words `type`/`chart`/`line`/`name` — using ctype/oChart/
  // chartNm here (a reserved var silently poisons the whole Module1).
  'Sub WosInsertChart\n' +
  '  On Error Resume Next\n' +
  '  Dim rawArgs As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, rawArgs\n' +
  '  Close #f\n' +
  '  Dim parts() As String, ctype As String, wantRange As String\n' +
  '  parts = Split(rawArgs, "|")\n' +
  '  ctype = parts(0)\n' +
  '  wantRange = ""\n' +
  '  If UBound(parts) &gt;= 1 Then wantRange = parts(1)\n' +
  '  Dim oDoc, oSheet, oCharts, oChart, oSel, oRA\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  oSheet = oDoc.CurrentController.ActiveSheet\n' +
  // Resolve the source range. An explicit "A1:B4" (optionally "Sheet1.A1:B4") is
  // preferred; fall back to a multi-cell live selection; else the used area.
  '  Dim oRange\n' +
  '  If Len(wantRange) &gt; 0 Then\n' +
  '    If InStr(wantRange, ".") &gt; 0 Then\n' +
  '      Dim rp() As String\n' +
  '      rp = Split(wantRange, ".")\n' +
  '      If oDoc.Sheets.hasByName(rp(0)) Then oSheet = oDoc.Sheets.getByName(rp(0))\n' +
  '      oRange = oSheet.getCellRangeByName(rp(1))\n' +
  '    Else\n' +
  '      oRange = oSheet.getCellRangeByName(wantRange)\n' +
  '    End If\n' +
  '  End If\n' +
  '  If IsNull(oRange) Then\n' +
  '    oSel = oDoc.CurrentController.getSelection()\n' +
  '    If Not IsNull(oSel) Then\n' +
  '      oRA = oSel.RangeAddress\n' +
  '      If Not IsNull(oRA) Then\n' +
  '        If (oRA.EndColumn &gt; oRA.StartColumn) Or (oRA.EndRow &gt; oRA.StartRow) Then oRange = oSel\n' +
  '      End If\n' +
  '    End If\n' +
  '  End If\n' +
  '  If IsNull(oRange) Then\n' +
  // Used area: the cursor over the whole used range gives a real multi-cell block.
  '    Dim oCur\n' +
  '    oCur = oSheet.createCursor()\n' +
  '    oCur.gotoStartOfUsedArea(False)\n' +
  '    oCur.gotoEndOfUsedArea(True)\n' +
  '    oRange = oCur\n' +
  '  End If\n' +
  '  If IsNull(oRange) Then Exit Sub\n' +
  // Fail-safe: skip an empty range — a chart over no data would persist as a
  // series-less, useless chart. queryContentCells(16) = the VALUE (numeric)
  // cells; if there are none, exit cleanly (no chart, no crash).
  '  Dim oValues\n' +
  '  oValues = oRange.queryContentCells(com.sun.star.sheet.CellFlags.VALUE)\n' +
  '  If Not IsNull(oValues) Then\n' +
  '    If oValues.Count = 0 Then Exit Sub\n' +
  '  End If\n' +
  '  oRA = oRange.RangeAddress\n' +
  '  Dim aR(0) As New com.sun.star.table.CellRangeAddress\n' +
  '  aR(0) = oRA\n' +
  '  oCharts = oSheet.Charts\n' +
  '  Dim oRect As New com.sun.star.awt.Rectangle\n' +
  '  oRect.X = 9000 : oRect.Y = 500 : oRect.Width = 14000 : oRect.Height = 9000\n' +
  '  Dim chartNm As String\n' +
  '  chartNm = "WosChart" &amp; (oCharts.Count + 1)\n' +
  // addNewByName(name, rect, ranges, bColumnHeaders, bRowHeaders): binds the
  // range as the chart's data (this is what produces the c:ser in the xlsx).
  '  oCharts.addNewByName(chartNm, oRect, aR, True, True)\n' +
  '  oChart = oCharts.getByName(chartNm).EmbeddedObject\n' +
  '  If IsNull(oChart) Then Exit Sub\n' +
  // addNewByName produces a BarDiagram that DEFAULTS to a COLUMN chart
  // (barDir="col") with the range bound as a c:ser. So:
  //   column → keep the default diagram untouched (already vertical columns).
  //   bar    → flip the LIVE diagram to horizontal bars (Vertical = True; note
  //     the property reads "columns are the default", so True = horizontal bar).
  //   line/pie/area → setDiagram a fresh diagram of that type; the chart2 data
  //     binding survives the swap (verified: c:ser persists after setDiagram).
  // Mutate a HELD reference to the live diagram and set it back — assigning to
  // oChart.Diagram.Vertical on a transient getter did not stick. Do NOT set
  // properties on a detached createInstance() diagram before attaching — under
  // On Error Resume Next that silently drops the series (the original defect).
  '  If ctype = "bar" Then\n' +
  '    Dim oBar\n' +
  '    oBar = oChart.Diagram\n' +
  '    oBar.Vertical = True\n' +
  '    oChart.setDiagram(oBar)\n' +
  '  ElseIf ctype = "line" Then\n' +
  '    oChart.setDiagram(oChart.createInstance("com.sun.star.chart.LineDiagram"))\n' +
  '  ElseIf ctype = "pie" Then\n' +
  '    oChart.setDiagram(oChart.createInstance("com.sun.star.chart.PieDiagram"))\n' +
  '  ElseIf ctype = "area" Then\n' +
  '    oChart.setDiagram(oChart.createInstance("com.sun.star.chart.AreaDiagram"))\n' +
  '  End If\n' +
  'End Sub\n' +
  // Impress (PowerPoint): insert a NATIVE embedded chart on the current slide that
  // round-trips as REAL chart XML in the saved .pptx — a graphicFrame on the slide
  // that references an embedded chart part (ppt/charts/chartN.xml) carrying a
  // <c:ser> data series. NOT an image. The reliable headless path is an
  // OLE2Shape whose CLSID is the chart component's; getting its .Model yields a
  // classic com.sun.star.chart.ChartDocument, and setting inline data via
  // .Data.setData/.setRowDescriptions/.setColumnDescriptions binds a real series
  // that survives the pptx export. arg = chartType (column|bar|line|pie|area).
  // Reserved-word-safe: uses wosDoc/wosPage/wosShp/wosCd/wosDgm/wosDat/wosTy
  // (avoids chart/series/data/line/type/name — a reserved var silently poisons
  // the whole Module1).
  'Sub WosInsertSlideChart\n' +
  '  On Error Resume Next\n' +
  '  Dim rawArgs As String, ff As Integer\n' +
  '  ff = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #ff\n' +
  '  Line Input #ff, rawArgs\n' +
  '  Close #ff\n' +
  '  Dim wosParts() As String, wosTy As String\n' +
  '  wosParts = Split(rawArgs, "|")\n' +
  '  wosTy = wosParts(0)\n' +
  '  If Len(wosTy) = 0 Then wosTy = "column"\n' +
  '  Dim wosDoc, wosPage, wosShp, wosCd, wosDgm, wosDat\n' +
  '  wosDoc = WosActiveDoc()\n' +
  '  If Not wosDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  wosPage = WosTargetPage(wosDoc)\n' +
  '  If IsNull(wosPage) Then Exit Sub\n' +
  // Build the OLE2 host shape, size it, add it to the slide, then point it at the
  // chart component via CLSID. Adding BEFORE setting the CLSID (so the shape is
  // page-owned when the embedded model is created) is what makes .Model resolve.
  '  wosShp = wosDoc.createInstance("com.sun.star.presentation.OLE2Shape")\n' +
  '  If IsNull(wosShp) Then wosShp = wosDoc.createInstance("com.sun.star.drawing.OLE2Shape")\n' +
  '  If IsNull(wosShp) Then Exit Sub\n' +
  '  Dim wosSz As New com.sun.star.awt.Size, wosPs As New com.sun.star.awt.Point\n' +
  '  wosSz.Width = 14000 : wosSz.Height = 9000\n' +
  '  wosPs.X = 6000 : wosPs.Y = 4000\n' +
  '  wosPage.add(wosShp)\n' +
  '  wosShp.CLSID = "12dcae26-281f-416f-a234-c3086127382e"\n' +
  '  wosShp.Size = wosSz\n' +
  '  wosShp.Position = wosPs\n' +
  '  wosCd = wosShp.Model\n' +
  '  If IsNull(wosCd) Then Exit Sub\n' +
  // Set the diagram type FIRST (column is the BarDiagram default). Setting a fresh
  // diagram of the matching kind is REQUIRED for a stable OOXML export — binding
  // data onto the un-diagrammed default chart crashes the .pptx export filter
  // headless (proven: NODIAG data-only path crashed the engine on save; the
  // diagram-then-data path round-trips a real <c:ser>). bar flips the held
  // diagram to horizontal (Vertical = True); line/pie/area swap the diagram kind.
  '  If wosTy = "bar" Then\n' +
  '    wosDgm = wosCd.createInstance("com.sun.star.chart.BarDiagram")\n' +
  '    wosCd.setDiagram(wosDgm)\n' +
  '    wosDgm = wosCd.Diagram\n' +
  '    wosDgm.Vertical = True\n' +
  '    wosCd.setDiagram(wosDgm)\n' +
  '  ElseIf wosTy = "line" Then\n' +
  '    wosCd.setDiagram(wosCd.createInstance("com.sun.star.chart.LineDiagram"))\n' +
  '  ElseIf wosTy = "pie" Then\n' +
  '    wosCd.setDiagram(wosCd.createInstance("com.sun.star.chart.PieDiagram"))\n' +
  '  ElseIf wosTy = "area" Then\n' +
  '    wosCd.setDiagram(wosCd.createInstance("com.sun.star.chart.AreaDiagram"))\n' +
  '  Else\n' +
  '    wosCd.setDiagram(wosCd.createInstance("com.sun.star.chart.BarDiagram"))\n' +
  '  End If\n' +
  // Bind inline sample data: 4 categories x 2 series. The classic ChartDocument
  // .Data is an XChartDataArray — setData(numeric matrix) + row/column
  // descriptions produce the <c:ser> + categories that persist to the .pptx.
  '  wosDat = wosCd.Data\n' +
  '  If IsNull(wosDat) Then Exit Sub\n' +
  '  Dim wosM(3, 1) As Double\n' +
  '  wosM(0, 0) = 10.0 : wosM(0, 1) = 15.0\n' +
  '  wosM(1, 0) = 20.0 : wosM(1, 1) = 25.0\n' +
  '  wosM(2, 0) = 30.0 : wosM(2, 1) = 35.0\n' +
  '  wosM(3, 0) = 25.0 : wosM(3, 1) = 20.0\n' +
  '  wosDat.setData(wosM)\n' +
  '  Dim wosRows(3) As String, wosCols(1) As String\n' +
  '  wosRows(0) = "Q1" : wosRows(1) = "Q2" : wosRows(2) = "Q3" : wosRows(3) = "Q4"\n' +
  '  wosCols(0) = "Plan" : wosCols(1) = "Actual"\n' +
  '  wosDat.setRowDescriptions(wosRows)\n' +
  '  wosDat.setColumnDescriptions(wosCols)\n' +
  '  wosCd.setData(wosDat)\n' +
  '  wosDoc.CurrentController.select(wosShp)\n' +
  'End Sub\n' +
  // Excel range templates: stamp a formatted cell range at the selection.
  // args = "rangeKind|title|body|color" (rangeKind = kpi|header|table).
  'Sub WosStampRange\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim rk As String, title As String, body As String, col As Long\n' +
  '  rk = parts(0)\n' +
  '  title = "" : body = "" : col = 1810836\n' +
  '  If UBound(parts) &gt;= 1 Then title = parts(1)\n' +
  '  If UBound(parts) &gt;= 2 Then body = parts(2)\n' +
  '  If UBound(parts) &gt;= 3 Then col = CLng(parts(3))\n' +
  '  Dim oDoc, oSheet, oSel, addr, c As Integer, r As Integer, k As Integer, cc, white As Long\n' +
  '  white = RGB(255, 255, 255)\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  oSheet = oDoc.CurrentController.ActiveSheet\n' +
  '  oSel = oDoc.CurrentController.getSelection()\n' +
  '  addr = oSel.RangeAddress\n' +
  '  c = addr.StartColumn : r = addr.StartRow\n' +
  '  If rk = "kpi" Then\n' +
  '    cc = oSheet.getCellByPosition(c, r)\n' +
  '    cc.setString(title) : cc.CellBackColor = col : cc.CharColor = white\n' +
  '    cc.CharWeight = com.sun.star.awt.FontWeight.BOLD\n' +
  '    cc = oSheet.getCellByPosition(c, r + 1)\n' +
  '    cc.setString(body) : cc.CharHeight = 20\n' +
  '    cc.CharWeight = com.sun.star.awt.FontWeight.BOLD\n' +
  '  ElseIf rk = "header" Then\n' +
  '    For k = 0 To 2\n' +
  '      cc = oSheet.getCellByPosition(c + k, r)\n' +
  '      cc.CellBackColor = col : cc.CharColor = white\n' +
  '      cc.CharWeight = com.sun.star.awt.FontWeight.BOLD\n' +
  '    Next k\n' +
  '    oSheet.getCellByPosition(c, r).setString(title)\n' +
  '    If Len(body) &gt; 0 Then oSheet.getCellByPosition(c + 1, r).setString(body)\n' +
  '  ElseIf rk = "table" Then\n' +
  '    For k = 0 To 2\n' +
  '      cc = oSheet.getCellByPosition(c + k, r)\n' +
  '      cc.CellBackColor = col : cc.CharColor = white\n' +
  '      cc.CharWeight = com.sun.star.awt.FontWeight.BOLD\n' +
  '    Next k\n' +
  '    oSheet.getCellByPosition(c, r).setString(title)\n' +
  '    If Len(body) &gt; 0 Then oSheet.getCellByPosition(c + 1, r).setString(body)\n' +
  '    Dim oRange\n' +
  '    oRange = oSheet.getCellRangeByPosition(c, r, c + 2, r + 2)\n' +
  '    Dim oLine As New com.sun.star.table.BorderLine2\n' +
  '    oLine.LineWidth = 26 : oLine.Color = RGB(180, 180, 180)\n' +
  '    Dim oTB As New com.sun.star.table.TableBorder2\n' +
  '    oTB.TopLine = oLine : oTB.BottomLine = oLine : oTB.LeftLine = oLine : oTB.RightLine = oLine\n' +
  '    oTB.HorizontalLine = oLine : oTB.VerticalLine = oLine\n' +
  '    oTB.IsTopLineValid = True : oTB.IsBottomLineValid = True : oTB.IsLeftLineValid = True : oTB.IsRightLineValid = True\n' +
  '    oTB.IsHorizontalLineValid = True : oTB.IsVerticalLineValid = True\n' +
  '    oRange.TableBorder2 = oTB\n' +
  '  End If\n' +
  'End Sub\n' +
  // Calc conditional formatting via the sheet ConditionalFormat model API (the
  // reliable old-style CF: an operator condition + a named cell style that
  // carries the fill). Round-trips to the saved .xlsx as <conditionalFormatting>
  // + <cfRule> in the sheet part and the referenced <dxf> in xl/styles.xml.
  // args = "op|value1|value2|fillColor" — op in gt/lt/geq/leq/eq/between/clear;
  // fillColor is a decimal RGB Long. `clear` drops every CF entry on the range.
  // NB reserved-word discipline: none of Alias/Name/Type/Error/Stop/Line/Cell/
  // Row/Column/Sheet/Color/Fill/Rule/Format/Val/Style/String is used as a var
  // name below (op is not reserved; the style var is `oStyle`, the color var is
  // `colVal`, the range is `oRange`).
  'Sub WosCondFormat\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim wosOp As String, v1 As String, v2 As String, colVal As Long\n' +
  '  wosOp = parts(0)\n' +
  '  v1 = "" : v2 = "" : colVal = RGB(255, 235, 156)\n' +
  '  If UBound(parts) &gt;= 1 Then v1 = parts(1)\n' +
  '  If UBound(parts) &gt;= 2 Then v2 = parts(2)\n' +
  '  If UBound(parts) &gt;= 3 Then colVal = CLng(parts(3))\n' +
  '  Dim oDoc, oSel, oRange, oEntries\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  oSel = oDoc.CurrentController.getSelection()\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  // The selection must expose a cell-range interface (a single cell also does).
  '  If Not oSel.supportsService("com.sun.star.sheet.SheetCellRange") Then Exit Sub\n' +
  '  oRange = oSel\n' +
  '  oEntries = oRange.getPropertyValue("ConditionalFormat")\n' +
  '  If wosOp = "clear" Then\n' +
  '    oEntries.clear()\n' +
  '    oRange.setPropertyValue("ConditionalFormat", oEntries)\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  // Build/reuse a cell style that carries only the fill — CF references a style
  // by name, so the fill travels as that style's dxf on save.
  '  Dim styleNm As String, oStyles, oStyle\n' +
  '  styleNm = "WosCF_" &amp; Hex(colVal)\n' +
  '  oStyles = oDoc.StyleFamilies.getByName("CellStyles")\n' +
  '  If oStyles.hasByName(styleNm) Then\n' +
  '    oStyle = oStyles.getByName(styleNm)\n' +
  '  Else\n' +
  '    oStyle = oDoc.createInstance("com.sun.star.style.CellStyle")\n' +
  '    oStyles.insertByName(styleNm, oStyle)\n' +
  '  End If\n' +
  '  oStyle.CellBackColor = colVal\n' +
  '  oStyle.IsCellBackgroundTransparent = False\n' +
  // Map the op token to a ConditionOperator + the formula count it needs.
  '  Dim oCondOp As Integer\n' +
  '  If wosOp = "gt" Then\n' +
  '    oCondOp = com.sun.star.sheet.ConditionOperator.GREATER\n' +
  '  ElseIf wosOp = "lt" Then\n' +
  '    oCondOp = com.sun.star.sheet.ConditionOperator.LESS\n' +
  '  ElseIf wosOp = "geq" Then\n' +
  '    oCondOp = com.sun.star.sheet.ConditionOperator.GREATER_EQUAL\n' +
  '  ElseIf wosOp = "leq" Then\n' +
  '    oCondOp = com.sun.star.sheet.ConditionOperator.LESS_EQUAL\n' +
  '  ElseIf wosOp = "eq" Then\n' +
  '    oCondOp = com.sun.star.sheet.ConditionOperator.EQUAL\n' +
  '  ElseIf wosOp = "between" Then\n' +
  '    oCondOp = com.sun.star.sheet.ConditionOperator.BETWEEN\n' +
  '  Else\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  // The CF entry is an array of PropertyValues: Operator, Formula1 (+ Formula2
  // for BETWEEN), StyleName. addNew appends it; set the collection back so the
  // model records it against the range.
  '  Dim wosProps(3) As New com.sun.star.beans.PropertyValue\n' +
  '  wosProps(0).Name = "Operator"\n' +
  '  wosProps(0).Value = oCondOp\n' +
  '  wosProps(1).Name = "Formula1"\n' +
  '  wosProps(1).Value = v1\n' +
  '  wosProps(2).Name = "Formula2"\n' +
  '  If wosOp = "between" Then wosProps(2).Value = v2 Else wosProps(2).Value = ""\n' +
  '  wosProps(3).Name = "StyleName"\n' +
  '  wosProps(3).Value = styleNm\n' +
  '  oEntries.addNew(wosProps())\n' +
  '  oRange.setPropertyValue("ConditionalFormat", oEntries)\n' +
  'End Sub\n' +
  // Calc data validation via the cell-range Validation propertyset (service
  // com.sun.star.sheet.TableValidation). A range exposes a `Validation`
  // XPropertySet with Type (ValidationType: LIST/WHOLE/DECIMAL/TEXT_LEN), an
  // Operator (ConditionOperator for the range kinds — BETWEEN etc.), Formula1 and
  // Formula2. The propertyset must be assigned BACK to the range's Validation
  // property for the model to record it — mutating in place is not enough.
  // Round-trips to the saved .xlsx as <dataValidations><dataValidation type="…"
  // sqref="…"><formula1>…</formula1>. args = "kind|arg1|arg2":
  //   list     arg1 = comma-separated values          -> type="list"
  //   whole    arg1 = min, arg2 = max  (BETWEEN)      -> type="whole"
  //   decimal  arg1 = min, arg2 = max  (BETWEEN)      -> type="decimal"
  //   textlen  arg1 = max length       (LESS_EQUAL)   -> type="textLength"
  //   clear                                           -> strips validation
  // NB reserved-word discipline: no var below is Alias/Name/Type/Error/Stop/Line/
  // Cell/Row/Column/Sheet/List/Text/Value — the kind var is `wosKind`, the range
  // is `wosRange`, the validation propertyset is `wosVal`, the list string is
  // `wosItems`, min/max are carried in `wosA1`/`wosA2`.
  'Sub WosDataValidation\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  Dim wosKind As String, wosA1 As String, wosA2 As String\n' +
  '  wosKind = parts(0)\n' +
  '  wosA1 = "" : wosA2 = ""\n' +
  '  If UBound(parts) &gt;= 1 Then wosA1 = parts(1)\n' +
  '  If UBound(parts) &gt;= 2 Then wosA2 = parts(2)\n' +
  '  Dim oDoc, oSel, wosRange, wosVal\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  oSel = oDoc.CurrentController.getSelection()\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  If Not oSel.supportsService("com.sun.star.sheet.SheetCellRange") Then Exit Sub\n' +
  '  wosRange = oSel\n' +
  '  wosVal = wosRange.getPropertyValue("Validation")\n' +
  '  If wosKind = "clear" Then\n' +
  '    wosVal.Type = com.sun.star.sheet.ValidationType.ANY\n' +
  '    wosVal.Formula1 = ""\n' +
  '    wosVal.Formula2 = ""\n' +
  '    wosRange.setPropertyValue("Validation", wosVal)\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  '  If wosKind = "list" Then\n' +
  // A LIST validation carries the entries as a semicolon-separated, quoted
  // Formula1 ("a";"b";"c"). ShowList = UNSORTED makes the dropdown appear. This
  // round-trips to <dataValidation type="list"><formula1>"a,b,c"</formula1>.
  '    Dim wosItems As String, wosArr() As String, wosI As Integer\n' +
  '    wosItems = ""\n' +
  '    wosArr = Split(wosA1, ",")\n' +
  '    For wosI = 0 To UBound(wosArr)\n' +
  '      If wosI &gt; 0 Then wosItems = wosItems &amp; ";"\n' +
  '      wosItems = wosItems &amp; Chr(34) &amp; Trim(wosArr(wosI)) &amp; Chr(34)\n' +
  '    Next wosI\n' +
  '    wosVal.Type = com.sun.star.sheet.ValidationType.LIST\n' +
  '    wosVal.ShowList = com.sun.star.sheet.TableValidationVisibility.UNSORTED\n' +
  '    wosVal.Formula1 = wosItems\n' +
  '    wosVal.Formula2 = ""\n' +
  '  ElseIf wosKind = "whole" Or wosKind = "decimal" Then\n' +
  '    If wosKind = "whole" Then\n' +
  '      wosVal.Type = com.sun.star.sheet.ValidationType.WHOLE\n' +
  '    Else\n' +
  '      wosVal.Type = com.sun.star.sheet.ValidationType.DECIMAL\n' +
  '    End If\n' +
  '    wosVal.Operator = com.sun.star.sheet.ConditionOperator.BETWEEN\n' +
  '    wosVal.Formula1 = wosA1\n' +
  '    wosVal.Formula2 = wosA2\n' +
  '  ElseIf wosKind = "textlen" Then\n' +
  '    wosVal.Type = com.sun.star.sheet.ValidationType.TEXT_LEN\n' +
  '    wosVal.Operator = com.sun.star.sheet.ConditionOperator.LESS_EQUAL\n' +
  '    wosVal.Formula1 = wosA1\n' +
  '    wosVal.Formula2 = ""\n' +
  '  Else\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  '  wosVal.ShowErrorMessage = True\n' +
  '  wosRange.setPropertyValue("Validation", wosVal)\n' +
  'End Sub\n' +
  // Live transclusion: set ONE cell to a numeric value (fidelity floor — a real
  // number in a real .xlsx). args = "sheetName|A1cell|value". An unknown sheet
  // falls back to the active sheet; Val() parses "21.9" locale-independently.
  'Sub WosSetCell\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  If UBound(parts) &lt; 2 Then Exit Sub\n' +
  '  Dim sheetName As String, cellName As String, v As Double\n' +
  '  sheetName = parts(0)\n' +
  '  cellName = parts(1)\n' +
  '  v = Val(parts(2))\n' +
  '  Dim oDoc, oSheet, oCell\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  If oDoc.Sheets.hasByName(sheetName) Then\n' +
  '    oSheet = oDoc.Sheets.getByName(sheetName)\n' +
  '  Else\n' +
  '    oSheet = oDoc.CurrentController.ActiveSheet\n' +
  '  End If\n' +
  '  oCell = oSheet.getCellRangeByName(cellName).getCellByPosition(0, 0)\n' +
  '  oCell.setValue(v)\n' +
  'End Sub\n' +
  // Live transclusion (Writer): insert the metric value at the view cursor,
  // wrapped in a tagged content control (w:sdt) — the stable Word anchor. The tag
  // (wos-metric-<linkId>) is how the value is later located for update, in the
  // open doc (WosSetContentControl) and on disk (docx-cc-writer). args =
  // "tag|value|alias"; alias is the friendly metric name shown in Word's UI.
  'Sub WosInsertContentControl\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  If UBound(parts) &lt; 1 Then Exit Sub\n' +
  // NB: `Alias` is a reserved StarBasic keyword (Declare ... Alias). A variable
  // named `alias` is a MODULE-LEVEL COMPILE ERROR that silently poisons the whole
  // Module1 — every Wos* macro then resolves by name (runMacro returns ok) but its
  // body never executes. Use `aliasNm`.
  '  Dim tag As String, val As String, aliasNm As String\n' +
  '  tag = parts(0)\n' +
  '  val = parts(1)\n' +
  '  aliasNm = ""\n' +
  '  If UBound(parts) &gt;= 2 Then aliasNm = parts(2)\n' +
  '  Dim oDoc, oVC, oText, oCur, oCC\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oVC = oDoc.CurrentController.ViewCursor\n' +
  '  oText = oVC.Text\n' +
  '  If IsNull(oText) Then oText = oDoc.Text\n' +
  '  oText.insertString(oVC, val, False)\n' +
  '  oCur = oText.createTextCursorByRange(oVC.Start)\n' +
  '  oCur.goLeft(Len(val), True)\n' +
  '  oCC = oDoc.createInstance("com.sun.star.text.ContentControl")\n' +
  '  oText.insertTextContent(oCur, oCC, True)\n' +
  '  oCC.Tag = tag\n' +
  '  If Len(aliasNm) &gt; 0 Then oCC.Alias = aliasNm\n' +
  'End Sub\n' +
  // Live transclusion (Writer): set the text of the content control tagged `tag`
  // to `value`, in place (keeps the w:sdt intact). Mirrors WosSetCell for docx.
  // args = "tag|value".
  'Sub WosSetContentControl\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  If UBound(parts) &lt; 1 Then Exit Sub\n' +
  '  Dim tag As String, val As String\n' +
  '  tag = parts(0)\n' +
  '  val = parts(1)\n' +
  '  Dim oDoc, oEnum, oPar, oPortEnum, oPort, oCC, oCur\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oEnum = oDoc.Text.createEnumeration()\n' +
  '  Do While oEnum.hasMoreElements()\n' +
  '    oPar = oEnum.nextElement()\n' +
  '    If oPar.supportsService("com.sun.star.text.Paragraph") Then\n' +
  '      oPortEnum = oPar.createEnumeration()\n' +
  '      Do While oPortEnum.hasMoreElements()\n' +
  '        oPort = oPortEnum.nextElement()\n' +
  '        If oPort.TextPortionType = "ContentControl" Then\n' +
  '          oCC = oPort.ContentControl\n' +
  '          If oCC.Tag = tag Then\n' +
  '            oCur = oCC.createTextCursor()\n' +
  '            oCur.gotoStart(False)\n' +
  '            oCur.gotoEnd(True)\n' +
  '            oCur.setString(val)\n' +
  '          End If\n' +
  '        End If\n' +
  '      Loop\n' +
  '    End If\n' +
  '  Loop\n' +
  'End Sub\n' +
  // Live transclusion (Impress): insert the metric value on the current slide as a
  // named text shape — the stable PPT anchor. The Name (wos-metric-<linkId>) is how
  // the value is later located for update, in the open deck (WosSetShapeTextByName)
  // and on disk (pptx-shape-writer). It round-trips as a pptx <p:cNvPr name>.
  // args = "tag|value".
  'Sub WosInsertMetricShape\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  If UBound(parts) &lt; 1 Then Exit Sub\n' +
  '  Dim tag As String, val As String\n' +
  '  tag = parts(0)\n' +
  '  val = parts(1)\n' +
  '  Dim oDoc, oPage, oShape\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oPage = oDoc.CurrentController.CurrentPage\n' +
  '  If IsNull(oPage) Then oPage = oDoc.DrawPages.getByIndex(0)\n' +
  '  oShape = oDoc.createInstance("com.sun.star.drawing.TextShape")\n' +
  '  oPage.add(oShape)\n' +
  '  oShape.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PAGE\n' +
  '  Dim oSize As New com.sun.star.awt.Size, oPos As New com.sun.star.awt.Point\n' +
  '  oSize.Width = 6000 : oSize.Height = 2000\n' +
  '  oShape.Size = oSize\n' +
  '  oPos.X = 5000 : oPos.Y = 5000\n' +
  '  oShape.Position = oPos\n' +
  '  oShape.TextAutoGrowHeight = True\n' +
  '  oShape.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '  oShape.Name = tag\n' +
  '  oShape.setString(val)\n' +
  '  oDoc.CurrentController.select(oShape)\n' +
  'End Sub\n' +
  // Live transclusion (Impress): set the text of the shape NAMED `tag` to `value`,
  // across every slide (by Name — never relies on the current selection). Mirrors
  // WosSetContentControl for pptx. args = "tag|value".
  'Sub WosSetShapeTextByName\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  If UBound(parts) &lt; 1 Then Exit Sub\n' +
  '  Dim tag As String, val As String\n' +
  '  tag = parts(0)\n' +
  '  val = parts(1)\n' +
  '  Dim oDoc, oPages, oPage, oShape, i As Integer, j As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oPages = oDoc.DrawPages\n' +
  '  For i = 0 To oPages.Count - 1\n' +
  '    oPage = oPages.getByIndex(i)\n' +
  '    For j = 0 To oPage.Count - 1\n' +
  '      oShape = oPage.getByIndex(j)\n' +
  '      If oShape.Name = tag Then oShape.setString(val)\n' +
  '    Next j\n' +
  '  Next i\n' +
  'End Sub\n' +
  // Live ranges (Calc): stamp a GRID of literals into a block anchored at its
  // top-left cell. The payload comes from /tmp/wos-range-in.txt (written by the
  // main process — a grid is too big/rich for the 1-line macro arg): line 1 is
  // "sheetName|anchorA1", then one line per row with TAB-separated cells, each
  // "n:<number>", "s:<text>" or "e" (empty → cell cleared). Mirrors WosSetCell,
  // block-sized. NB: `line` is a StarBasic keyword (Line Input) — use `ln`.
  'Sub WosSetRangeBlock\n' +
  '  On Error Resume Next\n' +
  '  Dim f As Integer, head As String, ln As String\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-range-in.txt" For Input As #f\n' +
  '  Line Input #f, head\n' +
  '  Dim hp() As String\n' +
  '  hp = Split(head, "|")\n' +
  '  If UBound(hp) &lt; 1 Then\n' +
  '    Close #f\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  '  Dim oDoc, oSheet, addr\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then\n' +
  '    Close #f\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  '  If oDoc.Sheets.hasByName(hp(0)) Then\n' +
  '    oSheet = oDoc.Sheets.getByName(hp(0))\n' +
  '  Else\n' +
  '    oSheet = oDoc.CurrentController.ActiveSheet\n' +
  '  End If\n' +
  '  addr = oSheet.getCellRangeByName(hp(1)).getCellByPosition(0, 0).CellAddress\n' +
  '  Dim r As Integer, c As Integer, cl() As String, oCell, ent As String\n' +
  '  r = 0\n' +
  '  Do While Not EOF(f)\n' +
  '    Line Input #f, ln\n' +
  '    If Len(ln) &gt; 0 Then\n' +
  '      cl = Split(ln, Chr(9))\n' +
  '      For c = 0 To UBound(cl)\n' +
  '        oCell = oSheet.getCellByPosition(addr.Column + c, addr.Row + r)\n' +
  '        ent = cl(c)\n' +
  '        If Left(ent, 2) = "n:" Then\n' +
  '          oCell.setValue(Val(Mid(ent, 3)))\n' +
  '        ElseIf Left(ent, 2) = "s:" Then\n' +
  '          oCell.setString(Mid(ent, 3))\n' +
  '        Else\n' +
  '          oCell.setFormula("")\n' +
  '        End If\n' +
  '      Next c\n' +
  '      r = r + 1\n' +
  '    End If\n' +
  '  Loop\n' +
  '  Close #f\n' +
  'End Sub\n' +
  // Live tables (Writer): insert a real Word TEXT TABLE at the view cursor holding
  // the grid, wrapped so a preceding bookmark named `tag` (wos-range-<id>) marks it
  // — the stable, round-tripping anchor the closed-file docx-table-writer locates.
  // The grid travels via /tmp/wos-table-in.txt (line 1 = tag; then TAB rows of cell
  // text). The table is also named `tag` for the open-doc WosSetDocTable lookup.
  // NB: `table`/`cell`/`row`/`column`/`line` are risky StarBasic identifiers — this
  // uses oTbl/oCell/oRows/ln and grid vars nr/nc/r/c.
  'Sub WosInsertDocTable\n' +
  '  On Error Resume Next\n' +
  '  Dim f As Integer, tag As String, ln As String\n' +
  '  Dim gr() As String, nr As Integer, nc As Integer, r As Integer, c As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-table-in.txt" For Input As #f\n' +
  '  Line Input #f, tag\n' +
  '  nr = 0\n' +
  '  ReDim gr(199)\n' +
  '  Do While Not EOF(f)\n' +
  '    Line Input #f, ln\n' +
  '    gr(nr) = ln\n' +
  '    nr = nr + 1\n' +
  '  Loop\n' +
  '  Close #f\n' +
  '  If nr = 0 Or Len(tag) = 0 Then Exit Sub\n' +
  '  Dim cells0() As String\n' +
  '  cells0 = Split(gr(0), Chr(9))\n' +
  '  nc = UBound(cells0) + 1\n' +
  '  Dim oDoc, oVC, oText, oTbl, cl() As String\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oVC = oDoc.CurrentController.ViewCursor\n' +
  '  oText = oVC.Text\n' +
  '  If IsNull(oText) Then oText = oDoc.Text\n' +
  // A bookmark placed at the cursor, immediately BEFORE the table, is the anchor
  // that round-trips to <w:bookmarkStart w:name="tag"/> in the .docx.
  '  Dim oBm\n' +
  '  oBm = oDoc.createInstance("com.sun.star.text.Bookmark")\n' +
  '  oBm.Name = tag\n' +
  '  oText.insertTextContent(oVC, oBm, False)\n' +
  '  oTbl = oDoc.createInstance("com.sun.star.text.TextTable")\n' +
  '  oTbl.initialize(nr, nc)\n' +
  '  oText.insertTextContent(oVC, oTbl, False)\n' +
  '  oTbl.Name = tag\n' +
  '  For r = 0 To nr - 1\n' +
  '    cl = Split(gr(r), Chr(9))\n' +
  '    For c = 0 To nc - 1\n' +
  '      Dim cn As String\n' +
  '      cn = Chr(65 + c) &amp; (r + 1)\n' +
  '      If c &lt;= UBound(cl) Then oTbl.getCellByName(cn).setString(cl(c))\n' +
  '    Next c\n' +
  '  Next r\n' +
  'End Sub\n' +
  // Live tables (Writer): set the cells of the TextTable named `tag` to the grid,
  // in place (keeps the <w:tbl> + bookmark intact). Mirrors WosSetRangeBlock for
  // Writer. Grid via /tmp/wos-table-in.txt (line 1 = tag; then TAB rows).
  'Sub WosSetDocTable\n' +
  '  On Error Resume Next\n' +
  '  Dim f As Integer, tag As String, ln As String\n' +
  '  Dim gr() As String, nr As Integer, r As Integer, c As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-table-in.txt" For Input As #f\n' +
  '  Line Input #f, tag\n' +
  '  nr = 0\n' +
  '  ReDim gr(199)\n' +
  '  Do While Not EOF(f)\n' +
  '    Line Input #f, ln\n' +
  '    gr(nr) = ln\n' +
  '    nr = nr + 1\n' +
  '  Loop\n' +
  '  Close #f\n' +
  '  If nr = 0 Or Len(tag) = 0 Then Exit Sub\n' +
  '  Dim oDoc, oTbl, cl() As String\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oTbl = Nothing\n' +
  // Fast path: the table still carries our Name (same session as the insert).
  '  If oDoc.TextTables.hasByName(tag) Then\n' +
  '    oTbl = oDoc.TextTables.getByName(tag)\n' +
  '  ElseIf oDoc.Bookmarks.hasByName(tag) Then\n' +
  // On a REOPENED doc the Name is lost (it does not round-trip OOXML) but the
  // bookmark does. Enumerate the body, tracking the last table seen; when the
  // enum element ends at/after the bookmark anchor, that last table is ours.
  '    Dim oAnchor, oEnum, oEl, oLast\n' +
  '    oAnchor = oDoc.Bookmarks.getByName(tag).Anchor\n' +
  '    oLast = Nothing\n' +
  '    oEnum = oDoc.Text.createEnumeration()\n' +
  '    Do While oEnum.hasMoreElements()\n' +
  '      oEl = oEnum.nextElement()\n' +
  '      If oEl.supportsService("com.sun.star.text.TextTable") Then\n' +
  '        oLast = oEl\n' +
  '      ElseIf oEl.supportsService("com.sun.star.text.Paragraph") Then\n' +
  '        If Not IsNull(oLast) Then\n' +
  '          If oDoc.Text.compareRegionStarts(oEl.Start, oAnchor.Start) &lt;= 0 Then\n' +
  '            oTbl = oLast\n' +
  '            Exit Do\n' +
  '          End If\n' +
  '        End If\n' +
  '      End If\n' +
  '    Loop\n' +
  '    If IsNull(oTbl) Then oTbl = oLast\n' +
  // Re-tag the resolved table so later sets in this session take the fast path.
  '    If Not IsNull(oTbl) Then oTbl.Name = tag\n' +
  '  End If\n' +
  '  If IsNull(oTbl) Then Exit Sub\n' +
  '  For r = 0 To nr - 1\n' +
  '    cl = Split(gr(r), Chr(9))\n' +
  '    For c = 0 To UBound(cl)\n' +
  '      Dim cn As String\n' +
  '      cn = Chr(65 + c) &amp; (r + 1)\n' +
  '      oTbl.getCellByName(cn).setString(cl(c))\n' +
  '    Next c\n' +
  '  Next r\n' +
  'End Sub\n' +
  // Live tables (Impress): insert a real slide TABLE holding the grid, its frame
  // NAMED `tag` (wos-range-<id>) — the stable anchor that round-trips as a pptx
  // <p:cNvPr name> on the graphicFrame, which the closed-file pptx-table-writer
  // locates. Grid via /tmp/wos-table-in.txt (line 1 = tag; then TAB rows).
  'Sub WosInsertSlideTable\n' +
  '  On Error Resume Next\n' +
  '  Dim f As Integer, tag As String, ln As String\n' +
  '  Dim gr() As String, nr As Integer, nc As Integer, r As Integer, c As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-table-in.txt" For Input As #f\n' +
  '  Line Input #f, tag\n' +
  '  nr = 0\n' +
  '  ReDim gr(199)\n' +
  '  Do While Not EOF(f)\n' +
  '    Line Input #f, ln\n' +
  '    gr(nr) = ln\n' +
  '    nr = nr + 1\n' +
  '  Loop\n' +
  '  Close #f\n' +
  '  If nr = 0 Or Len(tag) = 0 Then Exit Sub\n' +
  '  Dim cells0() As String\n' +
  '  cells0 = Split(gr(0), Chr(9))\n' +
  '  nc = UBound(cells0) + 1\n' +
  '  Dim oDoc, oPage, oTbl, oModel, oCell, cl() As String\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oPage = oDoc.CurrentController.CurrentPage\n' +
  '  If IsNull(oPage) Then oPage = oDoc.DrawPages.getByIndex(0)\n' +
  '  oTbl = oDoc.createInstance("com.sun.star.presentation.TableShape")\n' +
  '  oPage.add(oTbl)\n' +
  '  Dim oSize As New com.sun.star.awt.Size, oPos As New com.sun.star.awt.Point\n' +
  '  oSize.Width = 18000 : oSize.Height = 1000 * nr\n' +
  '  oTbl.Size = oSize\n' +
  '  oPos.X = 3000 : oPos.Y = 3000\n' +
  '  oTbl.Position = oPos\n' +
  '  oModel = oTbl.Model\n' +
  '  If oModel.Rows.Count &lt; nr Then oModel.Rows.insertByIndex(0, nr - oModel.Rows.Count)\n' +
  '  If oModel.Columns.Count &lt; nc Then oModel.Columns.insertByIndex(0, nc - oModel.Columns.Count)\n' +
  '  For r = 0 To nr - 1\n' +
  '    cl = Split(gr(r), Chr(9))\n' +
  '    For c = 0 To nc - 1\n' +
  '      oCell = oModel.getCellByPosition(c, r)\n' +
  '      If c &lt;= UBound(cl) Then oCell.setString(cl(c))\n' +
  '    Next c\n' +
  '  Next r\n' +
  '  oTbl.Name = tag\n' +
  '  oDoc.CurrentController.select(oTbl)\n' +
  'End Sub\n' +
  // Live tables (Impress): set the cells of the slide TABLE whose frame is NAMED
  // `tag` to the grid, in place. Mirrors WosSetShapeTextByName for tables. Grid via
  // /tmp/wos-table-in.txt (line 1 = tag; then TAB rows).
  'Sub WosSetSlideTable\n' +
  '  On Error Resume Next\n' +
  '  Dim f As Integer, tag As String, ln As String\n' +
  '  Dim gr() As String, nr As Integer, r As Integer, c As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-table-in.txt" For Input As #f\n' +
  '  Line Input #f, tag\n' +
  '  nr = 0\n' +
  '  ReDim gr(199)\n' +
  '  Do While Not EOF(f)\n' +
  '    Line Input #f, ln\n' +
  '    gr(nr) = ln\n' +
  '    nr = nr + 1\n' +
  '  Loop\n' +
  '  Close #f\n' +
  '  If nr = 0 Or Len(tag) = 0 Then Exit Sub\n' +
  '  Dim oDoc, oPages, oPage, oShape, oModel, oCell, i As Integer, j As Integer, cl() As String\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oPages = oDoc.DrawPages\n' +
  '  For i = 0 To oPages.Count - 1\n' +
  '    oPage = oPages.getByIndex(i)\n' +
  '    For j = 0 To oPage.Count - 1\n' +
  '      oShape = oPage.getByIndex(j)\n' +
  '      If oShape.Name = tag Then\n' +
  '        oModel = oShape.Model\n' +
  '        If Not IsNull(oModel) Then\n' +
  '          For r = 0 To nr - 1\n' +
  '            cl = Split(gr(r), Chr(9))\n' +
  '            For c = 0 To UBound(cl)\n' +
  '              oCell = oModel.getCellByPosition(c, r)\n' +
  '              If Not IsNull(oCell) Then oCell.setString(cl(c))\n' +
  '            Next c\n' +
  '          Next r\n' +
  '        End If\n' +
  '      End If\n' +
  '    Next j\n' +
  '  Next i\n' +
  'End Sub\n' +
  // True when `oObj` is a presentation/draw TABLE shape. A slide table shape does
  // NOT list "…TableShape" in SupportedServiceNames (so supportsService() returns
  // False and misses it) — the reliable discriminator is the ShapeType property,
  // which is "com.sun.star.presentation.TableShape" (or "…drawing.TableShape").
  // Guarded so a shape without a ShapeType (or Nothing) never throws.
  'Function WosIsTableShape(oObj) As Boolean\n' +
  '  On Error Resume Next\n' +
  '  WosIsTableShape = False\n' +
  '  If IsNull(oObj) Then Exit Function\n' +
  '  Dim st As String\n' +
  '  st = oObj.ShapeType\n' +
  '  If st = "com.sun.star.presentation.TableShape" Or st = "com.sun.star.drawing.TableShape" Then WosIsTableShape = True\n' +
  'End Function\n' +
  // Live tables (Impress): STRUCTURAL edit of the slide table the user is IN —
  // add/remove rows & columns and set row height / column width. Mirrors the
  // Writer WosTableOp, but on the presentation table model (oShape.Model is a
  // com.sun.star.table XCellRange with .Rows/.Columns/getCellByPosition).
  // args = "op|arg" (op = rowafter/rowbefore/delrow/colafter/colbefore/delcol/
  // rowheight/colwidth; arg = size in 1/100 mm for rowheight/colwidth). The op
  // targets the LAST row/col (append after / remove the end) — deterministic and
  // never out of range, since the table view cursor is not reachable headless.
  // No-op (Exit Sub) when no table shape is selected/present, so it never crashes.
  'Sub WosSlideTableOp\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String, op As String, argN As Long\n' +
  '  parts = Split(args, "|")\n' +
  '  op = parts(0)\n' +
  '  argN = 0\n' +
  '  If UBound(parts) &gt;= 1 Then argN = CLng(parts(1))\n' +
  '  Dim oDoc, oSel, oShape, oModel\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  // Resolve the target TABLE shape. The selection is either the table shape
  // itself (frame selected) or a cell/cell-range (a cell is being edited).
  '  oShape = Nothing\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If Not IsNull(oSel) Then\n' +
  '    If WosIsTableShape(oSel) Then\n' +
  '      oShape = oSel\n' +
  '    ElseIf oSel.supportsService("com.sun.star.drawing.XShapes") Then\n' +
  '      If oSel.Count = 1 Then\n' +
  '        If WosIsTableShape(oSel.getByIndex(0)) Then oShape = oSel.getByIndex(0)\n' +
  '      End If\n' +
  '    End If\n' +
  '  End If\n' +
  // Fallback: the only / first table shape on the current slide. In headless the
  // controller's CurrentPage can be null → fall back to the first draw page.
  '  If IsNull(oShape) Then\n' +
  '    Dim oPage, j As Integer\n' +
  '    oPage = oDoc.CurrentController.CurrentPage\n' +
  '    If IsNull(oPage) Then oPage = oDoc.DrawPages.getByIndex(0)\n' +
  '    If Not IsNull(oPage) Then\n' +
  '      For j = 0 To oPage.Count - 1\n' +
  '        If WosIsTableShape(oPage.getByIndex(j)) Then\n' +
  '          oShape = oPage.getByIndex(j)\n' +
  '          Exit For\n' +
  '        End If\n' +
  '      Next j\n' +
  '    End If\n' +
  '  End If\n' +
  '  If IsNull(oShape) Then Exit Sub\n' +
  '  oModel = oShape.Model\n' +
  '  If IsNull(oModel) Then Exit Sub\n' +
  '  Dim nRows As Long, nCols As Long, rw As Long, cl As Long\n' +
  '  nRows = oModel.Rows.Count\n' +
  '  nCols = oModel.Columns.Count\n' +
  // Resolve the ACTIVE cell so insert/delete acts NEXT TO where the user is —
  // native PowerPoint behaviour. When a table cell (or cell range) is selected the
  // engine exposes it as a com.sun.star.table.CellRange whose RangeAddress carries
  // the 0-based StartRow/StartColumn (top-left of the active cell(s)); we read that
  // and target it. The table VIEW cursor is not reachable headless (the Selection
  // is often the frame shape, not a live cell), so when no cell range is resolvable
  // we FALL BACK to the last row/col (append after / trim the end) — deterministic
  // and never out of range. rw/cl default to the last index for that fallback.
  '  rw = nRows - 1\n' +
  '  cl = nCols - 1\n' +
  '  Dim oActive, oAddr\n' +
  '  oActive = Nothing\n' +
  // (a) The current Selection is itself a cell / cell-range (a cell is being edited).
  '  If Not IsNull(oSel) Then\n' +
  '    If oSel.supportsService("com.sun.star.table.CellRange") Then oActive = oSel\n' +
  '  End If\n' +
  // (b) Otherwise ask the controller for its live selection (the table cell cursor).
  '  If IsNull(oActive) Then\n' +
  '    Dim oTry\n' +
  '    oTry = oDoc.CurrentController.getSelection()\n' +
  '    If Not IsNull(oTry) Then\n' +
  '      If oTry.supportsService("com.sun.star.table.CellRange") Then oActive = oTry\n' +
  '    End If\n' +
  '  End If\n' +
  '  If Not IsNull(oActive) Then\n' +
  '    oAddr = oActive.RangeAddress\n' +
  '    If Not IsNull(oAddr) Then\n' +
  '      If oAddr.StartRow &gt;= 0 And oAddr.StartRow &lt; nRows Then rw = oAddr.StartRow\n' +
  '      If oAddr.StartColumn &gt;= 0 And oAddr.StartColumn &lt; nCols Then cl = oAddr.StartColumn\n' +
  '    End If\n' +
  '  End If\n' +
  // (c) An explicit cell from the renderer wins: it knows where the pointer was
  // (TABLE_SELECTED edges + the click point), which the headless view cannot say.
  '  If UBound(parts) &gt;= 3 Then\n' +
  '    If parts(2) &lt;&gt; "" Then\n' +
  '      If CLng(parts(2)) &gt;= 0 And CLng(parts(2)) &lt; nRows Then rw = CLng(parts(2))\n' +
  '    End If\n' +
  '    If parts(3) &lt;&gt; "" Then\n' +
  '      If CLng(parts(3)) &gt;= 0 And CLng(parts(3)) &lt; nCols Then cl = CLng(parts(3))\n' +
  '    End If\n' +
  '  End If\n' +
  '  If op = "rowafter" Then\n' +
  '    oModel.Rows.insertByIndex(rw + 1, 1)\n' +
  '  ElseIf op = "rowbefore" Then\n' +
  '    oModel.Rows.insertByIndex(rw, 1)\n' +
  '  ElseIf op = "delrow" Then\n' +
  '    If nRows &gt; 1 Then oModel.Rows.removeByIndex(rw, 1)\n' +
  '  ElseIf op = "colafter" Then\n' +
  '    oModel.Columns.insertByIndex(cl + 1, 1)\n' +
  '  ElseIf op = "colbefore" Then\n' +
  '    oModel.Columns.insertByIndex(cl, 1)\n' +
  '  ElseIf op = "delcol" Then\n' +
  '    If nCols &gt; 1 Then oModel.Columns.removeByIndex(cl, 1)\n' +
  '  ElseIf op = "rowheight" Then\n' +
  '    If argN &gt; 0 And rw &gt;= 0 Then\n' +
  '      oModel.Rows.getByIndex(rw).IsAutoHeight = False\n' +
  '      oModel.Rows.getByIndex(rw).Height = argN\n' +
  '    End If\n' +
  '  ElseIf op = "colwidth" Then\n' +
  '    If argN &gt; 0 And cl &gt;= 0 Then\n' +
  '      oModel.Columns.getByIndex(cl).Width = argN\n' +
  '    End If\n' +
  '  End If\n' +
  '  oDoc.CurrentController.select(oShape)\n' +
  'End Sub\n' +
  // Live tables (Impress): CELL FORMATTING of the selected slide table — set the
  // active cell(s) FILL color and the cell TEXT bold / size / align. Modeled on
  // WosShapeText / WosShapeColor but on presentation-table CELLS: a table cell IS a
  // shape-like object (FillStyle/FillColor) that also owns .Text (createTextCursor).
  // The active-cell resolution mirrors WosSlideTableOp: prefer the selected cell
  // range (RangeAddress → Start/End row/col); if none is reachable headless, fall
  // back to the WHOLE table so a Ribbon click still visibly formats something. The
  // frame table shape is resolved the same way (selection → first table on slide).
  // args = "prop|value": prop = fill (value = UNO long color; &lt;0 clears),
  //   bold (value = 1 on / 0 off), size (value = pt), align (left|center|right).
  // No-op (Exit Sub) when there is no table shape at all, so it never crashes.
  'Sub WosSlideTableCellFmt\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String, prop As String, sval As String\n' +
  '  parts = Split(args, "|")\n' +
  '  prop = parts(0)\n' +
  '  sval = ""\n' +
  '  If UBound(parts) &gt;= 1 Then sval = parts(1)\n' +
  '  Dim oDoc, oSel, oShape, oModel\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  // Resolve the target TABLE shape (selection is the frame or a cell range).
  '  oShape = Nothing\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If Not IsNull(oSel) Then\n' +
  '    If WosIsTableShape(oSel) Then\n' +
  '      oShape = oSel\n' +
  '    ElseIf oSel.supportsService("com.sun.star.drawing.XShapes") Then\n' +
  '      If oSel.Count = 1 Then\n' +
  '        If WosIsTableShape(oSel.getByIndex(0)) Then oShape = oSel.getByIndex(0)\n' +
  '      End If\n' +
  '    End If\n' +
  '  End If\n' +
  '  If IsNull(oShape) Then\n' +
  '    Dim oPage, j As Integer\n' +
  '    oPage = oDoc.CurrentController.CurrentPage\n' +
  '    If IsNull(oPage) Then oPage = oDoc.DrawPages.getByIndex(0)\n' +
  '    If Not IsNull(oPage) Then\n' +
  '      For j = 0 To oPage.Count - 1\n' +
  '        If WosIsTableShape(oPage.getByIndex(j)) Then\n' +
  '          oShape = oPage.getByIndex(j)\n' +
  '          Exit For\n' +
  '        End If\n' +
  '      Next j\n' +
  '    End If\n' +
  '  End If\n' +
  '  If IsNull(oShape) Then Exit Sub\n' +
  '  oModel = oShape.Model\n' +
  '  If IsNull(oModel) Then Exit Sub\n' +
  '  Dim nRows As Long, nCols As Long\n' +
  '  nRows = oModel.Rows.Count\n' +
  '  nCols = oModel.Columns.Count\n' +
  // Active-cell rectangle: default to the WHOLE table (fallback), narrow to the
  // selected cell range's Start/End row/col when a cell range is reachable.
  '  Dim r0 As Long, r1 As Long, c0 As Long, c1 As Long\n' +
  '  r0 = 0 : r1 = nRows - 1 : c0 = 0 : c1 = nCols - 1\n' +
  '  Dim oActive, oAddr\n' +
  '  oActive = Nothing\n' +
  '  If Not IsNull(oSel) Then\n' +
  '    If oSel.supportsService("com.sun.star.table.CellRange") Then oActive = oSel\n' +
  '  End If\n' +
  '  If IsNull(oActive) Then\n' +
  '    Dim oTry\n' +
  '    oTry = oDoc.CurrentController.getSelection()\n' +
  '    If Not IsNull(oTry) Then\n' +
  '      If oTry.supportsService("com.sun.star.table.CellRange") Then oActive = oTry\n' +
  '    End If\n' +
  '  End If\n' +
  '  If Not IsNull(oActive) Then\n' +
  '    oAddr = oActive.RangeAddress\n' +
  '    If Not IsNull(oAddr) Then\n' +
  '      If oAddr.StartRow &gt;= 0 And oAddr.EndRow &lt; nRows Then\n' +
  '        r0 = oAddr.StartRow : r1 = oAddr.EndRow\n' +
  '      End If\n' +
  '      If oAddr.StartColumn &gt;= 0 And oAddr.EndColumn &lt; nCols Then\n' +
  '        c0 = oAddr.StartColumn : c1 = oAddr.EndColumn\n' +
  '      End If\n' +
  '    End If\n' +
  '  End If\n' +
  '  Dim rr As Long, cc As Long, oCell, oText, oCur, col As Long, sz As Single\n' +
  '  For rr = r0 To r1\n' +
  '    For cc = c0 To c1\n' +
  '      oCell = oModel.getCellByPosition(cc, rr)\n' +
  '      If Not IsNull(oCell) Then\n' +
  '        If prop = "fill" Then\n' +
  '          col = CLng(sval)\n' +
  '          If col &lt; 0 Then\n' +
  '            oCell.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '          Else\n' +
  '            oCell.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '            oCell.FillColor = col\n' +
  '          End If\n' +
  '        Else\n' +
  '          oText = oCell.Text\n' +
  '          If Not IsNull(oText) Then\n' +
  '            oCur = oText.createTextCursor()\n' +
  '            oCur.gotoStart(False)\n' +
  '            oCur.gotoEnd(True)\n' +
  '            If prop = "bold" Then\n' +
  '              If sval = "1" Then\n' +
  '                oCur.CharWeight = com.sun.star.awt.FontWeight.BOLD\n' +
  '              Else\n' +
  '                oCur.CharWeight = com.sun.star.awt.FontWeight.NORMAL\n' +
  '              End If\n' +
  '            ElseIf prop = "size" Then\n' +
  '              sz = CSng(sval)\n' +
  '              If sz &gt; 0 Then oCur.CharHeight = sz\n' +
  '            ElseIf prop = "align" Then\n' +
  '              If sval = "center" Then\n' +
  '                oCur.ParaAdjust = com.sun.star.style.ParagraphAdjust.CENTER\n' +
  '              ElseIf sval = "right" Then\n' +
  '                oCur.ParaAdjust = com.sun.star.style.ParagraphAdjust.RIGHT\n' +
  '              Else\n' +
  '                oCur.ParaAdjust = com.sun.star.style.ParagraphAdjust.LEFT\n' +
  '              End If\n' +
  '            End If\n' +
  '          End If\n' +
  '        End If\n' +
  '      End If\n' +
  '    Next cc\n' +
  '  Next rr\n' +
  '  oDoc.CurrentController.select(oShape)\n' +
  'End Sub\n' +
  // Pen tool: insert a custom closed polygon from absolute points (1/100 mm).
  // args = "x1,y1;x2,y2;x3,y3;...".
  'Sub WosInsertPoly\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim pairs() As String, n As Integer, i As Integer, xy() As String\n' +
  '  pairs = Split(args, ";")\n' +
  '  n = UBound(pairs) + 1\n' +
  '  If n &lt; 3 Then Exit Sub\n' +
  '  Dim oDoc, oPage, oShape\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPage = WosTargetPage(oDoc)\n' +
  '  oShape = oDoc.createInstance("com.sun.star.drawing.PolyPolygonShape")\n' +
  '  oPage.add(oShape)\n' +
  '  oShape.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PAGE\n' +
  '  Dim pts(n - 1) As New com.sun.star.awt.Point\n' +
  '  For i = 0 To n - 1\n' +
  '    xy = Split(pairs(i), ",")\n' +
  '    pts(i).X = CLng(xy(0))\n' +
  '    pts(i).Y = CLng(xy(1))\n' +
  '  Next i\n' +
  '  Dim poly(0) As Variant\n' +
  '  poly(0) = pts()\n' +
  '  oShape.PolyPolygon = poly()\n' +
  '  oShape.FillStyle = com.sun.star.drawing.FillStyle.SOLID\n' +
  '  oShape.FillColor = RGB(91, 155, 213)\n' +
  '  oShape.LineStyle = com.sun.star.drawing.LineStyle.SOLID\n' +
  '  oShape.LineColor = RGB(31, 78, 121)\n' +
  '  oShape.LineWidth = 35\n' +
  '  oDoc.CurrentController.select(oShape)\n' +
  'End Sub\n' +
  // Find & Replace (Writer + Calc) via the model search API. The payload travels
  // via /tmp/wos-fr-in.txt (find/replace strings on their OWN lines, so a literal
  // '|' in the text can never collide with a delimiter): line 1 = "opMode|c|w|r"
  // (opMode = findnext|findprev|replaceall; c/w/r = case-sensitive/whole-word/
  // regex, each 0 or 1), line 2 = the find text, line 3 = the replace text.
  // For findnext/findprev the view selection is moved to the match so the user
  // sees it. For replaceall the number replaced is written to /tmp/wos-asset-out.txt
  // (the main process reads it back). Writer (TextDocument) uses the DOCUMENT-level
  // XReplaceable; Calc (SpreadsheetDocument) must replace PER SHEET because the
  // document-level replaceAll() no-ops on a spreadsheet (returns -1) — each sheet
  // is its own XReplaceable. Impress has no document-level search, so it returns
  // -1 (unsupported).
  // NB reserved-word hygiene: no var is named find/replace/search/cell/row/column/
  // sheet/name/type/alias/line/error/stop/string — using sFind/sRepl/opMode/oDesc/
  // oRepl/oFound/nCount/bCase/bWord/bRegex + Calc: oSheets/nIdx/oOneSheet/
  // oSheetRepl/nOne.
  'Sub WosFindReplace\n' +
  '  On Error Resume Next\n' +
  '  Dim f As Integer, ln1 As String, sFind As String, sRepl As String\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-fr-in.txt" For Input As #f\n' +
  '  Line Input #f, ln1\n' +
  '  sFind = ""\n' +
  '  sRepl = ""\n' +
  '  If Not EOF(f) Then Line Input #f, sFind\n' +
  '  If Not EOF(f) Then Line Input #f, sRepl\n' +
  '  Close #f\n' +
  '  Dim hp() As String, opMode As String, bCase As Boolean, bWord As Boolean, bRegex As Boolean\n' +
  '  hp = Split(ln1, "|")\n' +
  '  opMode = hp(0)\n' +
  '  bCase = False : bWord = False : bRegex = False\n' +
  '  If UBound(hp) &gt;= 1 Then bCase = (hp(1) = "1")\n' +
  '  If UBound(hp) &gt;= 2 Then bWord = (hp(2) = "1")\n' +
  '  If UBound(hp) &gt;= 3 Then bRegex = (hp(3) = "1")\n' +
  '  Dim nCount As Long\n' +
  '  nCount = -1\n' +
  '  Dim oDoc\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Len(sFind) = 0 Then\n' +
  '    WosFrOut(nCount)\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  '  Dim isText As Boolean, isCalc As Boolean\n' +
  '  isText = oDoc.supportsService("com.sun.star.text.TextDocument")\n' +
  '  isCalc = oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument")\n' +
  '  If Not (isText Or isCalc) Then\n' +
  '    WosFrOut(nCount)\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  // Kept tolerant (On Error Resume Next) above: the LOK engine raises benign
  // non-fatal warnings on the Calc controller that, under On Error Goto 0, abort
  // the whole sub — that is what previously made even findFirst silently no-op.
  // ROOT CAUSE of the replace no-op: the shipped macro always called the DOCUMENT-
  // level oDoc.replaceAll(). On a SpreadsheetDocument that returns -1 and changes
  // nothing (only Writer's body-level XReplaceable acts). Each Calc SHEET is itself
  // an XReplaceable, so we build a per-sheet ReplaceDescriptor and replaceAll on
  // each sheet, summing the real counts. Writer keeps the working document path.
  // A stale count can no longer fake success: the caller deletes the out-file
  // before running, so an abort yields a MISSING file -> count -1 (loud), not 1.
  '  If opMode = "replaceall" Then\n' +
  '    If isCalc Then\n' +
  '      Dim oSheets, nIdx As Integer, oOneSheet, oSheetRepl, nOne As Long\n' +
  '      oSheets = oDoc.Sheets\n' +
  '      nCount = 0\n' +
  '      For nIdx = 0 To oSheets.Count - 1\n' +
  '        oOneSheet = oSheets.getByIndex(nIdx)\n' +
  '        oSheetRepl = oOneSheet.createReplaceDescriptor()\n' +
  '        oSheetRepl.SearchString = sFind\n' +
  '        oSheetRepl.ReplaceString = sRepl\n' +
  '        oSheetRepl.SearchCaseSensitive = bCase\n' +
  '        oSheetRepl.SearchWords = bWord\n' +
  '        oSheetRepl.SearchRegularExpression = bRegex\n' +
  '        nOne = oOneSheet.replaceAll(oSheetRepl)\n' +
  '        If nOne &gt; 0 Then nCount = nCount + nOne\n' +
  '      Next nIdx\n' +
  '    Else\n' +
  '      Dim oRepl\n' +
  '      oRepl = oDoc.createReplaceDescriptor()\n' +
  '      oRepl.SearchString = sFind\n' +
  '      oRepl.ReplaceString = sRepl\n' +
  '      oRepl.SearchCaseSensitive = bCase\n' +
  '      oRepl.SearchWords = bWord\n' +
  '      oRepl.SearchRegularExpression = bRegex\n' +
  '      nCount = oDoc.replaceAll(oRepl)\n' +
  '    End If\n' +
  '  Else\n' +
  '    Dim oDesc, oFound, oStart\n' +
  '    oDesc = oDoc.createSearchDescriptor()\n' +
  '    oDesc.SearchString = sFind\n' +
  '    oDesc.SearchCaseSensitive = bCase\n' +
  '    oDesc.SearchWords = bWord\n' +
  '    oDesc.SearchRegularExpression = bRegex\n' +
  '    oDesc.SearchBackwards = (opMode = "findprev")\n' +
  // Continue from the current selection/cursor so Find Next steps forward.
  '    oStart = Nothing\n' +
  '    oStart = oDoc.CurrentController.getSelection()\n' +
  '    If IsNull(oStart) Then\n' +
  '      oFound = oDoc.findFirst(oDesc)\n' +
  '    Else\n' +
  '      oFound = oDoc.findNext(oStart, oDesc)\n' +
  '    End If\n' +
  '    If IsNull(oFound) Then oFound = oDoc.findFirst(oDesc)\n' +
  '    If Not IsNull(oFound) Then\n' +
  '      nCount = 1\n' +
  '      oDoc.CurrentController.select(oFound)\n' +
  '    Else\n' +
  '      nCount = 0\n' +
  '    End If\n' +
  '  End If\n' +
  '  WosFrOut(nCount)\n' +
  'End Sub\n' +
  // Helper: write the find/replace result count where the main process reads it.
  'Sub WosFrOut(nCount As Long)\n' +
  '  On Error Resume Next\n' +
  '  Dim df As Integer\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, nCount\n' +
  '  Close #df\n' +
  'End Sub\n' +
  // ---- Word Layout (Writer page-style model API) ----
  // Helper: resolve the page style the document actually uses. On a .docx the
  // body text usually sits on "Standard", but the converter can name it
  // "Converted1" etc.; we read the first paragraph's PageDescName, falling back
  // to "Standard". Returns the style object (or Nothing). NB reserved-word
  // hygiene: never name a var page/style/name/margin/header/footer/width/height/
  // line/cell/row/column/type/error/alias — using oPS/oStyles/sPsName/oEnum/oPar.
  'Function WosPageStyle(oDoc As Object) As Object\n' +
  '  On Error Resume Next\n' +
  '  WosPageStyle = Nothing\n' +
  '  Dim oStyles, sPsName As String, oEnum, oPar\n' +
  '  If oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then\n' +
  '    WosPageStyle = oDoc.StyleFamilies.getByName("PageStyles").getByName(oDoc.CurrentController.ActiveSheet.PageStyle)\n' +
  '    Exit Function\n' +
  '  End If\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Function\n' +
  '  oStyles = oDoc.StyleFamilies.getByName("PageStyles")\n' +
  '  sPsName = ""\n' +
  '  oEnum = oDoc.Text.createEnumeration()\n' +
  '  Do While oEnum.hasMoreElements()\n' +
  '    oPar = oEnum.nextElement()\n' +
  '    If oPar.supportsService("com.sun.star.text.Paragraph") Then\n' +
  '      If Not IsEmpty(oPar.PageDescName) Then\n' +
  '        If Not IsNull(oPar.PageDescName) Then\n' +
  '          If Len(oPar.PageDescName) &gt; 0 Then sPsName = oPar.PageDescName\n' +
  '        End If\n' +
  '      End If\n' +
  '      Exit Do\n' +
  '    End If\n' +
  '  Loop\n' +
  '  If Len(sPsName) &gt; 0 And oStyles.hasByName(sPsName) Then\n' +
  '    WosPageStyle = oStyles.getByName(sPsName)\n' +
  '  ElseIf oStyles.hasByName("Standard") Then\n' +
  '    WosPageStyle = oStyles.getByName("Standard")\n' +
  '  ElseIf oStyles.Count &gt; 0 Then\n' +
  '    WosPageStyle = oStyles.getByIndex(0)\n' +
  '  End If\n' +
  'End Function\n' +
  // Page margins: set the page style four margins (1/100 mm). args =
  // "which|value"; which = top|bottom|left|right|all. all sets every side.
  // Round-trips to <w:pgMar w:top/bottom/left/right> in the .docx sectPr.
  'Sub WosPageMargins\n' +
  '  On Error Resume Next\n' +
  '  Dim wosArgs As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, wosArgs\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(wosArgs, "|")\n' +
  '  If UBound(parts) &lt; 1 Then Exit Sub\n' +
  '  Dim sWhich As String, nVal As Long\n' +
  '  sWhich = parts(0)\n' +
  '  nVal = CLng(parts(1))\n' +
  '  If nVal &lt; 0 Then Exit Sub\n' +
  '  Dim oDoc, oPS\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPS = WosPageStyle(oDoc)\n' +
  '  If IsNull(oPS) Then Exit Sub\n' +
  '  If sWhich = "top" Or sWhich = "all" Then oPS.TopMargin = nVal\n' +
  '  If sWhich = "bottom" Or sWhich = "all" Then oPS.BottomMargin = nVal\n' +
  '  If sWhich = "left" Or sWhich = "all" Then oPS.LeftMargin = nVal\n' +
  '  If sWhich = "right" Or sWhich = "all" Then oPS.RightMargin = nVal\n' +
  'End Sub\n' +
  // Page orientation: portrait|landscape. Sets IsLandscape and swaps Width/Height
  // so the page truly reflows. Round-trips to <w:pgSz w:orient="landscape"> (with
  // swapped w:w/w:h) in the .docx sectPr.
  'Sub WosPageOrient\n' +
  '  On Error Resume Next\n' +
  '  Dim sMode As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, sMode\n' +
  '  Close #f\n' +
  '  Dim oDoc, oPS, bLand As Boolean, oNewSize As New com.sun.star.awt.Size\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPS = WosPageStyle(oDoc)\n' +
  '  If IsNull(oPS) Then Exit Sub\n' +
  '  bLand = (sMode = "landscape")\n' +
  '  Dim curW As Long, curH As Long\n' +
  '  curW = oPS.Width : curH = oPS.Height\n' +
  '  If bLand And curW &lt; curH Then\n' +
  '    oNewSize.Width = curH : oNewSize.Height = curW\n' +
  '    oPS.Size = oNewSize\n' +
  '  ElseIf (Not bLand) And curW &gt; curH Then\n' +
  '    oNewSize.Width = curH : oNewSize.Height = curW\n' +
  '    oPS.Size = oNewSize\n' +
  '  End If\n' +
  '  oPS.IsLandscape = bLand\n' +
  'End Sub\n' +
  // Header/footer: turn a header/footer on (with text) or off. args =
  // "which|mode|text"; which = header|footer|both; mode = on|off. When on, the
  // text is written into the running header/footer. Round-trips to word/header1.xml
  // / word/footer1.xml + a <w:headerReference>/<w:footerReference> in the sectPr.
  'Sub WosHeaderFooter\n' +
  '  On Error Resume Next\n' +
  '  Dim wosArgs As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, wosArgs\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(wosArgs, "|")\n' +
  '  If UBound(parts) &lt; 1 Then Exit Sub\n' +
  '  Dim sWhich As String, sMode As String, sTxt As String\n' +
  '  sWhich = parts(0)\n' +
  '  sMode = parts(1)\n' +
  '  sTxt = ""\n' +
  '  If UBound(parts) &gt;= 2 Then sTxt = parts(2)\n' +
  '  Dim bOn As Boolean\n' +
  '  bOn = (sMode = "on")\n' +
  '  Dim oDoc, oPS\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPS = WosPageStyle(oDoc)\n' +
  '  If IsNull(oPS) Then Exit Sub\n' +
  '  If sWhich = "header" Or sWhich = "both" Then\n' +
  '    oPS.HeaderIsOn = bOn\n' +
  '    If bOn Then\n' +
  '      oPS.HeaderIsShared = True\n' +
  '      Dim oHdrText\n' +
  '      oHdrText = oPS.HeaderText\n' +
  '      If Not IsNull(oHdrText) And Len(sTxt) &gt; 0 Then oHdrText.setString(sTxt)\n' +
  '    End If\n' +
  '  End If\n' +
  '  If sWhich = "footer" Or sWhich = "both" Then\n' +
  '    oPS.FooterIsOn = bOn\n' +
  '    If bOn Then\n' +
  '      oPS.FooterIsShared = True\n' +
  '      Dim oFtrText\n' +
  '      oFtrText = oPS.FooterText\n' +
  '      If Not IsNull(oFtrText) And Len(sTxt) &gt; 0 Then oFtrText.setString(sTxt)\n' +
  '    End If\n' +
  '  End If\n' +
  'End Sub\n' +
  // Page number: insert (or remove) a PageNumber text field in the header or
  // footer. args = "where"; where = header|footer|off. header/footer enables the
  // running region and appends a live page-number field; off clears both the
  // header and footer field text. Round-trips as a PAGE field in header/footer.
  'Sub WosPageNumber\n' +
  '  On Error Resume Next\n' +
  '  Dim sWhere As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, sWhere\n' +
  '  Close #f\n' +
  '  Dim oDoc, oPS\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oPS = WosPageStyle(oDoc)\n' +
  '  If IsNull(oPS) Then Exit Sub\n' +
  '  If sWhere = "off" Then\n' +
  '    If oPS.HeaderIsOn Then oPS.HeaderText.setString("")\n' +
  '    If oPS.FooterIsOn Then oPS.FooterText.setString("")\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  '  Dim oRegionText\n' +
  '  If sWhere = "header" Then\n' +
  '    oPS.HeaderIsOn = True\n' +
  '    oPS.HeaderIsShared = True\n' +
  '    oRegionText = oPS.HeaderText\n' +
  '  Else\n' +
  '    oPS.FooterIsOn = True\n' +
  '    oPS.FooterIsShared = True\n' +
  '    oRegionText = oPS.FooterText\n' +
  '  End If\n' +
  '  If IsNull(oRegionText) Then Exit Sub\n' +
  '  Dim oFld, oCur\n' +
  '  oFld = oDoc.createInstance("com.sun.star.text.TextField.PageNumber")\n' +
  '  oFld.NumberingType = com.sun.star.style.NumberingType.ARABIC\n' +
  '  oFld.SubType = com.sun.star.text.PageNumberType.CURRENT\n' +
  '  oCur = oRegionText.createTextCursor()\n' +
  '  oCur.gotoEnd(False)\n' +
  '  oRegionText.insertString(oCur, "Page ", False)\n' +
  '  oRegionText.insertTextContent(oCur, oFld, False)\n' +
  'End Sub\n' +
  // Impress: assign an auto-layout to the CURRENT slide. args = "<n>" where n is
  // a LibreOffice AUTOLAYOUT id (0=Title, 1=Title+Content, 3=Two Content,
  // 19=Title Only, 20=Blank). Setting the slide's .Layout property is the proven
  // model-API path — the .uno:AssignLayout?WhatLayout dispatch is unreliable in
  // the headless engine (the query-arg form is often dropped). Round-trips to the
  // slide's placeholder set in the saved .pptx.
  'Sub WosSetLayout\n' +
  '  On Error Resume Next\n' +
  '  Dim sArg As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, sArg\n' +
  '  Close #f\n' +
  '  Dim oDoc, oSlide, nLayout As Integer\n' +
  '  nLayout = CInt(Trim(sArg))\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If IsNull(oDoc) Then Exit Sub\n' +
  '  oSlide = oDoc.CurrentController.CurrentPage\n' +
  '  If IsNull(oSlide) Then Exit Sub\n' +
  '  oSlide.Layout = nLayout\n' +
  'End Sub\n' +
  '</script:module>\n'

// ── Module3: slide/sheet part management. Same 64 KB rule; same duplicated
// helper. The host tries Module1 → Module2 → Module3 by name.
export const BASIC_MODULE_3 =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">\n' +
  '<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module3" script:language="StarBasic">\n' +
  'Function WosActiveDoc As Object\n' +
  '  Dim sPath As String, f As Integer, oEnum, oComp\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-doc.txt" For Input As #f\n' +
  '  Line Input #f, sPath\n' +
  '  Close #f\n' +
  '  oEnum = StarDesktop.Components.createEnumeration()\n' +
  '  Do While oEnum.hasMoreElements()\n' +
  '    oComp = oEnum.nextElement()\n' +
  '    If Not IsNull(oComp) Then\n' +
  '      If ConvertFromURL(oComp.URL) = sPath Then\n' +
  '        WosActiveDoc = oComp\n' +
  '        Exit Function\n' +
  '      End If\n' +
  '    End If\n' +
  '  Loop\n' +
  '  WosActiveDoc = ThisComponent\n' +
  'End Function\n' +
  // WosSlideOp: rename|<index>|<name> · hide|<index> · show|<index> — acts on the
  // slide by INDEX (the thumbnail the user right-clicked), never "current".
  'Sub WosSlideOp\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String, op As String, idx As Long\n' +
  '  parts = Split(args, "|")\n' +
  '  op = parts(0)\n' +
  '  idx = CLng(parts(1))\n' +
  '  Dim oDoc, oPages, oSlide\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oPages = oDoc.DrawPages\n' +
  '  If idx &lt; 0 Or idx &gt;= oPages.Count Then Exit Sub\n' +
  '  oSlide = oPages.getByIndex(idx)\n' +
  '  If op = "rename" Then\n' +
  '    If UBound(parts) &gt;= 2 Then\n' +
  '      If Len(parts(2)) &gt; 0 Then oSlide.Name = parts(2)\n' +
  '    End If\n' +
  '  ElseIf op = "hide" Then\n' +
  '    oSlide.Visible = False\n' +
  '  ElseIf op = "show" Then\n' +
  '    oSlide.Visible = True\n' +
  '  End If\n' +
  'End Sub\n' +
  // WosPartInfo: one line "name|visible" per sheet (Calc) or slide (Impress),
  // written to /tmp/wos-asset-out.txt for the renderer's tab strip / slide rail.
  // WosFill: range|dir|count — fillAuto on the union of source + target, the
  // way Calc's own fill handle continues a series (dir = FillDirection enum).
  'Sub WosFill\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String\n' +
  '  parts = Split(args, "|")\n' +
  '  If UBound(parts) &lt; 2 Then Exit Sub\n' +
  '  Dim oDoc, oSheet, oRange\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  oSheet = oDoc.CurrentController.ActiveSheet\n' +
  '  oRange = oSheet.getCellRangeByName(parts(0))\n' +
  '  If IsNull(oRange) Then Exit Sub\n' +
  '  oRange.fillAuto(CLng(parts(1)), CLng(parts(2)))\n' +
  '  oDoc.CurrentController.select(oRange)\n' +
  'End Sub\n' +
  // WosDocStatus: Writer "page|pages|words|chars" for the status bar (the
  // engine's status-bar states have no listener in headless mode).
  'Sub WosDocStatus\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, df As Integer, out As String, oVC, pg As Long, pgs As Long, wc As Long, cc As Long\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  out = ""\n' +
  '  If oDoc.supportsService("com.sun.star.text.TextDocument") Then\n' +
  '    pg = 0 : pgs = 0 : wc = 0 : cc = 0\n' +
  '    oVC = oDoc.CurrentController.getViewCursor()\n' +
  '    pg = oVC.getPage()\n' +
  '    pgs = oDoc.CurrentController.PageCount\n' +
  '    wc = oDoc.WordCount\n' +
  '    cc = oDoc.CharacterCount\n' +
  '    out = pg &amp; "|" &amp; pgs &amp; "|" &amp; wc &amp; "|" &amp; cc\n' +
  '  End If\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, out\n' +
  '  Close #df\n' +
  'End Sub\n' +
  // WosNameBox <text>: Calc name box — an existing name selects its range, an
  // address selects it, anything else names the current selection.
  'Sub WosNameBox\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  args = Trim(args)\n' +
  '  If Len(args) = 0 Then Exit Sub\n' +
  '  Dim oDoc, oCtrl, oSheet, oRange, oNames\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  oCtrl = oDoc.CurrentController\n' +
  '  oSheet = oCtrl.ActiveSheet\n' +
  '  oNames = oDoc.NamedRanges\n' +
  '  Dim df As Integer, trail As String\n' +
  '  trail = ""\n' +
  '  If oNames.hasByName(args) Then\n' +
  '    trail = "name|" &amp; args\n' +
  '  Else\n' +
  '    oRange = Nothing\n' +
  '    oRange = oSheet.getCellRangeByName(args)\n' +
  '    If Not IsNull(oRange) Then trail = "range|" &amp; args\n' +
  '  End If\n' +
  '  If Len(trail) = 0 Then\n' +
  '  Dim oSel, sAddr As String\n' +
  '  oSel = oCtrl.getSelection()\n' +
  '  sAddr = ""\n' +
  '  If Not IsNull(oSel) Then sAddr = oSel.AbsoluteName\n' +
  '  trail = "define|" &amp; args &amp; "|" &amp; sAddr\n' +
  '  If Len(sAddr) &gt; 0 Then\n' +
  // addNewByName wants a CellAddress base (not the RangeAddress).
  '  Dim aBase As New com.sun.star.table.CellAddress\n' +
  '  aBase.Sheet = oSel.RangeAddress.Sheet\n' +
  '  aBase.Column = oSel.RangeAddress.StartColumn\n' +
  '  aBase.Row = oSel.RangeAddress.StartRow\n' +
  '  oNames.addNewByName(args, sAddr, aBase, 0)\n' +
  '  End If\n' +
  '  End If\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, trail\n' +
  '  Close #df\n' +
  'End Sub\n' +
  // WosShapeRotate <hundredths of a degree>: absolute rotation of the selected shape(s).
  'Sub WosShapeRotate\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim oDoc, oSel, i As Integer, ang As Long\n' +
  '  ang = CLng(args)\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  If IsNull(oSel) Then Exit Sub\n' +
  '  If oSel.supportsService("com.sun.star.drawing.ShapeCollection") Then\n' +
  '    For i = 0 To oSel.Count - 1\n' +
  '      oSel.getByIndex(i).RotateAngle = ang\n' +
  '    Next i\n' +
  '  Else\n' +
  '    oSel.RotateAngle = ang\n' +
  '  End If\n' +
  'End Sub\n' +
  'Sub WosPartInfo\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, df As Integer, i As Long, out As String, oColl, vis As Boolean\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  out = ""\n' +
  '  If oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then\n' +
  '    oColl = oDoc.Sheets\n' +
  '    For i = 0 To oColl.Count - 1\n' +
  '      vis = oColl.getByIndex(i).IsVisible\n' +
  '      out = out &amp; oColl.getByIndex(i).Name &amp; "|" &amp; IIf(vis, "1", "0") &amp; Chr(10)\n' +
  '    Next i\n' +
  '  ElseIf oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then\n' +
  '    oColl = oDoc.DrawPages\n' +
  '    For i = 0 To oColl.Count - 1\n' +
  '      vis = oColl.getByIndex(i).Visible\n' +
  '      out = out &amp; oColl.getByIndex(i).Name &amp; "|" &amp; IIf(vis, "1", "0") &amp; Chr(10)\n' +
  '    Next i\n' +
  '  End If\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, out\n' +
  '  Close #df\n' +
  'End Sub\n' +
  // ── B9: slide transitions and shape animations (model API).
  // WosTransition set|idx|type|subtype|durSecs|change|advanceSecs|all — the
  // SMIL TransitionType/Subtype pair the pptx exporter maps to PowerPoint's
  // transitions; always writes one 'idx|type|subtype|dur|change|advance' line per
  // slide. WosAnim add|presetId|nodeType|effectsXml · remove|i · clear ·
  // order|i:nt,… · timing|i|dur|delay · info — presets are cloned from the
  // engine's own effects.xml through the public AnimationsImport service (its
  // XAnimationNodeSupplier is invisible to Basic introspection, hence core
  // reflection), then rebuilt into LibreOffice's click / with / after tree the
  // way EffectSequenceHelper::implRebuild does. Numbers go in as typed doubles
  // (CreateUnoValue) because an integral Basic double lands in an Any as Integer,
  // which the exporter and slideshow ignore.
  'Function WosAnimIsNum(v) As Boolean\n' +
  '  Dim t As Integer\n' +
  '  t = VarType(v)\n' +
  '  WosAnimIsNum = (t = 2 Or t = 3 Or t = 4 Or t = 5)\n' +
  'End Function\n' +
  'Function WosAnimUd(oNode, sName As String)\n' +
  '  Dim ud, i\n' +
  '  WosAnimUd = Empty\n' +
  '  On Error Resume Next\n' +
  '  ud = oNode.UserData\n' +
  '  For i = LBound(ud) To UBound(ud)\n' +
  '    If ud(i).Name = sName Then WosAnimUd = ud(i).Value\n' +
  '  Next i\n' +
  'End Function\n' +
  'Sub WosAnimSetUd(oNode, sName As String, v)\n' +
  '  Dim ud, i, n As Long, found As Boolean, nu(), s\n' +
  '  On Error Resume Next\n' +
  '  n = -1\n' +
  '  ud = oNode.UserData\n' +
  '  n = UBound(ud)\n' +
  '  found = False\n' +
  '  ReDim nu(n + 1)\n' +
  '  For i = 0 To n\n' +
  '    s = CreateUnoStruct("com.sun.star.beans.NamedValue")\n' +
  '    s.Name = ud(i).Name\n' +
  '    s.Value = ud(i).Value\n' +
  '    If s.Name = sName Then\n' +
  '      s.Value = v\n' +
  '      found = True\n' +
  '    End If\n' +
  '    nu(i) = s\n' +
  '  Next i\n' +
  '  If found Then\n' +
  '    ReDim Preserve nu(n)\n' +
  '  Else\n' +
  '    s = CreateUnoStruct("com.sun.star.beans.NamedValue")\n' +
  '    s.Name = sName\n' +
  '    s.Value = v\n' +
  '    nu(n + 1) = s\n' +
  '  End If\n' +
  '  oNode.UserData = nu()\n' +
  'End Sub\n' +
  'Function WosAnimMain(oSlide) As Object\n' +
  '  Dim oRoot, e, oNode\n' +
  '  oRoot = oSlide.AnimationNode\n' +
  '  e = oRoot.createEnumeration()\n' +
  '  Do While e.hasMoreElements()\n' +
  '    oNode = e.nextElement()\n' +
  '    If WosAnimUd(oNode, "node-type") = 4 Then\n' +
  '      WosAnimMain = oNode\n' +
  '      Exit Function\n' +
  '    End If\n' +
  '  Loop\n' +
  '  oNode = CreateUnoService("com.sun.star.animations.SequenceTimeContainer")\n' +
  '  WosAnimSetUd(oNode, "node-type", CInt(4))\n' +
  '  oRoot.appendChild(oNode)\n' +
  '  WosAnimMain = oNode\n' +
  'End Function\n' +
  'Function WosAnimFlat(oMain) As Object\n' +
  '  Dim c As New Collection, e1, e2, e3, oC, oW, oE\n' +
  '  On Error Resume Next\n' +
  '  e1 = oMain.createEnumeration()\n' +
  '  Do While e1.hasMoreElements()\n' +
  '    oC = e1.nextElement()\n' +
  '    e2 = oC.createEnumeration()\n' +
  '    Do While e2.hasMoreElements()\n' +
  '      oW = e2.nextElement()\n' +
  '      e3 = oW.createEnumeration()\n' +
  '      Do While e3.hasMoreElements()\n' +
  '        oE = e3.nextElement()\n' +
  '        c.Add(oE)\n' +
  '      Loop\n' +
  '    Loop\n' +
  '  Loop\n' +
  '  WosAnimFlat = c\n' +
  'End Function\n' +
  'Function WosAnimDur(oE) As Double\n' +
  '  Dim e, oA, d As Double, t As Double\n' +
  '  d = 0\n' +
  '  On Error Resume Next\n' +
  '  If WosAnimIsNum(oE.Duration) Then d = oE.Duration\n' +
  '  If d &gt; 0 Then\n' +
  '    WosAnimDur = d\n' +
  '    Exit Function\n' +
  '  End If\n' +
  '  e = Empty\n' +
  '  e = oE.createEnumeration()\n' +
  '  If IsEmpty(e) Then Exit Function\n' +
  '  Do While e.hasMoreElements()\n' +
  '    oA = e.nextElement()\n' +
  '    t = 0\n' +
  '    If WosAnimIsNum(oA.Duration) Then t = oA.Duration\n' +
  '    If WosAnimIsNum(oA.Begin) Then t = t + oA.Begin\n' +
  '    If t &gt; d Then d = t\n' +
  '  Loop\n' +
  '  WosAnimDur = d\n' +
  'End Function\n' +
  'Function WosAnimNt(oE) As Integer\n' +
  '  Dim v\n' +
  '  v = WosAnimUd(oE, "node-type")\n' +
  '  If IsEmpty(v) Then\n' +
  '    WosAnimNt = 1\n' +
  '  Else\n' +
  '    WosAnimNt = CInt(v)\n' +
  '  End If\n' +
  'End Function\n' +
  'Sub WosAnimDetach(oMain)\n' +
  '  Dim e1, e2, e3, oC, oW, oE, cs As New Collection, ws As New Collection, es As New Collection, i\n' +
  '  On Error Resume Next\n' +
  '  e1 = oMain.createEnumeration()\n' +
  '  Do While e1.hasMoreElements()\n' +
  '    oC = e1.nextElement()\n' +
  '    cs.Add(oC)\n' +
  '    e2 = oC.createEnumeration()\n' +
  '    Do While e2.hasMoreElements()\n' +
  '      oW = e2.nextElement()\n' +
  '      ws.Add(oW)\n' +
  '      e3 = oW.createEnumeration()\n' +
  '      Do While e3.hasMoreElements()\n' +
  '        es.Add(e3.nextElement())\n' +
  '      Loop\n' +
  '      For i = 1 To es.Count\n' +
  '        oW.removeChild(es.Item(i))\n' +
  '      Next i\n' +
  '      Set es = New Collection\n' +
  '    Loop\n' +
  '    For i = 1 To ws.Count\n' +
  '      oC.removeChild(ws.Item(i))\n' +
  '    Next i\n' +
  '    Set ws = New Collection\n' +
  '  Loop\n' +
  '  For i = 1 To cs.Count\n' +
  '    oMain.removeChild(cs.Item(i))\n' +
  '  Next i\n' +
  'End Sub\n' +
  'Sub WosAnimRebuild(oMain, c)\n' +
  '  Dim i As Long, oE, nt As Integer, oClick, oWith, fBegin As Double, fDur As Double, t As Double, first As Boolean, aEv\n' +
  '  WosAnimDetach(oMain)\n' +
  '  first = True\n' +
  '  i = 1\n' +
  '  Do While i &lt;= c.Count\n' +
  '    oE = c.Item(i)\n' +
  '    nt = WosAnimNt(oE)\n' +
  '    oClick = CreateUnoService("com.sun.star.animations.ParallelTimeContainer")\n' +
  '    aEv = CreateUnoStruct("com.sun.star.animations.Event")\n' +
  '    aEv.Trigger = 9\n' +
  '    aEv.Repeat = 0\n' +
  '    If first And nt &lt;&gt; 1 Then\n' +
  '      oClick.Begin = CreateUnoValue("double", 0)\n' +
  '    Else\n' +
  '      oClick.Begin = aEv\n' +
  '    End If\n' +
  '    first = False\n' +
  '    oMain.appendChild(oClick)\n' +
  '    fBegin = 0\n' +
  '    Do\n' +
  '      oWith = CreateUnoService("com.sun.star.animations.ParallelTimeContainer")\n' +
  '      oWith.Begin = CreateUnoValue("double", fBegin)\n' +
  '      oClick.appendChild(oWith)\n' +
  '      fDur = 0\n' +
  '      Do\n' +
  '        oWith.appendChild(oE)\n' +
  '        t = WosAnimDur(oE)\n' +
  '        If t &gt; fDur Then fDur = t\n' +
  '        i = i + 1\n' +
  '        If i &gt; c.Count Then Exit Do\n' +
  '        oE = c.Item(i)\n' +
  '        nt = WosAnimNt(oE)\n' +
  '      Loop While nt = 2\n' +
  '      If i &gt; c.Count Then Exit Do\n' +
  '      fBegin = fBegin + fDur\n' +
  '    Loop While nt = 3\n' +
  '  Loop\n' +
  'End Sub\n' +
  'Function WosAnimFind(oNode, sId As String, depth As Integer) As Object\n' +
  '  Dim e, oC, r\n' +
  '  On Error Resume Next\n' +
  '  If WosAnimUd(oNode, "preset-id") = sId Then\n' +
  '    WosAnimFind = oNode\n' +
  '    Exit Function\n' +
  '  End If\n' +
  '  If depth &lt;= 0 Then Exit Function\n' +
  '  e = Empty\n' +
  '  e = oNode.createEnumeration()\n' +
  '  If IsEmpty(e) Then Exit Function\n' +
  '  Do While e.hasMoreElements()\n' +
  '    oC = e.nextElement()\n' +
  '    r = WosAnimFind(oC, sId, depth - 1)\n' +
  '    If Not IsEmpty(r) Then\n' +
  '      If Not IsNull(r) Then\n' +
  '        WosAnimFind = r\n' +
  '        Exit Function\n' +
  '      End If\n' +
  '    End If\n' +
  '  Loop\n' +
  'End Function\n' +
  'Function WosAnimPreset(sPath As String, sId As String) As Object\n' +
  '  Dim oImp, oSfa, aIn, oRoot, oP, u As String, oRefl, oM, aArgs()\n' +
  '  u = ConvertToURL(sPath)\n' +
  '  oSfa = CreateUnoService("com.sun.star.ucb.SimpleFileAccess")\n' +
  '  oImp = CreateUnoService("com.sun.star.comp.Xmloff.AnimationsImport")\n' +
  '  aIn = CreateUnoStruct("com.sun.star.xml.sax.InputSource")\n' +
  '  aIn.sSystemId = u\n' +
  '  aIn.aInputStream = oSfa.openFileRead(u)\n' +
  '  oImp.parseStream(aIn)\n' +
  '  \' The importer hides XAnimationNodeSupplier from Basic introspection;\n' +
  '  \' core reflection queries the interface directly.\n' +
  '  oRefl = CreateUnoService("com.sun.star.reflection.CoreReflection")\n' +
  '  oM = oRefl.forName("com.sun.star.animations.XAnimationNodeSupplier").getMethod("getAnimationNode")\n' +
  '  oRoot = oM.invoke(oImp, aArgs())\n' +
  '  oP = WosAnimFind(oRoot, sId, 4)\n' +
  '  If IsNull(oP) Or IsEmpty(oP) Then Exit Function\n' +
  '  WosAnimPreset = oP.createClone()\n' +
  'End Function\n' +
  'Sub WosAnimTarget(oE, oShape)\n' +
  '  Dim e, oA\n' +
  '  On Error Resume Next\n' +
  '  e = Empty\n' +
  '  e = oE.createEnumeration()\n' +
  '  If IsEmpty(e) Then Exit Sub\n' +
  '  Do While e.hasMoreElements()\n' +
  '    oA = e.nextElement()\n' +
  '    oA.Target = oShape\n' +
  '  Loop\n' +
  'End Sub\n' +
  'Function WosAnimShape(oE, oPage) As String\n' +
  '  Dim e, oA, oT, i\n' +
  '  WosAnimShape = ""\n' +
  '  On Error Resume Next\n' +
  '  e = Empty\n' +
  '  e = oE.createEnumeration()\n' +
  '  If IsEmpty(e) Then Exit Function\n' +
  '  If e.hasMoreElements() Then\n' +
  '    oA = e.nextElement()\n' +
  '    oT = oA.Target\n' +
  '    If Not IsNull(oT) Then\n' +
  '      WosAnimShape = oT.Name\n' +
  '      If Len(WosAnimShape) = 0 Then\n' +
  '        For i = 0 To oPage.Count - 1\n' +
  '          If EqualUnoObjects(oPage.getByIndex(i), oT) Then WosAnimShape = "Shape " &amp; (i + 1)\n' +
  '        Next i\n' +
  '      End If\n' +
  '    End If\n' +
  '  End If\n' +
  'End Function\n' +
  'Sub WosAnim\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String, op As String\n' +
  '  parts = Split(args, "|")\n' +
  '  op = parts(0)\n' +
  '  Dim oDoc, oCtrl, oSlide, oMain, c, oE, oSel, oShape, i As Long, out As String, df As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oCtrl = oDoc.CurrentController\n' +
  '  oSlide = oCtrl.CurrentPage\n' +
  '  oMain = WosAnimMain(oSlide)\n' +
  '  c = WosAnimFlat(oMain)\n' +
  '  If op = "add" Then\n' +
  '    oSel = oCtrl.Selection\n' +
  '    If IsNull(oSel) Then Exit Sub\n' +
  '    If oSel.supportsService("com.sun.star.drawing.ShapeCollection") Then\n' +
  '      oShape = oSel.getByIndex(0)\n' +
  '    Else\n' +
  '      oShape = oSel\n' +
  '    End If\n' +
  '    oE = WosAnimPreset(parts(3), parts(1))\n' +
  '    If IsNull(oE) Then Exit Sub\n' +
  '    WosAnimTarget(oE, oShape)\n' +
  '    WosAnimSetUd(oE, "node-type", CInt(parts(2)))\n' +
  '    c.Add(oE)\n' +
  '    WosAnimRebuild(oMain, c)\n' +
  '  ElseIf op = "remove" Then\n' +
  '    c.Remove(CLng(parts(1)) + 1)\n' +
  '    WosAnimRebuild(oMain, c)\n' +
  '  ElseIf op = "clear" Then\n' +
  '    Set c = New Collection\n' +
  '    WosAnimRebuild(oMain, c)\n' +
  '  ElseIf op = "order" Then\n' +
  '    Dim c2 As New Collection, items, j, kv\n' +
  '    items = Split(parts(1), ",")\n' +
  '    For j = 0 To UBound(items)\n' +
  '      kv = Split(items(j), ":")\n' +
  '      oE = c.Item(CLng(kv(0)) + 1)\n' +
  '      WosAnimSetUd(oE, "node-type", CInt(kv(1)))\n' +
  '      c2.Add(oE)\n' +
  '    Next j\n' +
  '    WosAnimRebuild(oMain, c2)\n' +
  '  ElseIf op = "timing" Then\n' +
  '    Dim old As Double, fac As Double, e, oA\n' +
  '    oE = c.Item(CLng(parts(1)) + 1)\n' +
  '    old = WosAnimDur(oE)\n' +
  '    If old &gt; 0 And Val(parts(2)) &gt; 0 Then\n' +
  '      fac = Val(parts(2)) / old\n' +
  '      If WosAnimIsNum(oE.Duration) Then oE.Duration = CreateUnoValue("double", oE.Duration * fac)\n' +
  '      e = oE.createEnumeration()\n' +
  '      Do While e.hasMoreElements()\n' +
  '        oA = e.nextElement()\n' +
  '        If WosAnimIsNum(oA.Duration) Then oA.Duration = CreateUnoValue("double", oA.Duration * fac)\n' +
  '        If WosAnimIsNum(oA.Begin) Then oA.Begin = CreateUnoValue("double", oA.Begin * fac)\n' +
  '      Loop\n' +
  '    End If\n' +
  '    oE.Begin = CreateUnoValue("double", Val(parts(3)))\n' +
  '    WosAnimRebuild(oMain, c)\n' +
  '  End If\n' +
  '  c = WosAnimFlat(oMain)\n' +
  '  out = ""\n' +
  '  For i = 1 To c.Count\n' +
  '    oE = c.Item(i)\n' +
  '    out = out &amp; (i - 1) &amp; "|" &amp; WosAnimShape(oE, oSlide) &amp; "|" &amp; WosAnimUd(oE, "preset-id") &amp; "|" &amp; WosAnimUd(oE, "preset-class") &amp; "|" &amp; WosAnimNt(oE) &amp; "|" &amp; Format(WosAnimDur(oE), "0.00") &amp; "|"\n' +
  '    If WosAnimIsNum(oE.Begin) Then out = out &amp; Format(oE.Begin, "0.00") Else out = out &amp; "0.00"\n' +
  '    out = out &amp; Chr(10)\n' +
  '  Next i\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, out\n' +
  '  Close #df\n' +
  'End Sub\n' +
  'Sub WosTransition\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  Dim parts() As String, oDoc, oPages, oS, i As Long, lo As Long, hi As Long, out As String, df As Integer\n' +
  '  parts = Split(args, "|")\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oPages = oDoc.DrawPages\n' +
  '  If parts(0) = "set" Then\n' +
  '    lo = CLng(parts(1))\n' +
  '    hi = lo\n' +
  '    If UBound(parts) &gt;= 7 Then\n' +
  '      If parts(7) = "1" Then\n' +
  '        lo = 0\n' +
  '        hi = oPages.Count - 1\n' +
  '      End If\n' +
  '    End If\n' +
  '    For i = lo To hi\n' +
  '      oS = oPages.getByIndex(i)\n' +
  '      oS.TransitionType = CInt(parts(2))\n' +
  '      oS.TransitionSubtype = CInt(parts(3))\n' +
  '      oS.TransitionDuration = CDbl(Val(parts(4)))\n' +
  '      oS.Change = CInt(parts(5))\n' +
  '      oS.Duration = CLng(Val(parts(6)))\n' +
  '      oS.HighResDuration = CDbl(Val(parts(6)))\n' +
  '    Next i\n' +
  '  End If\n' +
  '  out = ""\n' +
  '  For i = 0 To oPages.Count - 1\n' +
  '    oS = oPages.getByIndex(i)\n' +
  '    out = out &amp; i &amp; "|" &amp; oS.TransitionType &amp; "|" &amp; oS.TransitionSubtype &amp; "|" &amp; Format(oS.TransitionDuration, "0.00") &amp; "|" &amp; oS.Change &amp; "|" &amp; oS.Duration &amp; Chr(10)\n' +
  '  Next i\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, out\n' +
  '  Close #df\n' +
  'End Sub\n' +
  // ── B6c/B8: outline groups, sibling shape rects, Writer table geometry,
  // slide title/body text, ruler geometry and paragraph indents/tabs. Read-only
  // ops write one line per item to the asset-out file. Placeholder shapes are
  // matched by ShapeType: supportsService() does not report the presentation
  // services on them. A full-width Writer table spans the page text area (its
  // Width property is not in a document unit).
  'Function WosReadArgs() As String\n' +
  '  Dim a As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, a\n' +
  '  Close #f\n' +
  '  WosReadArgs = a\n' +
  'End Function\n' +
  'Sub WosWriteOut(s As String)\n' +
  '  Dim df As Integer\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, s\n' +
  '  Close #df\n' +
  'End Sub\n' +
  'Sub WosOutline\n' +
  '  On Error Resume Next\n' +
  '  Dim parts() As String, oDoc, oSheet, aRng, orient As Integer, op As String, oCur\n' +
  '  parts = Split(WosReadArgs(), "|")\n' +
  '  op = parts(0)\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  oSheet = oDoc.CurrentController.ActiveSheet\n' +
  '  aRng = CreateUnoStruct("com.sun.star.table.CellRangeAddress")\n' +
  '  aRng.Sheet = oSheet.RangeAddress.Sheet\n' +
  '  If op = "auto" Then\n' +
  '    oCur = oSheet.createCursor()\n' +
  '    oCur.gotoEndOfUsedArea(True)\n' +
  '    oSheet.autoOutline(oCur.RangeAddress)\n' +
  '    Exit Sub\n' +
  '  ElseIf op = "clear" Then\n' +
  '    oSheet.clearOutline()\n' +
  '    Exit Sub\n' +
  '  End If\n' +
  '  If UBound(parts) &lt; 3 Then Exit Sub\n' +
  '  If parts(1) = "row" Then\n' +
  '    orient = com.sun.star.table.TableOrientation.ROWS\n' +
  '    aRng.StartRow = CLng(parts(2))\n' +
  '    aRng.EndRow = CLng(parts(3))\n' +
  '    aRng.StartColumn = 0\n' +
  '    aRng.EndColumn = 0\n' +
  '  Else\n' +
  '    orient = com.sun.star.table.TableOrientation.COLUMNS\n' +
  '    aRng.StartColumn = CLng(parts(2))\n' +
  '    aRng.EndColumn = CLng(parts(3))\n' +
  '    aRng.StartRow = 0\n' +
  '    aRng.EndRow = 0\n' +
  '  End If\n' +
  '  If op = "group" Then\n' +
  '    oSheet.group(aRng, orient)\n' +
  '  ElseIf op = "ungroup" Then\n' +
  '    oSheet.ungroup(aRng, orient)\n' +
  '  ElseIf op = "hide" Then\n' +
  '    oSheet.hideDetail(aRng)\n' +
  '  ElseIf op = "show" Then\n' +
  '    oSheet.showDetail(aRng)\n' +
  '  End If\n' +
  'End Sub\n' +
  'Sub WosShapeRects\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oPage, oSel, oS, i As Long, j As Long, out As String, sel As Integer\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then\n' +
  '    oPage = oDoc.CurrentController.CurrentPage\n' +
  '  ElseIf oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then\n' +
  '    oPage = oDoc.CurrentController.ActiveSheet.DrawPage\n' +
  '  Else\n' +
  '    oPage = oDoc.DrawPage\n' +
  '  End If\n' +
  '  oSel = oDoc.CurrentController.Selection\n' +
  '  out = ""\n' +
  '  For i = 0 To oPage.Count - 1\n' +
  '    oS = oPage.getByIndex(i)\n' +
  '    sel = 0\n' +
  '    If Not IsNull(oSel) Then\n' +
  '      If oSel.supportsService("com.sun.star.drawing.ShapeCollection") Then\n' +
  '        For j = 0 To oSel.Count - 1\n' +
  '          If EqualUnoObjects(oSel.getByIndex(j), oS) Then sel = 1\n' +
  '        Next j\n' +
  '      End If\n' +
  '    End If\n' +
  '    out = out &amp; i &amp; "|" &amp; oS.Position.X &amp; "|" &amp; oS.Position.Y &amp; "|" &amp; oS.Size.Width &amp; "|" &amp; oS.Size.Height &amp; "|" &amp; sel &amp; Chr(10)\n' +
  '  Next i\n' +
  '  WosWriteOut(out)\n' +
  'End Sub\n' +
  'Function WosCellPos(nm As String, ByRef rw As Long, ByRef cl As Long)\n' +
  '  Dim i As Integer, j As Integer, colS As String\n' +
  '  i = 1\n' +
  '  Do While i &lt;= Len(nm) And Not (Mid(nm, i, 1) &gt;= "0" And Mid(nm, i, 1) &lt;= "9")\n' +
  '    i = i + 1\n' +
  '  Loop\n' +
  '  colS = Left(nm, i - 1)\n' +
  '  rw = CLng(Mid(nm, i)) - 1\n' +
  '  cl = 0\n' +
  '  For j = 1 To Len(colS)\n' +
  '    cl = cl * 26 + (Asc(Mid(colS, j, 1)) - 64)\n' +
  '  Next j\n' +
  '  cl = cl - 1\n' +
  'End Function\n' +
  'Sub WosTableGeom\n' +
  '  On Error Resume Next\n' +
  '  Dim parts() As String, op As String, idx As Long, v As Long, oDoc, oCtrl, oVC, oTable, out As String\n' +
  '  parts = Split(WosReadArgs(), "|")\n' +
  '  op = parts(0)\n' +
  '  If UBound(parts) &gt;= 1 Then idx = CLng(parts(1))\n' +
  '  If UBound(parts) &gt;= 2 Then v = CLng(parts(2))\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oCtrl = oDoc.CurrentController\n' +
  '  oVC = oCtrl.ViewCursor\n' +
  '  oTable = oVC.TextTable\n' +
  '  If IsNull(oTable) Then Exit Sub\n' +
  '  Dim nRows As Long, nCols As Long, seps, relSum As Double, total As Double, k As Long, w() As Double, prev As Double, cum As Double, oPS\n' +
  '  nRows = oTable.Rows.Count\n' +
  '  nCols = oTable.Columns.Count\n' +
  '  oPS = WosPageStyle(oDoc)\n' +
  '  \' A full-width table (HoriOrient FULL, the default) spans the text area; the\n' +
  '  \' Width property of such a table is not in any document unit.\n' +
  '  total = oPS.Width - oPS.LeftMargin - oPS.RightMargin\n' +
  '  If oTable.HoriOrient &lt;&gt; 6 And oTable.Width &gt; 0 And oTable.Width &lt; total Then total = oTable.Width\n' +
  '  If op = "rowheight" Then\n' +
  '    If idx &gt;= 0 And idx &lt; nRows Then\n' +
  '      oTable.Rows.getByIndex(idx).IsAutoHeight = False\n' +
  '      oTable.Rows.getByIndex(idx).Height = v\n' +
  '    End If\n' +
  '  ElseIf op = "colwidth" Then\n' +
  '    seps = oTable.TableColumnSeparators\n' +
  '    relSum = oTable.TableColumnRelativeSum\n' +
  '    ReDim w(nCols - 1)\n' +
  '    prev = 0\n' +
  '    For k = 0 To nCols - 1\n' +
  '      If k &lt; nCols - 1 Then\n' +
  '        w(k) = (seps(k).Position - prev) * total / relSum\n' +
  '        prev = seps(k).Position\n' +
  '      Else\n' +
  '        w(k) = (relSum - prev) * total / relSum\n' +
  '      End If\n' +
  '    Next k\n' +
  '    If idx &gt;= 0 And idx &lt; nCols - 1 Then\n' +
  '      Dim d As Double\n' +
  '      d = v - w(idx)\n' +
  '      If w(idx + 1) - d &gt; 300 And v &gt; 300 Then\n' +
  '        w(idx) = v\n' +
  '        w(idx + 1) = w(idx + 1) - d\n' +
  '      End If\n' +
  '      cum = 0\n' +
  '      For k = 0 To nCols - 2\n' +
  '        cum = cum + w(k)\n' +
  '        seps(k).Position = CLng(cum * relSum / total)\n' +
  '      Next k\n' +
  '      oTable.TableColumnSeparators = seps()\n' +
  '    End If\n' +
  '  End If\n' +
  '  seps = oTable.TableColumnSeparators\n' +
  '  relSum = oTable.TableColumnRelativeSum\n' +
  '  out = "cols|"\n' +
  '  prev = 0\n' +
  '  For k = 0 To nCols - 1\n' +
  '    If k &lt; nCols - 1 Then\n' +
  '      out = out &amp; CLng((seps(k).Position - prev) * total / relSum) &amp; ","\n' +
  '      prev = seps(k).Position\n' +
  '    Else\n' +
  '      out = out &amp; CLng((relSum - prev) * total / relSum)\n' +
  '    End If\n' +
  '  Next k\n' +
  '  out = out &amp; Chr(10) &amp; "rows|"\n' +
  '  For k = 0 To nRows - 1\n' +
  '    out = out &amp; oTable.Rows.getByIndex(k).Height &amp; ","\n' +
  '  Next k\n' +
  '  WosWriteOut(out)\n' +
  'End Sub\n' +
  'Sub WosSlideText\n' +
  '  On Error Resume Next\n' +
  '  Dim parts() As String, op As String, oDoc, oPages, oSlide, i As Long, j As Long, oS, t As String, b As String, out As String, idx As Long\n' +
  '  parts = Split(WosReadArgs(), "|")\n' +
  '  op = parts(0)\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.presentation.PresentationDocument") Then Exit Sub\n' +
  '  oPages = oDoc.DrawPages\n' +
  '  If op = "set" Then\n' +
  '    idx = CLng(parts(1))\n' +
  '    If idx &lt; 0 Or idx &gt;= oPages.Count Then Exit Sub\n' +
  '    oSlide = oPages.getByIndex(idx)\n' +
  '    Dim oT, oB\n' +
  '    oT = Nothing\n' +
  '    oB = Nothing\n' +
  '    For j = 0 To oSlide.Count - 1\n' +
  '      oS = oSlide.getByIndex(j)\n' +
  '      If oS.ShapeType = "com.sun.star.presentation.TitleTextShape" Then\n' +
  '        If IsNull(oT) Then oT = oS\n' +
  '      ElseIf oS.ShapeType = "com.sun.star.presentation.OutlinerShape" Or oS.ShapeType = "com.sun.star.presentation.SubtitleShape" Then\n' +
  '        If IsNull(oB) Then oB = oS\n' +
  '      End If\n' +
  '    Next j\n' +
  '    If Not IsNull(oT) Then oT.String = parts(2)\n' +
  '    If UBound(parts) &gt;= 3 Then\n' +
  '      If Not IsNull(oB) Then oB.String = Join(Split(parts(3), Chr(9)), Chr(10))\n' +
  '    End If\n' +
  '  End If\n' +
  '  out = ""\n' +
  '  For i = 0 To oPages.Count - 1\n' +
  '    oSlide = oPages.getByIndex(i)\n' +
  '    t = ""\n' +
  '    b = ""\n' +
  '    For j = 0 To oSlide.Count - 1\n' +
  '      oS = oSlide.getByIndex(j)\n' +
  '      If oS.ShapeType = "com.sun.star.presentation.TitleTextShape" Then\n' +
  '        If Len(t) = 0 Then t = oS.String\n' +
  '      ElseIf oS.ShapeType = "com.sun.star.presentation.OutlinerShape" Or oS.ShapeType = "com.sun.star.presentation.SubtitleShape" Then\n' +
  '        If Len(b) = 0 Then b = oS.String\n' +
  '      End If\n' +
  '    Next j\n' +
  '    t = Join(Split(t, Chr(13)), " ")\n' +
  '    t = Join(Split(t, Chr(10)), " ")\n' +
  '    b = Join(Split(b, Chr(13)), Chr(9))\n' +
  '    b = Join(Split(b, Chr(10)), Chr(9))\n' +
  '    t = Join(Split(t, "|"), "/")\n' +
  '    b = Join(Split(b, "|"), "/")\n' +
  '    out = out &amp; i &amp; "|" &amp; t &amp; "|" &amp; b &amp; Chr(10)\n' +
  '  Next i\n' +
  '  WosWriteOut(out)\n' +
  'End Sub\n' +
  'Sub WosRulerInfo\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oPS, oVC, out As String, tabs, k As Long, ts As String\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oPS = WosPageStyle(oDoc)\n' +
  '  oVC = oDoc.CurrentController.ViewCursor\n' +
  '  ts = ""\n' +
  '  tabs = oVC.ParaTabStops\n' +
  '  For k = LBound(tabs) To UBound(tabs)\n' +
  '    If Len(ts) &gt; 0 Then ts = ts &amp; ","\n' +
  '    ts = ts &amp; tabs(k).Position\n' +
  '  Next k\n' +
  '  out = oPS.Width &amp; "|" &amp; oPS.LeftMargin &amp; "|" &amp; oPS.RightMargin &amp; "|" &amp; oVC.ParaLeftMargin &amp; "|" &amp; oVC.ParaRightMargin &amp; "|" &amp; oVC.ParaFirstLineIndent &amp; "|" &amp; ts\n' +
  '  WosWriteOut(out)\n' +
  'End Sub\n' +
  'Sub WosParaFmt\n' +
  '  On Error Resume Next\n' +
  '  Dim parts() As String, oDoc, oVC, k As Long, items, n As Long\n' +
  '  parts = Split(WosReadArgs(), "|")\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oVC = oDoc.CurrentController.ViewCursor\n' +
  '  If parts(0) = "indent" Then\n' +
  '    If CLng(parts(1)) &gt;= 0 Then oVC.ParaLeftMargin = CLng(parts(1))\n' +
  '    If CLng(parts(2)) &gt;= 0 Then oVC.ParaRightMargin = CLng(parts(2))\n' +
  '    If parts(3) &lt;&gt; "" Then oVC.ParaFirstLineIndent = CLng(parts(3))\n' +
  '  ElseIf parts(0) = "tabs" Then\n' +
  '    items = Split(parts(1), ",")\n' +
  '    n = -1\n' +
  '    If Len(parts(1)) &gt; 0 Then n = UBound(items)\n' +
  '    Dim tabs()\n' +
  '    ReDim tabs(n)\n' +
  '    For k = 0 To n\n' +
  '      tabs(k) = CreateUnoStruct("com.sun.star.style.TabStop")\n' +
  '      tabs(k).Position = CLng(items(k))\n' +
  '      tabs(k).Alignment = com.sun.star.style.TabAlign.LEFT\n' +
  '      tabs(k).DecimalChar = "."\n' +
  '      tabs(k).FillChar = " "\n' +
  '    Next k\n' +
  '    oVC.ParaTabStops = tabs()\n' +
  '  End If\n' +
  'End Sub\n' +
  // ── B10: one-click table of contents from the outline + update all indexes.
  'Sub WosInsertToc\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oVC, oIdx\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oVC = oDoc.CurrentController.ViewCursor\n' +
  '  oIdx = oDoc.createInstance("com.sun.star.text.ContentIndex")\n' +
  '  oIdx.CreateFromOutline = True\n' +
  '  oIdx.Title = "Table of Contents"\n' +
  '  oDoc.Text.insertTextContent(oVC, oIdx, False)\n' +
  '  oIdx.update()\n' +
  'End Sub\n' +
  'Sub WosUpdateIndexes\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oIdxs, i As Long\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oIdxs = oDoc.DocumentIndexes\n' +
  '  For i = 0 To oIdxs.Count - 1\n' +
  '    oIdxs.getByIndex(i).update()\n' +
  '  Next i\n' +
  'End Sub\n' +
  // WosWatermark <text>: a rotated grey text shape in the page header (the
  // engine's .uno:Watermark opens its dialog whatever arguments it gets); an
  // empty text removes it. Exports as header text in .docx.
  'Sub WosWatermark\n' +
  '  On Error Resume Next\n' +
  '  Dim sText As String, f As Integer\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, sText\n' +
  '  Close #f\n' +
  '  sText = Trim(sText)\n' +
  '  Dim oDoc, oPS, oPage, oS, i As Long, oHT, oCur, oShape, aSize\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.text.TextDocument") Then Exit Sub\n' +
  '  oPage = oDoc.DrawPage\n' +
  '  For i = oPage.Count - 1 To 0 Step -1\n' +
  '    oS = oPage.getByIndex(i)\n' +
  '    If oS.Name = "WosWatermark" Then oPage.remove(oS)\n' +
  '  Next i\n' +
  '  If Len(sText) = 0 Then Exit Sub\n' +
  '  oPS = WosPageStyle(oDoc)\n' +
  '  If IsNull(oPS) Then Exit Sub\n' +
  '  oPS.HeaderIsOn = True\n' +
  '  oHT = oPS.HeaderText\n' +
  '  oShape = oDoc.createInstance("com.sun.star.drawing.TextShape")\n' +
  '  aSize = CreateUnoStruct("com.sun.star.awt.Size")\n' +
  '  aSize.Width = 14000\n' +
  '  aSize.Height = 3000\n' +
  '  oShape.Size = aSize\n' +
  '  oCur = oHT.createTextCursor()\n' +
  '  oHT.insertTextContent(oCur, oShape, False)\n' +
  '  oShape.Name = "WosWatermark"\n' +
  '  oShape.String = sText\n' +
  '  oShape.CharHeight = 72\n' +
  '  oShape.CharColor = 12632256\n' +
  '  oShape.FillStyle = com.sun.star.drawing.FillStyle.NONE\n' +
  '  oShape.LineStyle = com.sun.star.drawing.LineStyle.NONE\n' +
  '  oShape.TextAutoGrowWidth = True\n' +
  '  oShape.TextAutoGrowHeight = True\n' +
  '  oShape.AnchorType = com.sun.star.text.TextContentAnchorType.AT_PARAGRAPH\n' +
  '  oShape.HoriOrient = com.sun.star.text.HoriOrientation.CENTER\n' +
  '  oShape.HoriOrientRelation = com.sun.star.text.RelOrientation.PAGE_FRAME\n' +
  '  oShape.VertOrient = com.sun.star.text.VertOrientation.CENTER\n' +
  '  oShape.VertOrientRelation = com.sun.star.text.RelOrientation.PAGE_FRAME\n' +
  '  oShape.Opaque = False\n' +
  '  oShape.RotateAngle = 4500\n' +
  'End Sub\n' +
  // WosViewInfo: Calc view toggles the engine sends no STATE_CHANGED for.
  'Sub WosViewInfo\n' +
  '  On Error Resume Next\n' +
  '  Dim oDoc, oCtrl, out As String, df As Integer, b As Boolean\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  out = ""\n' +
  '  If oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then\n' +
  '    oCtrl = oDoc.CurrentController\n' +
  '    out = "formulas|" &amp; IIf(oCtrl.ShowFormulas, 1, 0) &amp; Chr(10)\n' +
  '    out = out &amp; "valuehl|" &amp; IIf(oCtrl.IsValueHighlightingEnabled, 1, 0) &amp; Chr(10)\n' +
  '    out = out &amp; "grid|" &amp; IIf(oCtrl.ShowGrid, 1, 0) &amp; Chr(10)\n' +
  '    out = out &amp; "headers|" &amp; IIf(oCtrl.HasColumnRowHeaders, 1, 0) &amp; Chr(10)\n' +
  '    b = True\n' +
  '    b = oDoc.isAutomaticCalculationEnabled()\n' +
  '    out = out &amp; "autocalc|" &amp; IIf(b, 1, 0) &amp; Chr(10)\n' +
  '  End If\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, out\n' +
  '  Close #df\n' +
  'End Sub\n' +
  // WosSort info|<sel> · sort|<sel>|<asc>|<expand>: Excel's "expand the selection" —
  // the contiguous data block around the picked column (collapseToCurrentRegion),
  // header detected as text-over-number, sorted by the picked column via XSortable.
  'Function WosSortRegion(oSheet, sSel As String) As Object\n' +
  '  Dim oSel, oCur, oCell, oQ, oRanges, k As Long, c As Long, r As Long\n' +
  '  oSel = oSheet.getCellRangeByName(sSel)\n' +
  '  c = oSel.RangeAddress.StartColumn\n' +
  '  r = oSel.RangeAddress.StartRow\n' +
  '  oCell = oSheet.getCellByPosition(c, r)\n' +
  '  If oCell.Type = com.sun.star.table.CellContentType.EMPTY Then\n' +
  '    \' A whole-column pick: start from the column\'s first filled cell.\n' +
  '    oQ = oSheet.getCellRangeByPosition(c, 0, c, 1048575).queryContentCells(1 + 2 + 4 + 16)\n' +
  '    oRanges = oQ.RangeAddresses\n' +
  '    If UBound(oRanges) &lt; 0 Then\n' +
  '      WosSortRegion = Nothing\n' +
  '      Exit Function\n' +
  '    End If\n' +
  '    r = oRanges(0).StartRow\n' +
  '    oCell = oSheet.getCellByPosition(c, r)\n' +
  '  End If\n' +
  '  oCur = oSheet.createCursorByRange(oCell)\n' +
  '  oCur.collapseToCurrentRegion()\n' +
  '  WosSortRegion = oCur\n' +
  'End Function\n' +
  'Sub WosSort\n' +
  '  On Error Resume Next\n' +
  '  Dim args As String, f As Integer, parts() As String, op As String, sSel As String\n' +
  '  f = FreeFile\n' +
  '  Open "/tmp/wos-macro-generic.txt" For Input As #f\n' +
  '  Line Input #f, args\n' +
  '  Close #f\n' +
  '  parts = Split(args, "|")\n' +
  '  op = parts(0)\n' +
  '  sSel = parts(1)\n' +
  '  Dim oDoc, oSheet, oSel, oReg, out As String, df As Integer, hdr As Integer, oTop, oNext\n' +
  '  oDoc = WosActiveDoc()\n' +
  '  If Not oDoc.supportsService("com.sun.star.sheet.SpreadsheetDocument") Then Exit Sub\n' +
  '  oSheet = oDoc.CurrentController.ActiveSheet\n' +
  '  oSel = oSheet.getCellRangeByName(sSel)\n' +
  '  oReg = WosSortRegion(oSheet, sSel)\n' +
  '  out = ""\n' +
  '  If Not IsNull(oReg) Then\n' +
  '    hdr = 0\n' +
  '    oTop = oSheet.getCellByPosition(oSel.RangeAddress.StartColumn, oReg.RangeAddress.StartRow)\n' +
  '    If oReg.RangeAddress.EndRow &gt; oReg.RangeAddress.StartRow Then\n' +
  '      oNext = oSheet.getCellByPosition(oSel.RangeAddress.StartColumn, oReg.RangeAddress.StartRow + 1)\n' +
  '      If oTop.Type = com.sun.star.table.CellContentType.TEXT And oNext.Type &lt;&gt; com.sun.star.table.CellContentType.TEXT Then hdr = 1\n' +
  '    End If\n' +
  '    out = oSel.AbsoluteName &amp; "|" &amp; oReg.AbsoluteName &amp; "|" &amp; hdr\n' +
  '  End If\n' +
  '  If op = "sort" Then\n' +
  '    \' sort|&lt;selection&gt;|&lt;asc 1/0&gt;|&lt;expand 1/0&gt;\n' +
  '    Dim oTarget, oDesc, aFields(0), nField As Long, asc As Boolean, useHdr As Boolean, i As Long\n' +
  '    asc = (parts(2) = "1")\n' +
  '    If parts(3) = "1" And Not IsNull(oReg) Then\n' +
  '      oTarget = oSheet.getCellRangeByPosition(oReg.RangeAddress.StartColumn, oReg.RangeAddress.StartRow, oReg.RangeAddress.EndColumn, oReg.RangeAddress.EndRow)\n' +
  '      nField = oSel.RangeAddress.StartColumn - oReg.RangeAddress.StartColumn\n' +
  '      useHdr = (hdr = 1)\n' +
  '    Else\n' +
  '      If Not IsNull(oReg) Then\n' +
  '        \' The picked column only, clipped to the data it holds.\n' +
  '        oTarget = oSheet.getCellRangeByPosition(oSel.RangeAddress.StartColumn, oReg.RangeAddress.StartRow, oSel.RangeAddress.EndColumn, oReg.RangeAddress.EndRow)\n' +
  '      Else\n' +
  '        oTarget = oSel\n' +
  '      End If\n' +
  '      nField = 0\n' +
  '      useHdr = (hdr = 1)\n' +
  '    End If\n' +
  '    oDesc = oTarget.createSortDescriptor()\n' +
  '    aFields(0) = CreateUnoStruct("com.sun.star.table.TableSortField")\n' +
  '    aFields(0).Field = nField\n' +
  '    aFields(0).IsAscending = asc\n' +
  '    For i = LBound(oDesc) To UBound(oDesc)\n' +
  '      If oDesc(i).Name = "SortFields" Then oDesc(i).Value = aFields()\n' +
  '      If oDesc(i).Name = "ContainsHeader" Then oDesc(i).Value = useHdr\n' +
  '      If oDesc(i).Name = "IsSortColumns" Then oDesc(i).Value = False\n' +
  '    Next i\n' +
  '    oTarget.sort(oDesc())\n' +
  '    oDoc.CurrentController.select(oTarget)\n' +
  '  End If\n' +
  '  df = FreeFile\n' +
  '  Open "/tmp/wos-asset-out.txt" For Output As #df\n' +
  '  Print #df, out\n' +
  '  Close #df\n' +
  'End Sub\n' +
  '</script:module>\n'

// Written BEFORE the engine boots — config the bootstrap reads at init.
export function seedEngineProfile(): void {
  try {
    const userDir = path.join(ENGINE_PROFILE, 'user')
    fs.mkdirSync(userDir, { recursive: true })
    fs.writeFileSync(path.join(userDir, 'registrymodifications.xcu'), PROFILE_XCU)
  } catch {
    /* best effort */
  }
}

// Written AFTER the engine is ready: lok_init regenerates the user Basic library
// on a fresh profile, so seeding the macro before boot gets overwritten. Written
// after init, runMacro lazy-loads it on first use.
export function seedMacroLibrary(): void {
  // Fail LOUD before writing: a reserved-word variable, a duplicate Sub, or an
  // unescaped < > & in the module compiles to a module-level error that silently
  // no-ops EVERY macro (runMacro still returns ok:true). We never write such a
  // module into the profile — this throw surfaces the offending token at seed
  // time instead of shipping a silent all-macros-dead engine. NOT caught below.
  assertBasicModuleValid(BASIC_MODULE)
  assertBasicModuleValid(BASIC_MODULE_2)
  assertBasicModuleValid(BASIC_MODULE_3)
  try {
    const userDir = path.join(ENGINE_PROFILE, 'user')
    const basicDir = path.join(userDir, 'basic', 'Standard')
    fs.mkdirSync(basicDir, { recursive: true })
    fs.writeFileSync(path.join(userDir, 'basic', 'script.xlc'), BASIC_XLC)
    fs.writeFileSync(path.join(basicDir, 'script.xlb'), BASIC_XLB)
    fs.writeFileSync(path.join(basicDir, 'Module1.xba'), BASIC_MODULE)
    fs.writeFileSync(path.join(basicDir, 'Module2.xba'), BASIC_MODULE_2)
    fs.writeFileSync(path.join(basicDir, 'Module3.xba'), BASIC_MODULE_3)
  } catch {
    /* best effort */
  }
}
