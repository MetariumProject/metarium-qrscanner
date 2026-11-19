# metarium QR scanner

A static web page that scans a `metarium://` QR code and shows what it names: the chain, the channel,
the lookup path, the version pin and the label, if there is one. Meant to live at https://metarium.net/qrscanner.

**It hosts nothing and saves nothing.** No backend, no database, no cookies, no localStorage, no
analytics, no fonts or scripts from anywhere else. The page's Content-Security-Policy sets
`connect-src 'none'`, so the browser itself stops it from sending anything anywhere. The camera picture
and the decoded text stay in the tab and are gone when you close it.

**Anyone can host it.** It is a handful of static files; copy the folder to any web server and it works
the same. There is nothing to configure.

## What is in a code

```
metarium://<genesis>/<channel>/<path>[?l=<label>][#<kuri>]
```

The full scheme, with parsing and encoding rules and the registry contract for browser extensions,
is [SPEC.md](SPEC.md). That file is the canonical spec.

## Opening a code in your room

The page does not know where your reading room runs and never looks for it. If you have a browser
extension that maps chains to your room (SPEC §8), it tells the page, and the page offers
**Open in your room**, a link to `<room>/metarium/<genesis>/<channel>/<path>?kuri=…`. Nothing opens
until you click it. Without an extension you can still copy the URI.

## Files

| Path | What |
|---|---|
| `index.html`, `app/scanner.mjs` | The scanner: camera, or an image file |
| `generate.html`, `app/generate.mjs` | Makes test codes, and checks that they decode back to the same URI |
| `lib/metarium-uri.mjs` | Reference `parse` / `format` / room URL code (plain JS, no dependencies) |
| `tests/` | Tests for the library (`node --test`) |
| `vendor/` | jsQR 1.4.0 (decoder) and qrcode-generator 1.4.4 (test page only), pinned, with hashes in `vendor/VENDORED.md` |
| `app/style.css` | Styles, light and dark |

## Run it locally

```bash
python3 -m http.server 8391 --bind 127.0.0.1
```

Then open http://127.0.0.1:8391/. The camera needs `https://` or `localhost`; over plain http on another
host, use "Scan an image".

The pages are ES modules, so opening `index.html` straight from disk (`file://`) does not work; any static
server does.

## Test

```bash
node --test 'tests/*.test.mjs'
```

Node 18 or later. For an end-to-end check, open `generate.html`, make a code, press **Decode it back**
(it should say it decodes to the identical URI), save the PNG and scan it on `index.html` with
**Scan an image**.

## Hosting notes

- Serve the folder as it is. Any path prefix works (`/qrscanner/`): every link is relative.
- If your host can set response headers, add `Content-Security-Policy: frame-ancestors 'none'` and
  `Referrer-Policy: no-referrer`; the rest of the policy is already in the pages' `<meta>` tags.
- Serve `.mjs` as `text/javascript` (most servers do).

## Credits

Metarium is created and stewarded by **Vignesh Sundaresan (Metakovan)** —
[vigneshsundaresan.net](https://vigneshsundaresan.net) · [metakovan.net](https://metakovan.net).

**Forking or self-hosting?** Please keep [`NOTICE`](NOTICE) and the license copyright lines intact, and
credit **Vignesh Sundaresan (Metakovan)** as the creator of Metarium in your README, docs or about page,
linking back to https://github.com/MetariumProject/Metarium.

## License

- The scanner, the test page, `lib/` and `SPEC.md` are licensed **GPL-3.0-only**,
  Copyright (C) 2026 Vignesh Sundaresan (Metakovan) (see [`LICENSE`](LICENSE)).
- The bundled decoder and generator keep their own licenses: jsQR is Apache-2.0, qrcode-generator is MIT
  (see [`NOTICE`](NOTICE) and [`vendor/VENDORED.md`](vendor/VENDORED.md)).
