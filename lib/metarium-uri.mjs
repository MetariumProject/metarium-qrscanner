// metarium-uri.mjs — reference parse/format for metarium:// URIs.
// The normative text is SPEC.md; this file follows it section by section.
// Plain ES module, no dependencies, works in browsers and in Node >= 18.
// License: Apache-2.0.

export const SCHEME = "metarium";
export const MAX_URI_LENGTH = 2048;
export const MAX_LABEL_LENGTH = 256; // decoded characters (SPEC §3.5)

const GENESIS_RE = /^0x[0-9a-f]{64}$/;
const KURI_RE = /^blake3:\/\/[0-9a-f]{64}$/;
const CHANNEL_RE = /^(0|[1-9][0-9]*)$/;
const UNRESERVED_RE = /^[A-Za-z0-9\-._~]$/;
// Characters a parser accepts literally inside a path segment (RFC 3986 pchar).
const PCHAR_LITERAL_RE = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]*$/;
// …and inside the query (pchar plus "/" and "?"); "&" and "=" are structural there.
const QUERY_LITERAL_RE = /^[A-Za-z0-9\-._~!$'()*+,;:@/?]*$/;
const BAD_ESCAPE_RE = /%(?![0-9A-Fa-f]{2})/;
const PARAM_KEY_RE = /^[a-z][a-z0-9_-]*$/;

export class MetariumURIError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MetariumURIError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new MetariumURIError(code, message);
}

// ---------------------------------------------------------------------------
// Percent-encoding (SPEC §4)

/** Canonical encoding: UTF-8, every byte outside ALPHA / DIGIT / "-._~" as %XX (uppercase). */
export function pctEncode(text) {
  if (typeof text !== "string") fail("type", "expected a string");
  let out = "";
  for (const ch of text) {
    if (UNRESERVED_RE.test(ch)) {
      out += ch;
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp >= 0xd800 && cp <= 0xdfff) fail("encoding", "lone surrogate in text");
    for (const b of new TextEncoder().encode(ch)) {
      out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/** Strict decode: %XX must be well formed and the bytes must be valid UTF-8. */
export function pctDecode(text, where) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "%") {
      const hex = text.slice(i + 1, i + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) fail("encoding", `malformed percent-escape in ${where}`);
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      const cp = c.charCodeAt(0);
      if (cp > 0x7e || cp < 0x21) fail("encoding", `character ${JSON.stringify(c)} must be percent-encoded in ${where}`);
      bytes.push(cp);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    fail("encoding", `${where} is not valid UTF-8 after decoding`);
  }
}

// ---------------------------------------------------------------------------
// Field validation (SPEC §3)

export function normalizeGenesis(genesis) {
  if (typeof genesis !== "string") fail("genesis", "genesis must be a string");
  const g = genesis.toLowerCase();
  if (!GENESIS_RE.test(g)) fail("genesis", "genesis must be 0x followed by 64 hex digits");
  return g;
}

export function normalizeChannel(channel) {
  const s = typeof channel === "number" ? String(channel) : channel;
  if (typeof s !== "string" || !CHANNEL_RE.test(s)) {
    fail("channel", "channel must be a non-negative decimal integer without leading zeros");
  }
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n > 0xffffffff) fail("channel", "channel must be at most 4294967295");
  return n;
}

export function normalizeKuri(kuri) {
  if (typeof kuri !== "string") fail("kuri", "kuri must be a string");
  const k = kuri.toLowerCase();
  if (!KURI_RE.test(k)) fail("kuri", "kuri must be blake3:// followed by 64 hex digits");
  return k;
}

/** Validate a decoded lookup path ("/a/b/c" or "/a/b/") and return its segments. */
export function pathSegments(path) {
  if (typeof path !== "string" || !path.startsWith("/")) fail("path", "path must start with /");
  const segs = path.slice(1).split("/");
  const trailingSlash = segs.length > 1 && segs[segs.length - 1] === "";
  if (trailingSlash) segs.pop();
  if (segs.length === 0 || (segs.length === 1 && segs[0] === "")) fail("path", "path must name at least one segment");
  for (const s of segs) {
    if (s === "") fail("path", "path must not contain empty segments (//)");
    if (s === "." || s === "..") fail("path", "path must not contain . or .. segments");
  }
  return { segs, trailingSlash };
}

function encodePath(path) {
  const { segs, trailingSlash } = pathSegments(path);
  return "/" + segs.map(pctEncode).join("/") + (trailingSlash ? "/" : "");
}

// ---------------------------------------------------------------------------
// format (SPEC §5)

/**
 * Build the canonical URI.
 * @param {{genesis:string, channel:number|string, path:string, kuri?:string|null,
 *          label?:string|null, extra?:Array<[string,string]>}} ref
 */
export function format(ref) {
  if (!ref || typeof ref !== "object") fail("type", "expected an object");
  const genesis = normalizeGenesis(ref.genesis);
  const channel = normalizeChannel(ref.channel);
  let uri = `${SCHEME}://${genesis}/${channel}${encodePath(ref.path)}`;

  const params = [];
  if (ref.label != null && ref.label !== "") {
    if (typeof ref.label !== "string") fail("label", "label must be a string");
    if ([...ref.label].length > MAX_LABEL_LENGTH) fail("label", `label must be at most ${MAX_LABEL_LENGTH} characters`);
    params.push(["l", ref.label]);
  }
  for (const [k, v] of ref.extra || []) {
    if (!PARAM_KEY_RE.test(k) || k === "l") fail("query", `bad extra parameter name ${JSON.stringify(k)}`);
    params.push([k, String(v)]);
  }
  if (params.length) uri += "?" + params.map(([k, v]) => `${k}=${pctEncode(v)}`).join("&");
  if (ref.kuri != null && ref.kuri !== "") uri += "#" + normalizeKuri(ref.kuri);
  if (uri.length > MAX_URI_LENGTH) fail("length", `URI is longer than ${MAX_URI_LENGTH} characters`);
  return uri;
}

// ---------------------------------------------------------------------------
// parse (SPEC §6)

/**
 * Parse a metarium:// URI. Returns
 * {genesis, channel, path, kuri, label, extra, canonical}; throws MetariumURIError.
 */
export function parse(input) {
  if (typeof input !== "string") fail("type", "expected a string");
  const text = input.trim();
  if (text.length > MAX_URI_LENGTH) fail("length", `URI is longer than ${MAX_URI_LENGTH} characters`);
  const prefix = SCHEME + "://";
  if (text.slice(0, prefix.length).toLowerCase() !== prefix) fail("scheme", "not a metarium:// URI");
  let rest = text.slice(prefix.length);

  // Split off query and fragment. Canonical order is ?query#fragment (RFC 3986).
  // The order written as #kuri?l=… is accepted too (SPEC §6 step 2): a kuri never contains "?".
  let query = null;
  let fragment = null;
  const hashAt = rest.indexOf("#");
  const qAt = rest.indexOf("?");
  if (hashAt !== -1 && (qAt === -1 || hashAt < qAt)) {
    fragment = rest.slice(hashAt + 1);
    rest = rest.slice(0, hashAt);
    const fq = fragment.indexOf("?");
    if (fq !== -1) {
      query = fragment.slice(fq + 1);
      fragment = fragment.slice(0, fq);
    }
  } else if (qAt !== -1) {
    query = rest.slice(qAt + 1);
    rest = rest.slice(0, qAt);
    const qh = query.indexOf("#");
    if (qh !== -1) {
      fragment = query.slice(qh + 1);
      query = query.slice(0, qh);
    }
  }
  if (fragment !== null && fragment.includes("#")) fail("kuri", "more than one #");

  // Authority = genesis, then /channel, then /path…
  const slash1 = rest.indexOf("/");
  if (slash1 === -1) fail("channel", "missing /<channel>/<path> after the genesis");
  const authority = rest.slice(0, slash1);
  if (authority.includes("@") || authority.includes(":")) fail("genesis", "genesis must not carry userinfo or a port");
  const genesis = normalizeGenesis(authority);
  rest = rest.slice(slash1 + 1);
  const slash2 = rest.indexOf("/");
  if (slash2 === -1) fail("path", "missing /<path> after the channel");
  const channel = normalizeChannel(rest.slice(0, slash2));
  const rawPath = rest.slice(slash2); // starts with "/"

  const rawSegs = rawPath.slice(1).split("/");
  const decoded = rawSegs.map((seg, i) => {
    if (BAD_ESCAPE_RE.test(seg)) fail("encoding", "malformed percent-escape in path");
    if (!PCHAR_LITERAL_RE.test(seg.replace(/%[0-9A-Fa-f]{2}/g, ""))) {
      fail("path", `path segment ${i + 1} has a character that must be percent-encoded`);
    }
    const d = pctDecode(seg, "path");
    if (d.includes("/")) fail("path", "a path segment must not contain an encoded / (%2F)");
    return d;
  });
  const path = "/" + decoded.join("/");
  pathSegments(path); // structural checks

  let kuri = null;
  if (fragment !== null && fragment !== "") kuri = normalizeKuri(fragment);

  let label = null;
  const extra = [];
  if (query !== null && query !== "") {
    const seen = new Set();
    for (const pair of query.split("&")) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const rawVal = eq === -1 ? "" : pair.slice(eq + 1);
      if (!PARAM_KEY_RE.test(key)) fail("query", `bad query parameter name ${JSON.stringify(key)}`);
      if (seen.has(key)) fail("query", `query parameter ${key} appears twice`);
      seen.add(key);
      if (BAD_ESCAPE_RE.test(rawVal)) fail("encoding", `malformed percent-escape in query parameter ${key}`);
      if (!QUERY_LITERAL_RE.test(rawVal.replace(/%[0-9A-Fa-f]{2}/g, ""))) {
        fail("query", `query parameter ${key} has a character that must be percent-encoded`);
      }
      const val = pctDecode(rawVal, `query parameter ${key}`);
      if (key === "l") {
        if ([...val].length > MAX_LABEL_LENGTH) fail("label", `label must be at most ${MAX_LABEL_LENGTH} characters`);
        label = val === "" ? null : val;
      } else {
        extra.push([key, val]);
      }
    }
  }

  const ref = { genesis, channel, path, kuri, label, extra };
  ref.canonical = format(ref);
  return ref;
}

/** True when the string parses; never throws. */
export function isMetariumURI(text) {
  try {
    parse(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rooms (SPEC §7, §8)

/**
 * Validate a room base URL from a registry. Returns the origin string or throws.
 * http:// only for loopback hosts; https:// for any host. No path, query, fragment or userinfo.
 */
export function normalizeRoomHost(host) {
  if (typeof host !== "string") fail("registry", "room host must be a string");
  let u;
  try {
    u = new URL(host);
  } catch {
    fail("registry", "room host is not a URL");
  }
  if (u.username || u.password) fail("registry", "room host must not carry credentials");
  if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) {
    fail("registry", "room host must be an origin (no path, query or fragment)");
  }
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:") {
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost")) return u.origin;
    fail("registry", "http:// room hosts must be loopback (localhost, 127.0.0.1, [::1])");
  }
  fail("registry", "room host must be http(s)");
}

/**
 * Clean a registry object: lowercase genesis keys (or "*"), valid hosts only.
 * Returns {registry, rejected:[{key, reason}]}.
 */
export function normalizeRegistry(obj) {
  const registry = {};
  const rejected = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { registry, rejected };
  for (const [key, host] of Object.entries(obj)) {
    try {
      const k = key === "*" ? "*" : normalizeGenesis(key);
      registry[k] = normalizeRoomHost(host);
    } catch (e) {
      rejected.push({ key, reason: e.message });
    }
  }
  return { registry, rejected };
}

/** The room host for a genesis: exact entry first, then "*". */
export function roomFor(registry, genesis) {
  const g = normalizeGenesis(genesis);
  return registry[g] || registry["*"] || null;
}

/** <host>/metarium/<genesis>/<channel>/<path>[?kuri=…] — the URL a room resolves. */
export function roomURL(host, ref) {
  const origin = normalizeRoomHost(host);
  const genesis = normalizeGenesis(ref.genesis);
  const channel = normalizeChannel(ref.channel);
  let url = `${origin}/metarium/${genesis}/${channel}${encodePath(ref.path)}`;
  if (ref.kuri) url += "?kuri=" + pctEncode(normalizeKuri(ref.kuri));
  return url;
}

// ---------------------------------------------------------------------------
// Known chains (display only — never used to resolve anything)

export const KNOWN_CHAINS = Object.freeze({
  "0x93e11e6aa35ca9ff3e73cb99e5da6cf4bea733326a214d490d0c4fbf72451394": "mummai",
});

export function chainName(genesis) {
  try {
    return KNOWN_CHAINS[normalizeGenesis(genesis)] || null;
  } catch {
    return null;
  }
}
