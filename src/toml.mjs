// A TOML 1.0 reader that keeps the position of every key. Codex reads its configuration with a TOML parser; this one answers the same
// question for a file (does it parse, and if not, on which line), and records where each key and table header is, so that a finding
// can name the line. It builds a plain value, too. Node built-ins only.
//
//   parseToml(text) -> { ok: true, value, entries, tables }
//                   or { ok: false, error: { message, line, column } }
//   entries: one per key/value pair, in file order: { path, line, column, type, value }
//            type is string, integer, float, boolean, datetime, array or table (an inline table); a key of an array of tables has
//            the index of the element in its path (["hooks", "PreToolUse", 0, "matcher"]).
//   tables:  one per header: { path, line, column, array }

export class TomlError extends Error {
  constructor(message, offset) {
    super(message);
    this.offset = offset;
  }
}

const isBareKeyChar = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "-";
const isDigit = (c) => c >= "0" && c <= "9";
const hex = (c) => /^[0-9a-fA-F]$/.test(c);
const control = (c) => { const n = c.charCodeAt(0); return (n < 0x20 && c !== "\t") || n === 0x7f; };

class Node {
  // kind: root, explicit (a [header]), implicit (made on the way to a header), dotted (made by a dotted key), inline, element (of [[array]])
  constructor(kind) { this.kind = kind; this.value = Object.create(null); this.array = null; }
}

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
    this.entries = [];
    this.tables = [];
    this.lineStarts = [0];
    for (let k = 0; k < text.length; k++) if (text[k] === "\n") this.lineStarts.push(k + 1);
    this.nodes = new WeakMap();
  }

  position(offset) {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.lineStarts[lo] + 1 };
  }

  fail(message, at = this.i) { throw new TomlError(message, at); }

  peek() { return this.s[this.i]; }
  eof() { return this.i >= this.s.length; }

  skipSpaces() { while (this.s[this.i] === " " || this.s[this.i] === "\t") this.i++; }

  // a comment up to the end of the line (the newline is left); control characters are not allowed in it
  skipComment() {
    if (this.s[this.i] !== "#") return;
    while (!this.eof() && this.s[this.i] !== "\n") {
      const c = this.s[this.i];
      if (c === "\r" && this.s[this.i + 1] === "\n") break;
      if (control(c)) this.fail("invalid control character in a comment");
      this.i++;
    }
  }

  atNewline() { return this.s[this.i] === "\n" || (this.s[this.i] === "\r" && this.s[this.i + 1] === "\n"); }
  newline() {
    if (this.s[this.i] === "\n") this.i++;
    else if (this.s[this.i] === "\r" && this.s[this.i + 1] === "\n") this.i += 2;
    else this.fail("expected a newline");
  }

  // whitespace, newlines and comments (between statements, and inside arrays)
  skipBlank() {
    for (;;) {
      this.skipSpaces();
      if (this.s[this.i] === "#") { this.skipComment(); continue; }
      if (this.atNewline()) { this.newline(); continue; }
      if (this.s[this.i] === "\r") this.fail("a carriage return must be followed by a line feed");
      return;
    }
  }

  endOfStatement() {
    this.skipSpaces();
    this.skipComment();
    if (this.eof()) return;
    if (this.atNewline()) { this.newline(); return; }
    this.fail("expected a newline after the value");
  }

  parse() {
    if (this.s.charCodeAt(0) === 0xfeff) this.i = 1;
    const root = new Node("root");
    let current = root;
    for (;;) {
      this.skipBlank();
      if (this.eof()) break;
      const c = this.peek();
      if (c === "[") current = this.header(root);
      else this.keyValue(current, current.path || []);
    }
    return { root, value: this.plain(root) };
  }

  plain(node) {
    const out = {};
    for (const [k, v] of Object.entries(node.value)) out[k] = this.plainValue(v);
    return out;
  }

  plainValue(v) {
    if (v instanceof Node) return this.plain(v);
    if (v && v.isArray) return v.items.map((x) => this.plainValue(x));
    if (v && v.isDatetime) return v.text;
    return v && v.isScalar ? v.value : v;
  }

  // ---- keys -------------------------------------------------------------------------------------------------------------

  keyPart() {
    const c = this.peek();
    if (c === '"') return this.basicString(false);
    if (c === "'") return this.literalString(false);
    const start = this.i;
    while (!this.eof() && isBareKeyChar(this.s[this.i])) this.i++;
    if (this.i === start) {
      if (this.eof() || this.atNewline()) this.fail("key with no value, expected `=`");
      this.fail(`invalid key, found \`${this.s[this.i]}\``);
    }
    return this.s.slice(start, this.i);
  }

  // a dotted key: a.b."c d".e (spaces around the dots are allowed)
  dottedKey() {
    const parts = [];
    this.skipSpaces();
    const at = this.i;
    parts.push(this.keyPart());
    for (;;) {
      this.skipSpaces();
      if (this.peek() === ".") { this.i++; this.skipSpaces(); parts.push(this.keyPart()); } else break;
    }
    return { parts, at };
  }

  keyValue(table, basePath) {
    const { parts, at } = this.dottedKey();
    this.skipSpaces();
    if (this.peek() !== "=") this.fail(this.eof() || this.atNewline() ? "key with no value, expected `=`" : "key with no value, expected `=`", this.i);
    this.i++;
    this.skipSpaces();
    if (this.eof() || this.atNewline()) this.fail("missing value after `=`");
    // walk the dotted prefix, making tables
    let node = table;
    const pathSoFar = [...basePath];
    for (let k = 0; k < parts.length - 1; k++) {
      const part = parts[k];
      pathSoFar.push(part);
      let next = node.value[part];
      if (next === undefined) {
        next = new Node("dotted");
        next.path = [...pathSoFar];
        node.value[part] = next;
      } else if (next instanceof Node) {
        if (next.kind === "inline" || next.kind === "explicit" || next.kind === "element") this.fail(`dotted key \`${parts.join(".")}\` extends a table that is already defined`, at);
        if (next.kind === "implicit") this.fail(`dotted key \`${parts.join(".")}\` extends a table that is already defined`, at);
      } else this.fail(`key \`${part}\` is already defined`, at);
      node = next;
    }
    const last = parts[parts.length - 1];
    if (last in node.value) this.fail(`duplicate key \`${last}\``, at);
    const valueAt = this.i;
    const v = this.value(pathSoFar.concat(last));
    node.value[last] = v;
    const { line, column } = this.position(at);
    const full = [...basePath, ...parts];
    this.entries.push({ path: full, line, column, type: this.typeOf(v), value: this.plainValue(v), offset: valueAt });
    this.endOfStatement();
  }

  typeOf(v) {
    if (v instanceof Node) return "table";
    if (v.isArray) return "array";
    if (v.isDatetime) return "datetime";
    return v.type;
  }

  // ---- table headers ----------------------------------------------------------------------------------------------------

  header(root) {
    const open = this.i;
    const isArray = this.s[this.i + 1] === "[";
    this.i += isArray ? 2 : 1;
    const { parts } = this.dottedKey();
    this.skipSpaces();
    if (isArray) {
      if (this.s[this.i] !== "]" || this.s[this.i + 1] !== "]") this.fail("expected `]]` to close the table header");
      this.i += 2;
    } else {
      if (this.s[this.i] !== "]") this.fail("expected `]` to close the table header");
      this.i += 1;
    }
    this.endOfStatement();
    let node = root;
    const fullPath = [];
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k];
      const lastPart = k === parts.length - 1;
      fullPath.push(part);
      let next = node.value[part];
      if (next && next.isArray && next.aot) {
        // descend into the last element of an array of tables
        if (lastPart && isArray) {
          const el = new Node("element");
          el.path = [...fullPath, next.items.length];
          next.items.push(el);
          this.addTable(fullPath, open, true);
          return el;
        }
        if (lastPart) this.fail(`table \`${parts.join(".")}\` is already an array of tables`, open);
        node = next.items[next.items.length - 1];
        fullPath.push(next.items.length - 1);
        continue;
      }
      if (next === undefined) {
        if (lastPart && isArray) {
          const arr = { isArray: true, aot: true, items: [] };
          const el = new Node("element");
          el.path = [...fullPath, 0];
          arr.items.push(el);
          node.value[part] = arr;
          this.addTable(fullPath, open, true);
          return el;
        }
        next = new Node(lastPart ? "explicit" : "implicit");
        next.path = [...fullPath];
        node.value[part] = next;
        if (lastPart) this.addTable(fullPath, open, false);
      } else if (next instanceof Node) {
        if (lastPart) {
          if (isArray) this.fail(`\`${parts.join(".")}\` is a table, not an array of tables`, open);
          if (next.kind === "implicit") { next.kind = "explicit"; this.addTable(fullPath, open, false); } else this.fail(`table \`${parts.join(".")}\` is defined more than once`, open);
        } else if (next.kind === "inline") this.fail(`cannot extend the inline table \`${fullPath.join(".")}\``, open);
      } else {
        this.fail(`key \`${fullPath.join(".")}\` is already defined as a value`, open);
      }
      node = next;
    }
    return node;
  }

  addTable(path, offset, array) {
    const { line, column } = this.position(offset);
    this.tables.push({ path: [...path], line, column, array });
  }

  // ---- values -----------------------------------------------------------------------------------------------------------

  value(path) {
    const c = this.peek();
    if (c === '"') {
      const text = this.s.startsWith('"""', this.i) ? this.multiBasic() : this.basicString(true);
      return { isScalar: true, type: "string", value: text };
    }
    if (c === "'") {
      const text = this.s.startsWith("'''", this.i) ? this.multiLiteral() : this.literalString(true);
      return { isScalar: true, type: "string", value: text };
    }
    if (c === "[") return this.array(path);
    if (c === "{") return this.inlineTable(path);
    if (this.s.startsWith("true", this.i) && !isBareKeyChar(this.s[this.i + 4] || "")) { this.i += 4; return { isScalar: true, type: "boolean", value: true }; }
    if (this.s.startsWith("false", this.i) && !isBareKeyChar(this.s[this.i + 5] || "")) { this.i += 5; return { isScalar: true, type: "boolean", value: false }; }
    return this.numberOrDate();
  }

  basicString(isValue) {
    const start = this.i;
    this.i++;
    let out = "";
    for (;;) {
      if (this.eof() || this.atNewline()) this.fail("unterminated string", start);
      const c = this.s[this.i];
      if (c === '"') { this.i++; return out; }
      if (c === "\\") { out += this.escape(); continue; }
      if (control(c)) this.fail("invalid control character in a string");
      out += c;
      this.i++;
    }
  }

  escape() {
    const at = this.i;
    this.i++;
    const c = this.s[this.i];
    this.i++;
    switch (c) {
      case "b": return "\b";
      case "t": return "\t";
      case "n": return "\n";
      case "f": return "\f";
      case "r": return "\r";
      case "e": return "\u001b";
      case '"': return '"';
      case "\\": return "\\";
      case "x": return this.codepoint(2, at);
      case "u": return this.codepoint(4, at);
      case "U": return this.codepoint(8, at);
      default: this.fail("invalid escape sequence", at);
    }
    return "";
  }

  codepoint(n, at) {
    const h = this.s.slice(this.i, this.i + n);
    if (h.length !== n || ![...h].every(hex)) this.fail("invalid unicode escape", at);
    const cp = parseInt(h, 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) this.fail("invalid unicode scalar value in an escape", at);
    this.i += n;
    return String.fromCodePoint(cp);
  }

  literalString() {
    const start = this.i;
    this.i++;
    let out = "";
    for (;;) {
      if (this.eof() || this.atNewline()) this.fail("unterminated string", start);
      const c = this.s[this.i];
      if (c === "'") { this.i++; return out; }
      if (control(c)) this.fail("invalid control character in a string");
      out += c;
      this.i++;
    }
  }

  multiBasic() {
    const start = this.i;
    this.i += 3;
    if (this.s[this.i] === "\n") this.i++;
    else if (this.s[this.i] === "\r" && this.s[this.i + 1] === "\n") this.i += 2;
    let out = "";
    for (;;) {
      if (this.eof()) this.fail("unterminated multi-line string", start);
      const c = this.s[this.i];
      if (c === '"' && this.s.startsWith('"""', this.i)) {
        // up to two more quotes belong to the string
        let extra = 0;
        while (this.s[this.i + 3 + extra] === '"' && extra < 2) extra++;
        out += '"'.repeat(extra);
        this.i += 3 + extra;
        return out;
      }
      if (c === "\\") {
        // a line ending backslash trims the whitespace and newlines that follow
        let j = this.i + 1;
        while (this.s[j] === " " || this.s[j] === "\t") j++;
        if (this.s[j] === "\n" || (this.s[j] === "\r" && this.s[j + 1] === "\n")) {
          this.i = j;
          while (this.s[this.i] === " " || this.s[this.i] === "\t" || this.s[this.i] === "\n" || (this.s[this.i] === "\r" && this.s[this.i + 1] === "\n")) this.i += this.s[this.i] === "\r" ? 2 : 1;
          continue;
        }
        out += this.escape();
        continue;
      }
      if (c === "\r") {
        if (this.s[this.i + 1] !== "\n") this.fail("a carriage return must be followed by a line feed");
        out += "\n";
        this.i += 2;
        continue;
      }
      if (control(c) && c !== "\n") this.fail("invalid control character in a string");
      out += c;
      this.i++;
    }
  }

  multiLiteral() {
    const start = this.i;
    this.i += 3;
    if (this.s[this.i] === "\n") this.i++;
    else if (this.s[this.i] === "\r" && this.s[this.i + 1] === "\n") this.i += 2;
    let out = "";
    for (;;) {
      if (this.eof()) this.fail("unterminated multi-line string", start);
      const c = this.s[this.i];
      if (c === "'" && this.s.startsWith("'''", this.i)) {
        let extra = 0;
        while (this.s[this.i + 3 + extra] === "'" && extra < 2) extra++;
        out += "'".repeat(extra);
        this.i += 3 + extra;
        return out;
      }
      if (c === "\r") {
        if (this.s[this.i + 1] !== "\n") this.fail("a carriage return must be followed by a line feed");
        out += "\n";
        this.i += 2;
        continue;
      }
      if (control(c) && c !== "\n") this.fail("invalid control character in a string");
      out += c;
      this.i++;
    }
  }

  array(path) {
    const start = this.i;
    this.i++;
    const items = [];
    for (;;) {
      this.skipBlank();
      if (this.eof()) this.fail("unterminated array", start);
      if (this.peek() === "]") { this.i++; return { isArray: true, aot: false, items }; }
      items.push(this.value([...path, items.length]));
      this.skipBlank();
      if (this.peek() === ",") { this.i++; continue; }
      if (this.peek() === "]") continue;
      if (this.eof()) this.fail("unterminated array", start);
      this.fail("expected `,` or `]` in an array");
    }
  }

  inlineTable(path) {
    const start = this.i;
    this.i++;
    const node = new Node("inline");
    node.path = [...path];
    // Codex's reader accepts newlines, comments and a trailing comma in an inline table (TOML 1.1)
    this.skipBlank();
    if (this.peek() === "}") { this.i++; return node; }
    for (;;) {
      this.skipBlank();
      if (this.eof()) this.fail("unclosed inline table, expected `}`", start);
      if (this.peek() === "}") { this.i++; return node; }
      const { parts, at } = this.dottedKey();
      this.skipSpaces();
      if (this.peek() !== "=") this.fail("key with no value, expected `=`");
      this.i++;
      this.skipSpaces();
      let target = node;
      const sofar = [...path];
      for (let k = 0; k < parts.length - 1; k++) {
        sofar.push(parts[k]);
        let next = target.value[parts[k]];
        if (next === undefined) { next = new Node("dotted"); next.path = [...sofar]; target.value[parts[k]] = next; }
        else if (!(next instanceof Node) || next.kind === "inline") this.fail(`key \`${parts[k]}\` is already defined`, at);
        target = next;
      }
      const last = parts[parts.length - 1];
      if (last in target.value) this.fail(`duplicate key \`${last}\``, at);
      const here = this.position(at);
      const v = this.value([...sofar, last]);
      target.value[last] = v;
      this.entries.push({ path: [...path, ...parts], line: here.line, column: here.column, type: this.typeOf(v), value: this.plainValue(v), offset: at });
      this.skipBlank();
      if (this.peek() === ",") { this.i++; continue; }
      if (this.peek() === "}") { this.i++; return node; }
      if (this.eof()) this.fail("unclosed inline table, expected `}`", start);
      this.fail("expected `,` or `}` in an inline table");
    }
  }

  numberOrDate() {
    const start = this.i;
    const rest = this.s.slice(this.i, this.i + 64);
    // dates and times first: 1979-05-27, 07:32:00, 1979-05-27T07:32:00Z, 1979-05-27 07:32:00.5+01:00
    let m = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/.exec(rest);
    if (!m) m = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/.exec(rest);
    if (m && (/^\d{4}-/.test(rest) || /^\d{2}:/.test(rest))) {
      let text = m[0];
      // "1979-05-27 07:32" needs a digit after the space; a lone date followed by a space and a comment is a date
      if (/^\d{4}-\d{2}-\d{2} $/.test(text)) text = text.trimEnd();
      const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
      if (date) {
        const mo = Number(date[2]);
        const d = Number(date[3]);
        const days = [31, (Number(date[1]) % 4 === 0 && (Number(date[1]) % 100 !== 0 || Number(date[1]) % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
        if (mo < 1 || mo > 12 || d < 1 || d > days) this.fail("invalid date", start);
      }
      const time = /(\d{2}):(\d{2})(?::(\d{2}))?/.exec(text.slice(date ? 10 : 0));
      if (time && (Number(time[1]) > 23 || Number(time[2]) > 59 || (time[3] !== undefined && Number(time[3]) > 60))) this.fail("invalid time", start);
      this.i += text.length;
      return { isDatetime: true, text };
    }
    // numbers
    m = /^[+-]?(?:inf|nan)(?![A-Za-z0-9_])/.exec(rest);
    if (m) { this.i += m[0].length; return { isScalar: true, type: "float", value: m[0].includes("nan") ? NaN : m[0].startsWith("-") ? -Infinity : Infinity }; }
    m = /^0x[0-9a-fA-F]+(?:_[0-9a-fA-F]+)*(?![A-Za-z0-9_])/.exec(rest);
    if (m) { this.i += m[0].length; return { isScalar: true, type: "integer", value: Number(`0x${m[0].slice(2).replace(/_/g, "")}`) }; }
    m = /^0o[0-7]+(?:_[0-7]+)*(?![A-Za-z0-9_])/.exec(rest);
    if (m) { this.i += m[0].length; return { isScalar: true, type: "integer", value: parseInt(m[0].slice(2).replace(/_/g, ""), 8) }; }
    m = /^0b[01]+(?:_[01]+)*(?![A-Za-z0-9_])/.exec(rest);
    if (m) { this.i += m[0].length; return { isScalar: true, type: "integer", value: parseInt(m[0].slice(2).replace(/_/g, ""), 2) }; }
    m = /^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?(?![A-Za-z0-9_.])/.exec(rest);
    if (m) {
      const text = m[0].replace(/_/g, "");
      const isFloat = /[.eE]/.test(text);
      this.i += m[0].length;
      return { isScalar: true, type: isFloat ? "float" : "integer", value: Number(text) };
    }
    const c = this.s[this.i];
    if (c === undefined || c === "\n" || c === "\r") this.fail("missing value after `=`");
    if (isDigit(c) || c === "+" || c === "-") this.fail("invalid number", start);
    this.fail(`invalid value, found \`${c}\``, start);
    return null;
  }
}

/** Reads TOML text. A leading byte order mark is skipped, and CRLF line endings are accepted, as Codex does. */
export function parseToml(text) {
  const parser = new Parser(String(text));
  try {
    const { value } = parser.parse();
    return { ok: true, value, entries: parser.entries, tables: parser.tables };
  } catch (e) {
    if (!(e instanceof TomlError)) throw e;
    const { line, column } = parser.position(Math.min(e.offset ?? parser.i, parser.s.length));
    return { ok: false, error: { message: e.message, line, column } };
  }
}
