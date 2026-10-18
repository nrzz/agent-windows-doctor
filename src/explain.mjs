// `explain <finding-id>`: what a finding means, what the agent does in that case, the fix, and the issue or forum threads. Each line of "does" is
// marked: V was seen in a real run (of the agent's binary, or of the Windows program that the line names; README, "What was verified, and how"),
// D is documentation (the vendor's, Windows', git's, or the words of a maintainer in a tracker or a forum), N was not verified here.
// There is a page for every id that src/findings.mjs can emit (test/explain.test.mjs holds the two lists to each other). The pages themselves are in
// src/pages-claude.mjs (claude-windows-doctor's 27) and src/pages-others.mjs.
import { CLAUDE_PAGES } from "./pages-claude.mjs";
import { OTHER_PAGES } from "./pages-others.mjs";

export const AGENT_ORDER = ["claude", "codex", "gemini", "copilot", "cursor"];
const rank = (p) => AGENT_ORDER.indexOf(p.id.split(".")[0]);

export const PAGES = [...CLAUDE_PAGES, ...OTHER_PAGES].map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
export const IDS = PAGES.map((p) => p.id);
const MARK = { V: "verified", D: "documented", N: "not verified" };

/** The basis of a finding: the page's mark ("verified", "documented" or "not verified"). */
export function basisOf(id) {
  const p = PAGES.find((x) => x.id === id);
  return p ? p.basis : "not verified";
}

/** Every page id and title, in page order. */
export function listPages() {
  return PAGES.map(({ id, title, basis }) => ({ id, title, basis }));
}

/** A page by id, with each line of `does` split into its mark and text, or null. */
export function pageFor(id) {
  const key = String(id).trim().toLowerCase();
  const p = PAGES.find((x) => x.id === key);
  if (!p) return null;
  return { ...p, does: p.does.map((line) => { const m = /^([VDN]): (.*)$/s.exec(line); return m ? { source: MARK[m[1]], text: m[2] } : { source: null, text: line }; }) };
}

/** The ids nearest to a word that is not one, for "did you mean". */
export function nearIds(word) {
  const w = String(word).toLowerCase();
  const scored = IDS.map((id) => ({ id, score: id.includes(w) || w.includes(id) ? 0 : w.split(/[-.]/).filter((p) => p && id.includes(p)).length ? 1 : 2 })).filter((x) => x.score < 2);
  return scored.sort((a, b) => a.score - b.score).slice(0, 5).map((x) => x.id);
}
