// The files of a Cursor CLI install, as they were on the machine this was written on (the Cursor CLI installed on 16 June 2026, read on 18 October 2026): the
// launcher agent.cmd (cursor-agent.cmd is the same), and the lines of cursor-agent.ps1 that choose a version folder. Written out here, not copied from the
// install, and cut to the lines the tool reads; test/windows.test.mjs holds the pattern in them to PowerShell's own -match.
export const CMD_TEXT = '@echo off\r\nsetlocal enabledelayedexpansion\r\nset "CURSOR_INVOKED_AS=%~nx0"\r\n\r\nREM Get the directory of this script\r\nset "SCRIPT_DIR=%~dp0"\r\nif "%SCRIPT_DIR:~-1%"=="\\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"\r\n\r\n%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\\cursor-agent.ps1" %*\r\n';

export const PATTERN = "^\\d{4}\\.\\d{1,2}\\.\\d{1,2}-[a-f0-9]+$";

export const PS1_TEXT = [
  "## Are we somehow in the same dir as the script? Just run it. Look for node.exe",
  'if (Test-Path "$scriptPath\\node.exe") {',
  '    & "$scriptPath\\node.exe" "$scriptPath\\index.js" $args',
  "    exit $LASTEXITCODE",
  "}",
  "",
  "## Otherwise, we're in a version directory. Find the latest version.",
  '$versionDir = Get-ChildItem -Path "$scriptPath\\versions" -Directory |',
  "    Where-Object {",
  "        $name = $_.Name",
  "        # Check if directory name matches version format: YYYY.MM.DD-commit",
  `        $name -match '${PATTERN}'`,
  "    } |",
  "    Sort-Object { Parse-VersionString $_.Name } -Descending |",
  "    Select-Object -First 1",
  "",
].join("\n");

/** The version folder that the installer made on that machine: it does not match PATTERN. */
export const REAL_VERSION_FOLDER = "2026.06.16-20-30-07-a07d3ac";
