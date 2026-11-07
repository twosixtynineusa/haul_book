@echo off
rem Haul Book: lets "make <target>" work from cmd (and ".\make <target>" from PowerShell).
rem It only starts the real make inside Git Bash, in this folder; every rule lives in the
rem Makefile. Needs Git for Windows and GNU make (README.md, section Windows).
setlocal
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%LocalAppData%\Programs\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo Git Bash was not found. Install Git for Windows: winget install -e --id Git.Git
  exit /b 1
)
rem Run in this folder (a login shell would otherwise start in your home folder).
set "CHERE_INVOKING=1"
cd /d "%~dp0"
"%GITBASH%" -lc "command -v make >/dev/null || { echo 'GNU make was not found. Install it: winget install -e --id ezwinports.make, then open a new window.'; exit 1; }; make %*"
exit /b %ERRORLEVEL%
