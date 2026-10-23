@echo off
rem Builds wos-lok-host.exe with MSVC. Run from a "x64 Native Tools" prompt (cl.exe on PATH).
rem Headers first, matching the oldest supported engine (the LOK function table only grows):
rem   set LOK_HEADER_REF=libreoffice-24.2.7.2 && bash scripts/lok/fetch-headers.sh
setlocal
set HERE=%~dp0
if not exist "%HERE%LibreOfficeKit\LibreOfficeKit.h" (
  echo run fetch-headers.sh first 1>&2
  exit /b 1
)
cl /nologo /std:c++17 /EHsc /O2 /MT /W3 /D_CRT_SECURE_NO_WARNINGS /I "%HERE%." "%HERE%wos-lok-host.cpp" /Fe:"%HERE%wos-lok-host.exe" /Fo:"%TEMP%\\" ole32.lib || exit /b 1
echo built %HERE%wos-lok-host.exe
