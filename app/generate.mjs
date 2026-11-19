// Test-code generator. Builds the canonical URI and draws it; nothing is sent or stored.
import { format, parse, KNOWN_CHAINS } from "../lib/metarium-uri.mjs";

const $ = (id) => document.getElementById(id);
const canvas = $("qr");

for (const [genesis, name] of Object.entries(KNOWN_CHAINS)) {
  $("chain").append(new Option(name, genesis));
}
$("chain").append(new Option("Other chain…", ""));

let currentURI = null;

function readForm() {
  const genesis = $("chain").value || $("genesis").value.trim();
  return {
    genesis,
    channel: $("channel").value.trim(),
    path: $("path").value.trim(),
    kuri: $("kuri").value.trim() || null,
    label: $("use-label").checked ? $("label").value : null,
  };
}

function draw(uri) {
  const qr = window.qrcode(0, "M");
  qr.addData(uri, "Byte"); // canonical URIs are ASCII (SPEC §4)
  qr.make();
  const n = qr.getModuleCount();
  const margin = 4;
  const scale = 8;
  const size = (n + margin * 2) * scale;
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, size, size);
  c.fillStyle = "#000";
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      if (qr.isDark(r, col)) c.fillRect((col + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
  $("download").href = canvas.toDataURL("image/png");
}

function update() {
  $("genesis-field").hidden = $("chain").value !== "";
  $("label-field").hidden = !$("use-label").checked;
  $("check").textContent = "";
  try {
    currentURI = format(readForm());
    $("error").hidden = true;
    $("uri").textContent = currentURI;
    $("qr-out").hidden = false;
    draw(currentURI);
  } catch (e) {
    currentURI = null;
    $("uri").textContent = "";
    $("error").hidden = false;
    $("error").textContent = e.message;
    $("qr-out").hidden = true;
    $("download").removeAttribute("href");
  }
}

function fillFrom(text) {
  let ref;
  try {
    ref = parse(text);
  } catch (e) {
    $("error").hidden = false;
    $("error").textContent = `Pasted text: ${e.message}`;
    return;
  }
  const known = Object.prototype.hasOwnProperty.call(KNOWN_CHAINS, ref.genesis);
  $("chain").value = known ? ref.genesis : "";
  $("genesis").value = known ? "" : ref.genesis;
  $("channel").value = String(ref.channel);
  $("path").value = ref.path;
  $("kuri").value = ref.kuri || "";
  $("use-label").checked = !!ref.label;
  $("label").value = ref.label || "";
  update();
}

$("form").addEventListener("input", (e) => {
  if (e.target.id === "paste") fillFrom(e.target.value);
  else update();
});
$("form").addEventListener("submit", (e) => e.preventDefault());

$("check-btn").addEventListener("click", () => {
  if (!currentURI) return;
  const c = canvas.getContext("2d");
  const img = c.getImageData(0, 0, canvas.width, canvas.height);
  const hit = window.jsQR(img.data, img.width, img.height);
  const out = $("check");
  if (!hit) out.textContent = "✗ The decoder found no code.";
  else if (hit.data === currentURI) out.textContent = "✓ Decodes back to the identical URI.";
  else out.textContent = `✗ Decoded to something else: ${hit.data}`;
});

update();
