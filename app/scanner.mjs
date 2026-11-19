// Copyright (C) 2026 Vignesh Sundaresan (Metakovan). SPDX-License-Identifier: GPL-3.0-only
// Scanner page. No storage, no network: everything stays in this tab.
import { parse, chainName, normalizeRegistry, roomFor, roomURL } from "../lib/metarium-uri.mjs";

const $ = (id) => document.getElementById(id);
const video = $("video");
const work = document.createElement("canvas");
const ctx = work.getContext("2d", { willReadFrequently: true });

let stream = null;
let looping = false;
let lastResult = null; // { text, ref|null }

// ---------------------------------------------------------------------------
// Registry (SPEC §8): merged from window.metariumRegistry and postMessage.

const registry = {};
const registryNames = {}; // genesis -> display name the extension gave
const rejectedHosts = new Map(); // key -> reason, deduplicated across re-reads

function mergeRegistry(obj) {
  const { registry: clean, names, rejected } = normalizeRegistry(obj);
  Object.assign(registry, clean);
  Object.assign(registryNames, names);
  for (const r of rejected) rejectedHosts.set(r.key, r.reason);
}

function readGlobalRegistry() {
  try {
    if (window.metariumRegistry) mergeRegistry(window.metariumRegistry);
  } catch {
    /* ignore a hostile getter */
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || typeof msg !== "object" || msg.type !== "metarium:registry") return;
  if (msg.version !== 1) return;
  mergeRegistry(msg.registry);
  readGlobalRegistry();
  if (lastResult && lastResult.ref) show(lastResult.text);
});

readGlobalRegistry();
window.postMessage({ type: "metarium:registry-request", version: 1 }, window.location.origin);

// ---------------------------------------------------------------------------
// Decoding

function decodeImageData(img, thorough) {
  const hit = window.jsQR(img.data, img.width, img.height, {
    inversionAttempts: thorough ? "attemptBoth" : "dontInvert",
  });
  return hit ? hit.data : null;
}

function grab(source, sw, sh) {
  const max = 720;
  const scale = Math.min(1, max / Math.max(sw, sh));
  work.width = Math.max(1, Math.round(sw * scale));
  work.height = Math.max(1, Math.round(sh * scale));
  ctx.drawImage(source, 0, 0, work.width, work.height);
  return ctx.getImageData(0, 0, work.width, work.height);
}

function tick() {
  if (!looping) return;
  if (video.readyState >= 2 && video.videoWidth) {
    const text = decodeImageData(grab(video, video.videoWidth, video.videoHeight), false);
    if (text !== null) {
      stopCamera();
      show(text);
      return;
    }
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Camera

async function startCamera() {
  const note = $("camera-note");
  note.textContent = "";
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    note.textContent = "This browser gives no camera to this page (it needs https or localhost). Scan an image instead.";
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  } catch (e) {
    note.textContent = `No camera: ${e.name === "NotAllowedError" ? "permission was refused" : e.message || e.name}. Scan an image instead.`;
    return;
  }
  video.srcObject = stream;
  video.hidden = false;
  $("frame").hidden = false;
  $("idle").hidden = true;
  $("camera-btn").textContent = "Stop camera";
  $("result").hidden = true;
  await video.play().catch(() => {});
  looping = true;
  requestAnimationFrame(tick);
}

function stopCamera() {
  looping = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  video.hidden = true;
  $("frame").hidden = true;
  $("idle").hidden = false;
  $("camera-btn").textContent = "Start camera";
}

$("camera-btn").addEventListener("click", () => (stream ? stopCamera() : startCamera()));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && stream) stopCamera();
});

// ---------------------------------------------------------------------------
// Image file fallback

async function scanFile(file) {
  stopCamera();
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    showMessage("bad", "That file could not be read as an image.");
    return;
  }
  const text = decodeImageData(grab(bitmap, bitmap.width, bitmap.height), true)
    // Small codes in big photos: try once more at full resolution.
    ?? fullRes(bitmap);
  bitmap.close?.();
  if (text === null) showMessage("bad", "No QR code found in that image.");
  else show(text);
}

function fullRes(bitmap) {
  work.width = bitmap.width;
  work.height = bitmap.height;
  ctx.drawImage(bitmap, 0, 0);
  return decodeImageData(ctx.getImageData(0, 0, work.width, work.height), true);
}

$("file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) scanFile(file);
});

// ---------------------------------------------------------------------------
// Result

function reveal() {
  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showMessage(kind, text) {
  lastResult = null;
  reveal();
  $("status").className = `status ${kind}`;
  $("status").textContent = text;
  $("fields-wrap").hidden = true;
  $("raw-wrap").hidden = true;
}

function show(text) {
  reveal();
  let ref;
  try {
    ref = parse(text);
  } catch (e) {
    lastResult = { text, ref: null };
    $("status").className = "status warn";
    $("status").textContent = text.trim().toLowerCase().startsWith("metarium://")
      ? `A metarium:// code, but not a valid one: ${e.message}.`
      : "Not a metarium:// code. Its text, as plain text:";
    $("fields-wrap").hidden = true;
    $("raw-wrap").hidden = false;
    $("raw").textContent = text;
    return;
  }
  lastResult = { text, ref };
  readGlobalRegistry();
  $("status").className = "status ok";
  $("status").textContent = "A metarium:// reference";
  $("fields-wrap").hidden = false;
  $("raw-wrap").hidden = true;

  const name = chainName(ref.genesis) || registryNames[ref.genesis] || null;
  $("f-chain").textContent = name || "Unknown chain";
  $("f-genesis").textContent = ref.genesis;
  $("f-channel").textContent = String(ref.channel);
  $("f-path").textContent = ref.path;
  if (ref.kuri) {
    $("f-kuri").className = "mono";
    $("f-kuri").textContent = ref.kuri;
  } else {
    $("f-kuri").className = "muted";
    $("f-kuri").textContent = "Current version (no pin)";
  }
  if (ref.label) {
    $("f-label").className = "";
    $("f-label").textContent = ref.label;
  } else {
    $("f-label").className = "muted";
    $("f-label").textContent = "None";
  }
  $("f-uri").textContent = ref.canonical;
  renderRoom(ref);
}

function renderRoom(ref) {
  const link = $("room-link");
  const note = $("room-note");
  const host = roomFor(registry, ref.genesis);
  if (host) {
    link.href = roomURL(host, ref);
    link.hidden = false;
    note.textContent = `Your room at ${host} (told to this page by your browser extension).`;
  } else {
    link.hidden = true;
    link.removeAttribute("href");
    note.textContent = "No room is known for this chain. A browser extension can tell this page where your room runs; nothing else will.";
  }
  if (rejectedHosts.size) {
    const n = rejectedHosts.size;
    note.textContent += ` Ignored ${n} registry ${n === 1 ? "entry that was" : "entries that were"} not allowed (http:// must be localhost).`;
  }
}

$("copy-btn").addEventListener("click", async () => {
  if (!lastResult || !lastResult.ref) return;
  const btn = $("copy-btn");
  try {
    await navigator.clipboard.writeText(lastResult.ref.canonical);
    btn.textContent = "Copied";
  } catch {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($("f-uri"));
    sel.removeAllRanges();
    sel.addRange(range);
    btn.textContent = "Selected — copy it";
  }
  setTimeout(() => (btn.textContent = "Copy URI"), 1600);
});

$("again-btn").addEventListener("click", () => {
  $("result").hidden = true;
  startCamera();
});
