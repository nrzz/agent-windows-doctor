// The claims of the Claude explain pages that say "verified", and the rows of test/shell-table.mjs that stand for each of them. test/e2e-claude.test.mjs puts
// these rows to the real binary (one row per restated claim; the full table of 129 cases is put to the binary in claude-windows-doctor), and test/shell.test.mjs
// puts every row of the table to the prediction on a pretend machine.
export const CLAIMS = {
  "claude.no-shell-tool": ["no-git-ps-0", "no-git-settings-project-0", "default-git-ps-0"],
  "claude.git-bash-not-found": ["no-git", "path-cmd", "path-mingw64", "path-order-mingw-first", "path-order-cmd-first", "path-git-in-cwd", "default-git-mingw-first"],
  "claude.git-bash-path-ignored": ["var-forward", "var-backslash", "var-path-with-space", "var-git-bash-exe", "var-double-quotes", "var-percent", "var-relative", "var-missing", "var-empty", "var-invalid-then-path", "var-wins-over-path", "var-rescues-mingw"],
  "claude.git-bash-path-project-settings": ["var-in-user-settings", "var-in-project-settings", "var-in-local-settings", "prec-project1-local0"],
  "claude.powershell-variable-unread": ["no-git-ps-1", "no-git-ps-off-No", "no-git-ps-on-1", "no-git-ps-unread-2", "bash-ps-unset", "bash-ps-1", "bash-ps-0", "bash-ps-off", "bash-ps-2"],
  "claude.wsl-bash-on-path": ["no-git"],
  "the deny rules that take a shell tool away": ["deny-Bash", "deny-Bash-scoped", "deny-PowerShell", "deny-both"],
};
export const RESTATED = [...new Set(Object.values(CLAIMS).flat())];
