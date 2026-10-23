@echo off
rem Engine test kit: checks that LibreOfficeKit renders Writer and Calc documents
rem on this PC through wos-lok-host.exe, the way Workspace OS uses it. Installs
rem nothing. Needs LibreOffice: winget install --id TheDocumentFoundation.LibreOffice --exact
setlocal
set "HERE=%~dp0"
set "LO=C:\Program Files\LibreOffice\program"
if not exist "%LO%\mergedlo.dll" (
  echo LibreOffice was not found in "%LO%".
  echo Install it with: winget install --id TheDocumentFoundation.LibreOffice --exact
  pause
  exit /b 1
)
set "WOS_SMOKE_DUMP_DIR=%HERE%tiles"
set "WOS_SMOKE_PROBES=1"
if exist "%HERE%tiles" rmdir /s /q "%HERE%tiles"
> "%HERE%result.txt" (
  ver
  "%LO%\soffice.com" --version
  echo.
)
"%HERE%node.exe" "%HERE%lok-host-smoke.mjs" "%HERE%wos-lok-host.exe" "%LO%\\" "%LO%\fundamental.ini" "%HERE%fixtures\test-document.docx" "%HERE%fixtures\Harbour-Terminal-Q3.xlsx" "%HERE%fixtures\t.csv" >> "%HERE%result.txt" 2>&1
type "%HERE%result.txt"
echo.
echo Results are in result.txt; the rendered tiles are in the tiles folder.
echo The engine profile it used is %TEMP%\wos-lok-host-profile (safe to delete).
if not defined WOS_NO_PAUSE pause
