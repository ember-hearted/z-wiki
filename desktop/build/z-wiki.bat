@echo off
rem z-wiki launcher for old Windows: start with --disable-gpu --no-sandbox
rem old Windows (e.g. 1809) crashes on double-click z-wiki.exe (Electron 38 GPU/sandbox).
rem this bat starts z-wiki.exe with flags that avoid the crash (verified).
rem double-click THIS bat file, not z-wiki.exe.
start "" "%~dp0z-wiki.exe" --disable-gpu --no-sandbox
