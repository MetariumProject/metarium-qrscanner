// Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parse, format, isMetariumURI, pctEncode, pctDecode, roomURL, roomFor,
  normalizeRegistry, normalizeRoomHost, chainName, MetariumURIError,
} from "../lib/metarium-uri.mjs";

const G = "0x93e11e6aa35ca9ff3e73cb99e5da6cf4bea733326a214d490d0c4fbf72451394";
const K = "blake3://" + "ab".repeat(32);

const code = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof MetariumURIError, `expected MetariumURIError, got ${e}`);
    return e.code;
  }
  assert.fail("expected a MetariumURIError");
};

test("minimal URI round-trips", () => {
  const uri = `metarium://${G}/7/graph/notes.yobj`;
  const r = parse(uri);
  assert.equal(r.genesis, G);
  assert.equal(r.channel, 7);
  assert.equal(r.path, "/graph/notes.yobj");
  assert.equal(r.kuri, null);
  assert.equal(r.label, null);
  assert.deepEqual(r.extra, []);
  assert.equal(r.canonical, uri);
  assert.equal(format(r), uri);
});

test("full URI: label and kuri, canonical order ?l=…#kuri", () => {
  const uri = `metarium://${G}/12/a/b%20c/d.yobj?l=Pongal%20ident#${K}`;
  const r = parse(uri);
  assert.equal(r.path, "/a/b c/d.yobj");
  assert.equal(r.label, "Pongal ident");
  assert.equal(r.kuri, K);
  assert.equal(r.canonical, uri);
});

test("legacy order #kuri?l=… parses to the same canonical URI", () => {
  const a = parse(`metarium://${G}/12/x?l=Hi#${K}`);
  const b = parse(`metarium://${G}/12/x#${K}?l=Hi`);
  assert.deepEqual(b, a);
});

test("Tamil path and label are UTF-8 percent-encoded, uppercase hex", () => {
  const ref = { genesis: G, channel: 5, path: "/இயல்கொடி/தொலைக்காட்சி", label: "இயல்கொடி TV" };
  const uri = format(ref);
  assert.match(uri, /^metarium:\/\/0x[0-9a-f]{64}\/5\/(%[0-9A-F]{2})+\/(%[0-9A-F]{2})+\?l=(%[0-9A-F]{2})+%20TV$/);
  const r = parse(uri);
  assert.equal(r.path, ref.path);
  assert.equal(r.label, ref.label);
  assert.equal(r.canonical, uri);
});

test("parser normalises: scheme/genesis/kuri case, lowercase %xx, literal sub-delims", () => {
  const messy = `METARIUM://${G.toUpperCase().replace("0X", "0x")}/3/a%c3%a9/b:c@d?l=x%2by#${K.toUpperCase().replace("BLAKE3", "blake3")}`;
  const r = parse(messy);
  assert.equal(r.path, "/aé/b:c@d");
  assert.equal(r.label, "x+y");
  assert.equal(r.canonical, `metarium://${G}/3/a%C3%A9/b%3Ac%40d?l=x%2By#${K}`);
});

test("'+' in a label is a plus, not a space", () => {
  assert.equal(parse(`metarium://${G}/1/a?l=a+b`).label, "a+b");
});

test("trailing slash (a folder) is preserved", () => {
  const uri = `metarium://${G}/1/lists/iyalkodi/`;
  assert.equal(parse(uri).path, "/lists/iyalkodi/");
  assert.equal(parse(uri).canonical, uri);
});

test("unknown query parameters are kept in order and re-emitted after l", () => {
  const r = parse(`metarium://${G}/1/a?zz=1&l=L&v=two%20words`);
  assert.deepEqual(r.extra, [["zz", "1"], ["v", "two words"]]);
  assert.equal(r.canonical, `metarium://${G}/1/a?l=L&zz=1&v=two%20words`);
});

test("empty label and empty fragment are dropped", () => {
  assert.equal(parse(`metarium://${G}/1/a?l=#`).canonical, `metarium://${G}/1/a`);
});

test("surrounding whitespace (scanner noise) is ignored", () => {
  assert.equal(parse(`  metarium://${G}/1/a\n`).canonical, `metarium://${G}/1/a`);
});

test("rejections carry a code", () => {
  const cases = [
    ["https://example.com/a", "scheme"],
    [`metarium://0x1234/1/a`, "genesis"],
    [`metarium://${G.slice(2)}/1/a`, "genesis"],
    [`metarium://user@${G}/1/a`, "genesis"],
    [`metarium://${G}:80/1/a`, "genesis"],
    [`metarium://${G}`, "channel"],
    [`metarium://${G}/01/a`, "channel"],
    [`metarium://${G}/-1/a`, "channel"],
    [`metarium://${G}/4294967296/a`, "channel"],
    [`metarium://${G}/1`, "path"],
    [`metarium://${G}/1/`, "path"],
    [`metarium://${G}/1/a//b`, "path"],
    [`metarium://${G}/1/a/../b`, "path"],
    [`metarium://${G}/1/a%2Fb`, "path"],
    [`metarium://${G}/1/a b`, "path"],
    [`metarium://${G}/1/a%zz`, "encoding"],
    [`metarium://${G}/1/a%ff`, "encoding"],
    [`metarium://${G}/1/a#sha256://00`, "kuri"],
    [`metarium://${G}/1/a#blake3://abc`, "kuri"],
    [`metarium://${G}/1/a#${K}#x`, "kuri"],
    [`metarium://${G}/1/a?l=1&l=2`, "query"],
    [`metarium://${G}/1/a?L=1`, "query"],
    [`metarium://${G}/1/a?l=a b`, "query"],
    [`metarium://${G}/1/a?l=${"x".repeat(257)}`, "label"],
    [`metarium://${G}/1/${"a".repeat(2100)}`, "length"],
  ];
  for (const [uri, want] of cases) {
    assert.equal(code(() => parse(uri)), want, uri);
    assert.equal(isMetariumURI(uri), false);
  }
});

test("format validates its input too", () => {
  assert.equal(code(() => format({ genesis: G, channel: 1, path: "a" })), "path");
  assert.equal(code(() => format({ genesis: G, channel: 1.5, path: "/a" })), "channel");
  assert.equal(code(() => format({ genesis: G, channel: 1, path: "/a", kuri: "nope" })), "kuri");
  assert.equal(code(() => format({ genesis: G, channel: 1, path: "/a", extra: [["l", "x"]] })), "query");
});

test("pctEncode/pctDecode", () => {
  assert.equal(pctEncode("A-z_0.9~"), "A-z_0.9~");
  assert.equal(pctEncode("a/b c"), "a%2Fb%20c");
  assert.equal(pctEncode("😀"), "%F0%9F%98%80");
  assert.equal(pctDecode("%F0%9F%98%80", "t"), "😀");
});

test("room URL", () => {
  const ref = parse(`metarium://${G}/7/a%20b/c.yobj?l=x#${K}`);
  assert.equal(
    roomURL("http://localhost:8378", ref),
    `http://localhost:8378/metarium/${G}/7/a%20b/c.yobj?kuri=blake3%3A%2F%2F${"ab".repeat(32)}`,
  );
  assert.equal(roomURL("http://127.0.0.1:8377/", { genesis: G, channel: 1, path: "/a" }),
    `http://127.0.0.1:8377/metarium/${G}/1/a`);
});

test("room hosts: loopback http, any https, nothing else", () => {
  assert.equal(normalizeRoomHost("http://localhost:8378"), "http://localhost:8378");
  assert.equal(normalizeRoomHost("http://[::1]:8378/"), "http://[::1]:8378");
  assert.equal(normalizeRoomHost("https://room.example.org"), "https://room.example.org");
  for (const bad of ["http://example.org", "http://192.168.1.2:8378", "javascript:alert(1)",
    "https://a.org/path", "https://u:p@a.org", "ftp://localhost", "localhost:8378"]) {
    assert.equal(code(() => normalizeRoomHost(bad)), "registry", bad);
  }
});

test("registry: normalise keys, drop bad entries, wildcard fallback", () => {
  const { registry, rejected } = normalizeRegistry({
    [G.toUpperCase().replace("0X", "0x")]: "http://localhost:8378",
    "*": "http://127.0.0.1:8377",
    "0xnope": "http://localhost:1",
    ["0x" + "1".repeat(64)]: "http://evil.example",
  });
  assert.deepEqual(registry, { [G]: "http://localhost:8378", "*": "http://127.0.0.1:8377" });
  assert.equal(rejected.length, 2);
  assert.equal(roomFor(registry, G), "http://localhost:8378");
  assert.equal(roomFor(registry, "0x" + "2".repeat(64)), "http://127.0.0.1:8377");
  assert.equal(roomFor({}, G), null);
  assert.deepEqual(normalizeRegistry(null), { registry: {}, rejected: [] });
});

test("known chain names", () => {
  assert.equal(chainName(G), "mummai");
  assert.equal(chainName("0x" + "0".repeat(64)), null);
  assert.equal(chainName("junk"), null);
});
