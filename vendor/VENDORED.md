# Vendored code

Copied verbatim from the npm registry tarballs; never loaded from a CDN.

| Library | Version | File | License | SHA-256 |
|---|---|---|---|---|
| [jsQR](https://github.com/cozmo/jsQR) | 1.4.0 | `jsqr-1.4.0/jsQR.js` (from `dist/`) | Apache-2.0 | `bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859` |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | `qrcode-generator-1.4.4/qrcode.js` | MIT | `18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780` |

jsQR decodes on the scanner page. qrcode-generator is used only by the test page (`generate.html`).
Neither makes network requests. Check the hashes with `shasum -a 256 vendor/*/*.js`.

To upgrade: `npm pack <name>@<version>` into an empty folder, copy the same file, update this table,
and run the round trip in the README.
