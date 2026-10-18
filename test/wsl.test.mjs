// WSL: the UTF-16 output of wsl.exe, the distributions, and the checks from inside a distribution.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { fakeMachine } from "./machine.mjs";
import { decodeWsl, insideWsl, onWindowsDrive, parseDistros, windowsWslFacts, wslLocations } from "../src/wsl.mjs";

const utf16 = (text, { bom = false } = {}) => Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(text, "utf16le")]);
const LIST = "  NAME              STATE           VERSION\r\n* docker-desktop    Running         2\r\n  Ubuntu            Stopped         2\r\n  Debian-old        Running         1\r\n";

test("decodeWsl: UTF-16 little endian with and without a byte-order mark, UTF-16 big endian, and plain text", () => {
  assert.equal(decodeWsl(utf16(LIST)), LIST);
  assert.equal(decodeWsl(utf16(LIST, { bom: true })), LIST);
  const be = Buffer.from(utf16("NAME\r\n")); be.swap16();
  assert.equal(decodeWsl(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), "NAME\r\n");
  assert.equal(decodeWsl(Buffer.from("plain text\r\n", "utf8")), "plain text\r\n");
  assert.equal(decodeWsl(Buffer.alloc(0)), "");
  assert.equal(decodeWsl("already text"), "already text");
  assert.equal(decodeWsl(utf16("Ubuntu — Ünïcode 日本語")), "Ubuntu — Ünïcode 日本語");
});

test("parseDistros: the default is marked with *, the state and the version are read from the columns, and a header in another language does not matter", () => {
  const d = parseDistros(LIST);
  assert.deepEqual(d, [
    { name: "docker-desktop", isDefault: true, state: "Running", version: 2, internal: true },
    { name: "Ubuntu", isDefault: false, state: "Stopped", version: 2, internal: false },
    { name: "Debian-old", isDefault: false, state: "Running", version: 1, internal: false },
  ]);
  const de = parseDistros("  NAME    ZUSTAND    VERSION\n* Ubuntu-22.04    Wird ausgeführt    2\n");
  assert.deepEqual(de.map((x) => [x.name, x.state, x.version]), [["Ubuntu-22.04", "Wird ausgeführt", 2]], "a state of two words");
  assert.deepEqual(parseDistros("Windows Subsystem for Linux has no installed distributions.\r\nYou can install distributions by running: wsl.exe --install\r\n"), []);
  assert.deepEqual(parseDistros(""), []);
  const internal = parseDistros("NAME STATE VERSION\n* rancher-desktop Running 2\n  rancher-desktop-data Running 2\n  podman-machine-default Stopped 2\n  docker-desktop-data Stopped 2\n");
  assert.ok(internal.every((x) => x.internal));
});

test("windowsWslFacts: the distributions of this machine, those worth working in, and the default; WSL that is not installed or not here", () => {
  const sys = fakeMachine({ commands: { wsl: () => ({ status: 0, stdout: utf16(LIST) }) } });
  const w = windowsWslFacts(sys);
  assert.equal(w.available, true);
  assert.equal(w.defaultName, "docker-desktop");
  assert.deepEqual(w.workable.map((d) => d.name), ["Ubuntu", "Debian-old"]);
  assert.deepEqual(sys.runs[0].args, ["-l", "-v"]);
  assert.equal(sys.runs[0].opts.binary, true);
  const only = windowsWslFacts(fakeMachine({ commands: { wsl: () => ({ status: 0, stdout: utf16("  NAME  STATE  VERSION\r\n* docker-desktop  Running  2\r\n") }) } }));
  assert.deepEqual([only.available, only.workable.length, only.defaultName], [true, 0, "docker-desktop"]);
  const none = windowsWslFacts(fakeMachine({ commands: { wsl: () => ({ status: 1, stdout: utf16("Windows Subsystem for Linux has no installed distributions.\r\n") }) } }));
  assert.deepEqual([none.available, none.distros.length], [false, 0]);
  const missing = windowsWslFacts(fakeMachine({}));
  assert.deepEqual([missing.available, missing.error], [false, null], "no wsl.exe is not an error");
  assert.equal(windowsWslFacts(fakeMachine({ platform: "linux" })).available, false);
});

test("insideWsl: /proc/version says Microsoft; WSL 2 has the Microsoft kernel, WSL 1 has Microsoft in the name of the build", () => {
  const wsl2 = fakeMachine({ platform: "linux", texts: { "/proc/version": "Linux version 5.15.153.1-microsoft-standard-WSL2 (root@x) (gcc) #1 SMP" } });
  assert.deepEqual(insideWsl(wsl2), { inside: true, version: 2 });
  const wsl1 = fakeMachine({ platform: "linux", texts: { "/proc/version": "Linux version 4.4.0-19041-Microsoft (Microsoft@Microsoft.com) (gcc version 5.4.0)" } });
  assert.deepEqual(insideWsl(wsl1), { inside: true, version: 1 });
  assert.deepEqual(insideWsl(fakeMachine({ platform: "linux", texts: { "/proc/version": "Linux version 6.8.0-generic (buildd@lcy02)" } })), { inside: false, version: null });
  assert.deepEqual(insideWsl(fakeMachine({ platform: "linux" })), { inside: false, version: null });
  assert.deepEqual(insideWsl(fakeMachine({ platform: "win32" })), { inside: false, version: null });
  assert.deepEqual(insideWsl(fakeMachine({ platform: "darwin" })), { inside: false, version: null });
});

test("wslLocations: the config folder and the project on a Windows drive are told from those in the Linux home", () => {
  assert.equal(onWindowsDrive("/mnt/c/Users/me"), true);
  assert.equal(onWindowsDrive("/mnt/d"), true);
  assert.equal(onWindowsDrive("/mnt/wsl/x"), false);
  assert.equal(onWindowsDrive("/home/me"), false);
  const slow = wslLocations(fakeMachine({ platform: "linux", home: "/home/me", env: { CLAUDE_CONFIG_DIR: "/mnt/c/Users/me/.claude" } }), "/mnt/c/src/shop");
  assert.deepEqual([slow.configOnWindows, slow.projectOnWindows, slow.configSource], [true, true, "CLAUDE_CONFIG_DIR"]);
  const fast = wslLocations(fakeMachine({ platform: "linux", home: "/home/me", env: {} }), "/home/me/code/shop");
  assert.deepEqual([fast.configOnWindows, fast.projectOnWindows, fast.configDir], [false, false, "/home/me/.claude"]);
});
