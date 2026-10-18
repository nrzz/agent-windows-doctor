// The cases the shell prediction is held to. Each one is run on a pretend Windows machine by test/claude-shell.test.mjs (so it runs on every
// system), and the rows that stand for a claim of an explain page (test/claude-claims.mjs) are built on a real disk by test/e2e-claude.test.mjs and put
// to the real claude binary through a fake Messages API, reading the tools of the first request. What a row expects is what the binary did when
// claude-windows-doctor put the whole table to it (Claude Code 2.1.295 and 2.1.299 on Windows 11); the README's "What was verified, and how" says how.
//
// A row:
//   id, about     what it is
//   layouts       the fake Git trees that exist, by name (LAYOUTS); each is a folder {root}/<name> with these files (zero bytes)
//   path          folders put before the system folders on PATH
//   env           variables of the process; `bs:` at the start of a value turns its slashes into backslashes
//   settings      { user, project, local }: the settings files, as objects
//   projectFiles  files made in the project folder, by their path in it
//   defaultGit    "absent": only on a machine without Git at C:\Program Files\Git (the pretend machine has none); "present": only on one that has it
//   expect        { tools: the shell tools of the first request, exit: the exit code of `claude -p`, how: how Git Bash was found }
// Placeholders in strings: {root} the folder of the layouts, {work} the project folder, {g1} for {root}/g1 and so on for every layout
// (with forward slashes; {g1:bs} is the same folder with backslashes).
export const LAYOUTS = {
  // a normal Git for Windows, with the odd files that the variable rows point at
  g1: ["cmd/git.exe", "bin/bash.exe", "bin/bash", "bin/sh.exe", "git-bash.exe", "usr/bin/bash.exe"],
  g2: ["mingw64/bin/git.exe", "bin/bash.exe"],
  g3: ["bin/git.exe", "bin/bash.exe"],
  g4: ["cmd/git.cmd", "bin/bash.exe"],
  g5: ["cmd/git.exe"],
  g6: ["shims/git.exe", "bin/bash.exe"],
  g7: ["cmd/git.exe", "bin/sh.exe"],
  g8: ["cmd/git.exe", "bin/BASH.EXE"],
  d: ["bash.exe/"],
  "sp ace": ["bin/bash.exe"],
  pf: ["Git/bin/bash.exe"],
  other: ["bin/bash.exe"],
};

const BASH = { tools: ["Bash"], exit: 0 };
const PS = { tools: ["PowerShell"], exit: 0, how: null };
const BOTH = { tools: ["Bash", "PowerShell"], exit: 0 };
const NONE = { tools: [], exit: 0 };
const FATAL = { tools: [], exit: 1, how: null };
const via = (how, e = BASH) => ({ ...e, how });
const G1 = "{g1}/bin/bash.exe";
const withBash = { CLAUDE_CODE_GIT_BASH_PATH: G1 };
const row = (id, about, o) => ({ id, about, layouts: [], path: [], env: {}, settings: {}, projectFiles: [], ...o });
const absent = { defaultGit: "absent" };

export const ROWS = [
  // ---- no Git Bash, no variable
  row("no-git", "no git on PATH at all: PowerShell only (the WSL launcher bash.exe in System32 is not used)", { ...absent, expect: PS }),
  row("no-git-ps-0", "no Git Bash and CLAUDE_CODE_USE_POWERSHELL_TOOL=0: Claude Code stops at start", { ...absent, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, expect: FATAL }),
  row("no-git-ps-1", "no Git Bash and the PowerShell tool on", { ...absent, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, expect: PS }),
  ...["false", "no", "off", "FALSE", "No", "OFF", "Off"].map((v) => row(`no-git-ps-off-${v}`, `${v} reads as off`, { ...absent, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: v }, expect: FATAL })),
  ...["true", "yes", "on", "TRUE", "Yes", "ON", " 1", "1 ", "\ttrue"].map((v, i) => row(`no-git-ps-on-${i}`, `${JSON.stringify(v)} reads as on`, { ...absent, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: v }, expect: PS })),
  ...["", "2", "enabled", "y", "t", "1.0", "00", "yes please", "null"].map((v, i) => row(`no-git-ps-unread-${i}`, `${JSON.stringify(v)} reads as not set: no Git Bash, so the tool is on`, { ...absent, env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: v }, expect: PS })),
  row("no-git-settings-number-0", "env.CLAUDE_CODE_USE_POWERSHELL_TOOL written as the number 0 reaches Claude Code as \"0\"", { ...absent, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: 0 } } }, expect: FATAL }),
  row("no-git-settings-false", "written as the boolean false it reaches Claude Code as \"false\"", { ...absent, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: false } } }, expect: FATAL }),
  row("no-git-settings-user-0", "the off switch in user settings", { ...absent, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } } }, expect: FATAL }),
  row("no-git-settings-project-0", "the off switch in project settings counts", { ...absent, settings: { project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } } }, expect: FATAL }),
  row("no-git-settings-local-0", "the off switch in local settings counts", { ...absent, settings: { local: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } } }, expect: FATAL }),

  // ---- Git found through PATH (where git, then two folders up, then bin\bash.exe)
  row("path-cmd", "PATH has Git's cmd folder: cmd\\git.exe, and bin\\bash.exe is one folder up from cmd", { ...absent, layouts: ["g1"], path: ["{g1}/cmd"], expect: via("where-git") }),
  row("path-mingw64", "PATH has mingw64\\bin only: two folders up from mingw64\\bin\\git.exe is mingw64, and mingw64\\bin\\bash.exe is not there", { ...absent, layouts: ["g2"], path: ["{g2}/mingw64/bin"], expect: PS }),
  row("path-bin", "git.exe in a bin folder: bin\\bash.exe next to it", { ...absent, layouts: ["g3"], path: ["{g3}/bin"], expect: via("where-git") }),
  row("path-git-cmd", "git.cmd instead of git.exe", { ...absent, layouts: ["g4"], path: ["{g4}/cmd"], expect: via("where-git") }),
  row("path-no-bash", "git on PATH, no bash.exe", { ...absent, layouts: ["g5"], path: ["{g5}/cmd"], expect: PS }),
  row("path-shims", "a shim folder: any folder one below a root that has bin\\bash.exe", { ...absent, layouts: ["g6"], path: ["{g6}/shims"], expect: via("where-git") }),
  row("path-sh-only", "only sh.exe in bin: Claude Code derives bash.exe, not sh.exe", { ...absent, layouts: ["g7"], path: ["{g7}/cmd"], expect: PS }),
  row("path-upper-case", "BASH.EXE in capitals", { ...absent, layouts: ["g8"], path: ["{g8}/cmd"], expect: via("where-git") }),
  row("path-order-mingw-first", "mingw64\\bin before cmd: the first line of where git decides, so Git Bash is not found", { ...absent, layouts: ["g2", "g1"], path: ["{g2}/mingw64/bin", "{g1}/cmd"], expect: PS }),
  row("path-order-cmd-first", "cmd before mingw64\\bin: found", { ...absent, layouts: ["g1", "g2"], path: ["{g1}/cmd", "{g2}/mingw64/bin"], expect: via("where-git") }),
  row("path-git-in-cwd", "a git.exe in the project folder is skipped, and the next one is used", { ...absent, layouts: ["g1"], path: ["{g1}/cmd"], projectFiles: ["git.exe"], expect: via("where-git") }),
  row("path-git-in-cwd-only", "a git.exe only in the project folder: skipped, nothing else", { ...absent, projectFiles: ["git.exe"], expect: PS }),
  row("path-node-modules", "a git.exe in a node_modules folder below the project folder is skipped", { ...absent, projectFiles: ["node_modules/.bin/git.exe", "node_modules/bin/bash.exe"], path: ["{work}/node_modules/.bin"], expect: PS }),
  row("path-folder-below-cwd", "a git.exe in another folder below the project folder is used", { ...absent, projectFiles: ["tools/git.exe", "bin/bash.exe"], path: ["{work}/tools"], expect: via("where-git") }),
  row("program-files-variable-not-read", "ProgramFiles points at a folder with Git\\bin\\bash.exe: not read, the fixed C:\\Program Files is", { ...absent, layouts: ["pf"], env: { ProgramFiles: "bs:{pf}", ProgramW6432: "bs:{pf}", "ProgramFiles(x86)": "bs:{pf}" }, expect: PS }),

  // ---- CLAUDE_CODE_GIT_BASH_PATH: which spellings are taken
  row("var-forward", "a valid path with forward slashes", { layouts: ["g1"], env: withBash, expect: via("variable") }),
  row("var-backslash", "with backslashes", { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "bs:{g1}/bin/bash.exe" }, expect: via("variable") }),
  row("var-upper-case", "the file name in capitals", { layouts: ["g8"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g8}/bin/BASH.EXE" }, expect: via("variable") }),
  row("var-sh-exe", "sh.exe is taken", { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/bin/sh.exe" }, expect: via("variable") }),
  row("var-bash-no-ext", "a file named bash is taken", { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/bin/bash" }, expect: via("variable") }),
  row("var-folder-named-bash", "a folder named bash.exe is taken (only the name and that it exists are checked)", { layouts: ["d"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{d}/bash.exe" }, expect: via("variable") }),
  row("var-path-with-space", "a path with a space", { layouts: ["sp ace"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{sp ace}/bin/bash.exe" }, expect: via("variable") }),
  row("var-trailing-space", "a space after the path is trimmed", { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: `${G1} ` }, expect: via("variable") }),
  row("var-leading-space", "a space before the path is trimmed", { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: ` ${G1}` }, expect: via("variable") }),
  row("var-git-bash-exe", "git-bash.exe (the terminal) is not a bash or sh binary: ignored", { ...absent, layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/git-bash.exe" }, expect: PS }),
  row("var-git-exe", "git.exe: ignored", { ...absent, layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/cmd/git.exe" }, expect: PS }),
  row("var-bin-folder", "the bin folder: ignored", { ...absent, layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/bin" }, expect: PS }),
  row("var-double-quotes", "in double quotes: the quote marks are part of the value, ignored", { ...absent, layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "\"{g1:bs}\\bin\\bash.exe\"" }, expect: PS }),
  row("var-single-quotes", "in single quotes: ignored", { ...absent, layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "'{g1:bs}\\bin\\bash.exe'" }, expect: PS }),
  row("var-percent", "a %USERPROFILE% in the value is not expanded: ignored", { ...absent, env: { CLAUDE_CODE_GIT_BASH_PATH: "%USERPROFILE%\\Git\\bin\\bash.exe" }, expect: PS }),
  row("var-relative", "a relative path: looked up from the project folder, ignored", { ...absent, env: { CLAUDE_CODE_GIT_BASH_PATH: "bin\\bash.exe" }, expect: PS }),
  row("var-missing", "a file that is not there: ignored", { ...absent, env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/nope/bash.exe" }, expect: PS }),
  row("var-empty", "an empty value is the same as not set", { ...absent, env: { CLAUDE_CODE_GIT_BASH_PATH: "" }, expect: PS }),
  row("var-invalid-then-path", "an invalid value falls back to the search: PATH finds Git Bash", { ...absent, layouts: ["g1"], path: ["{g1}/cmd"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/nope/bash.exe" }, expect: via("where-git") }),
  row("var-wins-over-path", "a valid value wins over what PATH would find", { layouts: ["g1", "other"], path: ["{other}/bin"], env: withBash, expect: via("variable") }),
  row("var-rescues-mingw", "a valid value finds Git Bash where the PATH order fails", { layouts: ["g1", "g2"], path: ["{g2}/mingw64/bin"], env: withBash, expect: via("variable") }),

  // ---- where the variable is read from
  row("var-in-user-settings", "CLAUDE_CODE_GIT_BASH_PATH in the env of the user settings", { layouts: ["g1"], settings: { user: { env: { CLAUDE_CODE_GIT_BASH_PATH: G1 } } }, expect: via("variable") }),
  row("var-in-project-settings", "in the env of the project settings: not used", { ...absent, layouts: ["g1"], settings: { project: { env: { CLAUDE_CODE_GIT_BASH_PATH: G1 } } }, expect: PS }),
  row("var-in-local-settings", "in the env of the local settings: not used", { ...absent, layouts: ["g1"], settings: { local: { env: { CLAUDE_CODE_GIT_BASH_PATH: G1 } } }, expect: PS }),
  row("var-process-bad-user-good", "an invalid process value and a valid user settings value: the settings value is used", { layouts: ["g1"], env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/nope/bash.exe" }, settings: { user: { env: { CLAUDE_CODE_GIT_BASH_PATH: G1 } } }, expect: via("variable") }),
  row("var-process-good-user-bad", "a valid process value and an invalid user settings value: the settings value replaces it, and is ignored", { ...absent, layouts: ["g1"], env: withBash, settings: { user: { env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/nope/bash.exe" } } }, expect: PS }),
  row("var-project-bad-process-good", "an invalid value in the project settings does not touch a valid process value", { layouts: ["g1"], env: withBash, settings: { project: { env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/nope/bash.exe" } } }, expect: via("variable") }),

  // ---- the PowerShell tool beside Git Bash
  row("bash-ps-unset", "Git Bash found, the PowerShell variable not set: the account decides (a fake API has none, and the tool is off)", { layouts: ["g1"], env: withBash, expect: via("variable") }),
  row("bash-ps-1", "CLAUDE_CODE_USE_POWERSHELL_TOOL=1: both tools", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, expect: via("variable", BOTH) }),
  row("bash-ps-0", "=0: Bash only", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, expect: via("variable") }),
  row("bash-ps-true", "=true", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "true" }, expect: via("variable", BOTH) }),
  row("bash-ps-yes", "=yes", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "yes" }, expect: via("variable", BOTH) }),
  row("bash-ps-on", "=on", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "on" }, expect: via("variable", BOTH) }),
  row("bash-ps-off", "=off", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "off" }, expect: via("variable") }),
  row("bash-ps-2", "=2 reads as not set", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "2" }, expect: via("variable") }),
  row("bash-ps-user-1", "user settings env =1", { layouts: ["g1"], env: withBash, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } }, expect: via("variable", BOTH) }),
  row("bash-ps-project-1", "project settings env =1 counts", { layouts: ["g1"], env: withBash, settings: { project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } }, expect: via("variable", BOTH) }),
  row("bash-ps-local-1", "local settings env =1 counts", { layouts: ["g1"], env: withBash, settings: { local: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } }, expect: via("variable", BOTH) }),
  row("bash-ps-number-1", "env value written as the number 1", { layouts: ["g1"], env: withBash, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: 1 } } }, expect: via("variable", BOTH) }),
  row("bash-ps-boolean-true", "env value written as the boolean true", { layouts: ["g1"], env: withBash, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: true } } }, expect: via("variable", BOTH) }),
  row("prec-user1-project0", "user =1, project =0: the project wins", { layouts: ["g1"], env: withBash, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } }, project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } } }, expect: via("variable") }),
  row("prec-user0-project1", "user =0, project =1: the project wins", { layouts: ["g1"], env: withBash, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }, project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } }, expect: via("variable", BOTH) }),
  row("prec-project1-local0", "project =1, local =0: the local file wins", { layouts: ["g1"], env: withBash, settings: { project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } }, local: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } } }, expect: via("variable") }),
  row("prec-project0-local1", "project =0, local =1: the local file wins", { layouts: ["g1"], env: withBash, settings: { project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }, local: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } }, expect: via("variable", BOTH) }),
  row("prec-user1-local0", "user =1, local =0: the local file wins", { layouts: ["g1"], env: withBash, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } }, local: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } } }, expect: via("variable") }),
  row("prec-user0-local1", "user =0, local =1: the local file wins", { layouts: ["g1"], env: withBash, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } }, local: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } }, expect: via("variable", BOTH) }),
  row("prec-process0-project1", "the process environment =0, project settings =1: the settings win", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, settings: { project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } }, expect: via("variable", BOTH) }),
  row("prec-process1-project0", "the process environment =1, project settings =0: the settings win", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { project: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } } }, expect: via("variable") }),
  row("prec-process1-user0", "the process environment =1, user settings =0: the settings win", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" } } }, expect: via("variable") }),
  row("prec-process0-user1", "the process environment =0, user settings =1: the settings win", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, settings: { user: { env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } } }, expect: via("variable", BOTH) }),

  // ---- deny rules that take a shell tool away
  row("deny-Bash", "deny rule Bash: the Bash tool is gone", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["Bash"] } } }, expect: via("variable", PS) }),
  row("deny-Bash-star", "deny rule Bash(*)", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["Bash(*)"] } } }, expect: via("variable", PS) }),
  row("deny-Bash-empty", "deny rule Bash(): not a whole-tool rule", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["Bash()"] } } }, expect: via("variable", BOTH) }),
  row("deny-bash-lower", "deny rule bash in lower case: no rule", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["bash"] } } }, expect: via("variable", BOTH) }),
  row("deny-Bash-scoped", "deny rule Bash(git *): the tool stays (with the variable on, so does PowerShell)", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["Bash(git *)"] } } }, expect: via("variable", BOTH) }),
  row("deny-PowerShell", "deny rule PowerShell", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["PowerShell"] } } }, expect: via("variable") }),
  row("deny-PowerShell-star", "deny rule PowerShell(*)", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["PowerShell(*)"] } } }, expect: via("variable") }),
  row("deny-PowerShell-scoped", "deny rule PowerShell(git *): the tool stays", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["PowerShell(git *)"] } } }, expect: via("variable", BOTH) }),
  row("deny-Bash-project", "deny rule Bash in the project settings", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { project: { permissions: { deny: ["Bash"] } } }, expect: via("variable", PS) }),
  row("deny-Bash-local", "deny rule Bash in the local settings", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { local: { permissions: { deny: ["Bash"] } } }, expect: via("variable", PS) }),
  row("deny-both", "deny rules Bash and PowerShell: no shell tool, and Claude Code still runs", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { permissions: { deny: ["Bash", "PowerShell"] } } }, expect: via("variable", NONE) }),
  row("deny-Bash-ps-off", "Git Bash found, the PowerShell tool off, deny rule Bash: no shell tool, no stop at start", { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, settings: { user: { permissions: { deny: ["Bash"] } } }, expect: via("variable", NONE) }),
  row("deny-Bash-ps-unset", "Git Bash found, the PowerShell variable not set, deny rule Bash", { layouts: ["g1"], env: withBash, settings: { user: { permissions: { deny: ["Bash"] } } }, expect: via("variable", NONE) }),
  row("deny-PowerShell-no-git", "no Git Bash, deny rule PowerShell: no shell tool, no stop at start", { ...absent, settings: { user: { permissions: { deny: ["PowerShell"] } } }, expect: { ...NONE, how: null } }),

  // ---- defaultShell is for the commands typed after !, and changes nothing here
  ...["bash", "powershell", "cmd"].flatMap((v) => [
    row(`default-shell-${v}-bash`, `defaultShell "${v}", Git Bash found`, { layouts: ["g1"], env: withBash, settings: { user: { defaultShell: v } }, expect: via("variable") }),
    row(`default-shell-${v}-both`, `defaultShell "${v}", both tools`, { layouts: ["g1"], env: { ...withBash, CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, settings: { user: { defaultShell: v } }, expect: via("variable", BOTH) }),
    row(`default-shell-${v}-ps`, `defaultShell "${v}", PowerShell only`, { ...absent, settings: { user: { defaultShell: v } }, expect: PS }),
  ]),
  row("default-shell-project", "defaultShell powershell in the project settings, Git Bash found", { layouts: ["g1"], env: withBash, settings: { project: { defaultShell: "powershell" } }, expect: via("variable") }),

  // ---- with Git at C:\Program Files\Git (windows-latest; a machine like that only)
  row("default-git-no-vars", "Git at C:\\Program Files\\Git, nothing set: the fixed path is found first", { defaultGit: "present", expect: via("program-files") }),
  row("default-git-mingw-first", "mingw64\\bin first on PATH would fail, but the fixed path is tried before PATH", { defaultGit: "present", layouts: ["g2"], path: ["{g2}/mingw64/bin"], expect: via("program-files") }),
  row("default-git-var-wins", "a valid variable wins over the fixed path", { defaultGit: "present", layouts: ["g1"], env: withBash, expect: via("variable") }),
  row("default-git-var-invalid", "an invalid variable falls back to the fixed path", { defaultGit: "present", env: { CLAUDE_CODE_GIT_BASH_PATH: "{g1}/nope/bash.exe" }, expect: via("program-files") }),
  row("default-git-ps-0", "the PowerShell tool off does not stop it when Git Bash is found", { defaultGit: "present", env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0" }, expect: via("program-files") }),
  row("default-git-ps-1", "both tools", { defaultGit: "present", env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" }, expect: via("program-files", BOTH) }),
  row("default-git-project-var", "the variable in project settings changes nothing", { defaultGit: "present", layouts: ["g1"], settings: { project: { env: { CLAUDE_CODE_GIT_BASH_PATH: G1 } } }, expect: via("program-files") }),
];

// The PowerShell tool's edition line, with a fake pwsh.exe, powershell.exe and PowerShell folder (test/e2e-claude.test.mjs reads it from the tool's description)
export const EDITIONS = [
  { id: "default", about: "System32's Windows PowerShell only", edition: "Windows PowerShell 5.1 (powershell.exe)", core: false },
  { id: "pwsh-on-path", about: "a pwsh.exe on PATH", files: ["{root}/ps/pwsh.exe"], path: ["{root}/ps"], edition: "PowerShell 7+ (pwsh)", core: true },
  { id: "pwsh-in-program-files", about: "PowerShell\\7\\pwsh.exe under the folder ProgramW6432 names", files: ["{root}/pw/PowerShell/7/pwsh.exe"], env: { ProgramW6432: "bs:{root}/pw" }, edition: "PowerShell 7+ (pwsh)", core: true },
  { id: "pwsh-dotnet-tool", about: ".dotnet\\tools\\pwsh.exe in the home folder", files: ["{root}/hm/.dotnet/tools/pwsh.exe"], env: { USERPROFILE: "bs:{root}/hm", HOME: "bs:{root}/hm" }, edition: "PowerShell 7+ (pwsh)", core: true },
  { id: "powershell-on-path", about: "a powershell.exe first on PATH, no pwsh", files: ["{root}/b/powershell.exe"], path: ["{root}/b"], edition: "Windows PowerShell 5.1 (powershell.exe)", core: false },
  { id: "pwsh-after-powershell", about: "pwsh on PATH after a powershell.exe: pwsh is looked for first", files: ["{root}/b/powershell.exe", "{root}/ps/pwsh.exe"], path: ["{root}/b", "{root}/ps"], edition: "PowerShell 7+ (pwsh)", core: true },
];
