# The `metarium://` URI scheme

Status: draft 1, 2026-11-19. This file is the canonical spec; other software cites it by section number.
Reference implementation: [`lib/metarium-uri.mjs`](lib/metarium-uri.mjs), tests in [`tests/`](tests/).

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. Purpose

A `metarium://` URI names one yObj (or folder) in a book on a Metarium chain, independent of any host
that serves it. It is meant to be printed (most often as a QR code), copied between books and chains, and
resolved by whatever *room* the reader trusts (for example their own mnem Reading Room on localhost).

The URI carries no host. Nothing about it requires, or points at, a server.

## 2. Syntax

```
metarium://<genesis>/<channel>/<path>[?l=<label>][#<kuri>]
```

ABNF (RFC 5234; `ALPHA`, `DIGIT`, `HEXDIG` from RFC 5234, `pct-encoded`, `unreserved` from RFC 3986):

```
metarium-uri = scheme "://" genesis "/" channel path [ "?" query ] [ "#" kuri ]
scheme       = "metarium"                       ; case-insensitive on input
genesis      = "0x" 64HEXDIG                    ; case-insensitive on input
channel      = "0" / ( %x31-39 *DIGIT )         ; no leading zeros
path         = 1*( "/" segment ) [ "/" ]        ; trailing "/" names a folder
segment      = 1*( unreserved / pct-encoded / sub-delims / ":" / "@" )
query        = param *( "&" param )
param        = key "=" value
key          = %x61-7A *( %x61-7A / DIGIT / "_" / "-" )   ; lowercase
value        = *( unreserved / pct-encoded / "!" / "$" / "'" / "(" / ")" / "*" / "+" / "," / ";" / ":" / "@" / "/" / "?" )
kuri         = "blake3://" 64HEXDIG             ; case-insensitive on input
```

Example (mummai, channel 7, with label and version pin):

```
metarium://0x93e11e6aa35ca9ff3e73cb99e5da6cf4bea733326a214d490d0c4fbf72451394/7/graph/notes/2026-11-19.yobj?l=Notes%2019%20Nov#blake3://<64 hex>
```

## 3. Components

### 3.1 genesis
The chain's genesis block hash: `0x` and 64 hex digits. It identifies the chain, not a node or a host.
Canonical form is lowercase. Example: mummai is
`0x93e11e6aa35ca9ff3e73cb99e5da6cf4bea733326a214d490d0c4fbf72451394`.

### 3.2 channel
The channel number on that chain, a decimal integer from 0 to 4294967295, written without sign or leading zeros.

### 3.3 path
The yObj's lookup path in that channel's book, as the book stores it: it begins with `/`, segments are
separated by `/`. A trailing `/` names a folder and is preserved. Paths are case-sensitive.
A path MUST NOT contain empty segments (`//`), `.` or `..` segments, or a segment whose decoded text
contains `/` (so `%2F` inside a segment is an error).

### 3.4 kuri (fragment, optional)
A version pin: `blake3://` and the 64-hex BLAKE3 digest of the exact bytes intended. Without it, the URI
means "the current version at this path". Canonical form is lowercase. It travels in the fragment, so a
resolver that ignores it still finds the path, and it is never sent to a web server as part of a URL path.

### 3.5 label (`l` query parameter, optional, opt-in)
A human-readable label carried inside the QR so a scanner can show what it is before resolving anything.
It is **opt-in**: anything in the label is printed on the code and readable by anyone who scans it.
Producers MUST NOT add a label unless the person asked for one. Decoded length at most 256 characters;
SHOULD be under 64 to keep codes small. The label is display text only: it MUST NOT be used to resolve.

### 3.6 other query parameters
Reserved for future versions. Parsers MUST keep unknown parameters (name and decoded value, in order) and
MUST NOT fail on them; formatters re-emit them after `l`. A parameter name appearing twice is an error.

### 3.7 length
A URI MUST be at most 2048 characters. Producers SHOULD stay under 300 so the QR stays scannable
when printed small.

## 4. Percent-encoding

Path segments and query values are UTF-8 text, percent-encoded.

- **Canonical (what formatters emit):** every byte outside `unreserved` (`A–Z a–z 0–9 - . _ ~`) is encoded
  as `%XX` with **uppercase** hex. So a space is `%20`, `:` is `%3A`, `/` inside a segment would be `%2F`
  (and is then rejected, §3.3), Tamil text is its UTF-8 bytes.
- **Lenient (what parsers accept):** lowercase hex in escapes; the literal characters the ABNF allows
  (for example `:` `@` `+` in a segment). `+` is a literal plus, never a space.
- **Errors:** a `%` not followed by two hex digits; decoded bytes that are not valid UTF-8; any character
  outside printable ASCII (`%x21-7E`) left unencoded (spaces included).

The canonical URI is therefore pure ASCII, which keeps QR codes in byte mode with no charset ambiguity.

## 5. Formatting

`format(ref)` produces the **canonical** URI:

1. `metarium://`, then genesis in lowercase.
2. `/`, then the channel in decimal.
3. The path, each segment canonically encoded (§4), trailing `/` kept.
4. If a label or other parameters are present: `?`, then `l=<value>` first, then the others in their
   original order, joined by `&`.
5. If a kuri is present: `#` and the kuri in lowercase.

**Ordering is query before fragment** (RFC 3986). The decision text of 2026-11-19 wrote `[#<kuri>][?l=<label>]`;
parsers accept that order (§6, step 2) but formatters never emit it.

## 6. Parsing

`parse(text)`:

1. Trim surrounding whitespace (scanners add newlines). Reject if longer than 2048 characters.
   Check the scheme prefix `metarium://` case-insensitively.
2. Split off the query and fragment. If `#` comes before any `?`, the fragment ends at the first `?`
   after it and the rest is the query (the legacy `#kuri?l=…` order; a kuri never contains `?`).
   Otherwise split at the first `?`, and the query ends at the first `#`. More than one `#` is an error.
3. Up to the first `/` is the genesis; it MUST NOT contain `@` or `:`. Validate and lowercase it.
4. Up to the next `/` is the channel. Validate it.
5. The rest (starting with `/`) is the path. Split on `/`, check literal characters, decode each segment,
   reject `/` in a decoded segment, then apply §3.3.
6. Validate and lowercase the kuri if the fragment is non-empty. An empty fragment is ignored.
7. Split the query on `&`; each `key=value` with a lowercase key; decode values. `l` becomes the label
   (empty means none). Others are kept (§3.6).
8. Return `{genesis, channel, path, kuri, label, extra, canonical}` where `canonical = format(...)`.

A conforming parser yields the same result for any spelling of the same URI, and
`parse(format(ref))` returns `ref` for every valid `ref`.

## 7. Resolving in a room

A *room* is a program the reader runs (or trusts) that can read books. A room that resolves `metarium://`
URIs serves:

```
GET <room-origin>/metarium/<genesis>/<channel>/<path>[?kuri=<kuri, percent-encoded>]
```

- `<genesis>`, `<channel>`, `<path>` are written exactly as in the canonical URI (§5).
- The kuri moves from the fragment into the `kuri` query parameter, percent-encoded
  (`blake3%3A%2F%2F<hex>`); a room decodes query values normally, so it receives `blake3://<hex>`.
- The label is not sent. It is display text only.

What the room does with the request (show the yObj, ask the person to join the book, say the chain is
unknown) is the room's business; this spec only fixes the URL.

## 8. Registry contract (browser extension → scanner page)

A scanner page knows no rooms of its own. A browser extension the person installed MAY tell it which room
serves which chain. The registry maps genesis to room origin:

```json
{ "0x93e11e6aa35ca9ff3e73cb99e5da6cf4bea733326a214d490d0c4fbf72451394": "http://localhost:8378",
  "*": "http://localhost:8378" }
```

- Keys are genesis hashes (any case; the page lowercases them) or `"*"`, a fallback for any chain.
- Values are **origins** only: no path, query, fragment or credentials. `http://` is accepted only for
  loopback hosts (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`); `https://` for any host. The page
  drops entries that do not meet this and MAY show what it dropped.
- Lookup: the exact genesis first, then `"*"`.

Two ways to deliver it; a page MUST support both and merge them (later entries win):

1. **Global.** Before or after the page loads, set `window.metariumRegistry` in the page's main world (for
   example a content script with `world: "MAIN"`). The page reads it at start and again whenever it
   receives the event in (2) or the person scans.
2. **postMessage** (preferred; works from an isolated-world content script and is not blocked by the
   page's Content-Security-Policy):
   ```js
   window.postMessage({ type: "metarium:registry", version: 1, registry: { "<genesis>": "<origin>" } },
                      window.location.origin);
   ```
   The page accepts it only when `event.source === window` and `event.origin === location.origin`.

On start the page announces itself once, so an extension can answer instead of guessing the timing:

```js
window.postMessage({ type: "metarium:registry-request", version: 1 }, window.location.origin);
```

The page never fetches the room, never probes localhost, and never navigates on its own: when a room is
known for the scanned chain it shows an "Open in your room" link to the §7 URL, opened only on the
person's click, with `rel="noopener noreferrer"`.

## 9. Security and privacy notes

- A `metarium://` URI is a name, not a capability. Resolving it needs whatever read rights the room's
  identity holds in that book.
- The label (§3.5) and the path are public to anyone who sees the code. Do not put secrets in either.
- Scanners SHOULD show every component before offering to open anything, and MUST NOT auto-open.
- Scanners SHOULD treat any non-`metarium://` payload as plain text and never turn it into a link.

## 10. Versioning

This is version 1 of the scheme. A future version that changes meaning will use a new query parameter
(ignored by v1 parsers, §3.6) or a new scheme; it will not change the meaning of a valid v1 URI.
