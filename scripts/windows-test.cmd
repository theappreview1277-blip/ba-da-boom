@echo off
rem Full Windows check: update the source, build the installer, install it
rem silently for the current user, then run every test against the installed app.
rem Output goes to the screen and to test-results\windows-run.log.
setlocal
cd /d "%~dp0.."
if not exist test-results mkdir test-results
set LOG=test-results\windows-run.log
echo Ba-da-boom Windows test run %DATE% %TIME% > %LOG%

echo == Updating source
git pull >> %LOG% 2>&1 || goto fail
echo == Installing build tools (npm ci)
call npm ci >> %LOG% 2>&1 || goto fail
echo == Building the installer
call npm run dist:win >> %LOG% 2>&1 || goto fail

set SETUP=
for %%f in (release\Ba-da-boom-Setup-*-x64-unsigned.exe) do set "SETUP=%%f"
if not defined SETUP (echo No installer found in release\ >> %LOG% & goto fail)
echo == Installing %SETUP%
tasklist /fi "imagename eq Ba-da-boom.exe" | find /i "Ba-da-boom.exe" > nul && (echo Ba-da-boom is open. Close it and run this again. & echo App was open, stopped before install >> %LOG% & goto fail)
start "" /wait "%SETUP%" /S
set "ELECTRON_EXE=%LOCALAPPDATA%\Programs\Ba-da-boom\Ba-da-boom.exe"
if not exist "%ELECTRON_EXE%" (echo Installed app not found at %ELECTRON_EXE% >> %LOG% & goto fail)

echo == Running every test against the installed app (takes about 5 minutes)
set LONG=120
node test\e2e\run-all.mjs
set RESULT=%ERRORLEVEL%
type test-results\results.txt >> %LOG%
echo.
if %RESULT%==0 (echo ALL TESTS PASSED) else (echo SOME TESTS FAILED, see above)
echo Full log: %CD%\%LOG%
pause
exit /b %RESULT%

:fail
echo.
echo FAILED during the step above. Last lines of %LOG%:
powershell -NoProfile -Command "Get-Content '%LOG%' -Tail 30"
pause
exit /b 1
