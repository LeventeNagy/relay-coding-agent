// Generates the built-in "Sprocket" pet sprite sheet + manifest with zero
// dependencies (pure Node + zlib PNG encoding). Run: `node scripts/generate-builtin-pet.mjs`.
//
// Layout: one state per row, 6 columns of 48x48 frames. The renderer steps the
// active state's frame range (see src/renderer/components/Pet.tsx). Re-run this to
// tweak the placeholder pet; users generate nicer ones (PixelLab/Musely) later.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FW = 48;
const FH = 48;
const COLS = 6;
const ROWS = 5;
const W = FW * COLS;
const H = FH * ROWS;
const buf = new Uint8Array(W * H * 4); // RGBA, transparent

const px = (x, y, [r, g, b, a = 255]) => {
  x |= 0;
  y |= 0;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const sa = a / 255;
  buf[i] = Math.round(r * sa + buf[i] * (1 - sa));
  buf[i + 1] = Math.round(g * sa + buf[i + 1] * (1 - sa));
  buf[i + 2] = Math.round(b * sa + buf[i + 2] * (1 - sa));
  buf[i + 3] = Math.max(buf[i + 3], a);
};

const disc = (cx, cy, rad, color) => {
  for (let y = -rad; y <= rad; y++) {
    for (let x = -rad; x <= rad; x++) {
      if (x * x + y * y <= rad * rad) px(cx + x, cy + y, color);
    }
  }
};

const rect = (x0, y0, w, h, color) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x0 + x, y0 + y, color);
};

const lighten = (c, n) => [Math.min(255, c[0] + n), Math.min(255, c[1] + n), Math.min(255, c[2] + n)];
const darken = (c, n) => [Math.max(0, c[0] - n), Math.max(0, c[1] - n), Math.max(0, c[2] - n)];

// Mood palette (Relay-ish): calm idle, orange working, amber waiting, green done, red error.
const palette = {
  idle: [108, 162, 208],
  working: [245, 120, 16],
  needsInput: [240, 192, 70],
  done: [96, 200, 128],
  error: [226, 96, 86]
};

const ink = [34, 32, 44];

const drawFrame = (fcol, frow, state, i) => {
  const ox = fcol * FW;
  const oy = frow * FH;
  const cx = ox + (FW >> 1);
  const baseY = oy + (FH >> 1) + 2;

  // Per-state motion: bob, plus a shake on error and a faster bob when working.
  const amp = state === "working" ? 3 : state === "error" ? 0 : 2;
  const bob = Math.round(Math.sin((i / 3) * Math.PI) * amp);
  const shake = state === "error" ? (i % 2 ? 2 : -2) : 0;
  const cy = baseY + bob;
  const body = palette[state];

  // Soft ground shadow (stays put while the body bobs).
  for (let x = -10; x <= 10; x++) {
    const yy = oy + FH - 7;
    if (x * x <= 100) px(cx + x, yy, [0, 0, 0, 60]);
  }

  // Body + lighter belly highlight.
  disc(cx + shake, cy, 15, body);
  disc(cx + shake, cy + 3, 10, lighten(body, 34));
  // Little antenna with a blinking tip.
  rect(cx + shake, cy - 18, 1, 4, darken(body, 40));
  disc(cx + shake, cy - 19, 2, i % 2 ? lighten(body, 80) : darken(body, 20));

  // Eyes vary by mood.
  const ex = 5;
  const eyeY = cy - 2;
  if (state === "done") {
    // happy ^ ^
    for (let k = -2; k <= 2; k++) {
      px(cx + shake - ex + k, eyeY + Math.abs(k) - 1, ink);
      px(cx + shake + ex + k, eyeY + Math.abs(k) - 1, ink);
    }
  } else if (state === "error") {
    // x x
    for (let k = -2; k <= 2; k++) {
      px(cx - ex + k, eyeY + k, ink);
      px(cx - ex + k, eyeY - k, ink);
      px(cx + ex + k, eyeY + k, ink);
      px(cx + ex + k, eyeY - k, ink);
    }
  } else {
    const blink = state === "idle" && i === 3;
    const wide = state === "needsInput" ? 3 : 2;
    if (blink) {
      rect(cx - ex - 1, eyeY, 3, 1, ink);
      rect(cx + ex - 1, eyeY, 3, 1, ink);
    } else {
      disc(cx - ex, eyeY, wide, ink);
      disc(cx + ex, eyeY, wide, ink);
      // pupil glint shifts on working (looking around)
      const gx = state === "working" ? (i % 2 ? 1 : -1) : 0;
      px(cx - ex + gx, eyeY - 1, [255, 255, 255]);
      px(cx + ex + gx, eyeY - 1, [255, 255, 255]);
    }
  }

  // A "!" above the head when waiting for input.
  if (state === "needsInput") {
    const pulse = i % 2 ? 0 : 1;
    rect(cx, cy - 26 - pulse, 2, 4, palette.needsInput);
    rect(cx, cy - 21 - pulse, 2, 2, palette.needsInput);
  }
};

const states = [
  { name: "idle", frames: 6 },
  { name: "working", frames: 6 },
  { name: "needsInput", frames: 6 },
  { name: "done", frames: 6 },
  { name: "error", frames: 6 }
];

states.forEach((s, row) => {
  for (let i = 0; i < s.frames; i++) drawFrame(i, row, s.name, i);
});

// ── PNG encode (RGBA, no deps) ──────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), out.length - 4);
  return out;
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
// compression/filter/interlace already 0

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // filter: none
  Buffer.from(buf.buffer, y * W * 4, W * 4).copy(raw, y * (1 + W * 4) + 1);
}
const idat = deflateSync(raw, { level: 9 });

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "renderer", "assets", "pets", "sprocket");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "sheet.png"), png);

const manifest = {
  name: "Sprocket",
  frameWidth: FW,
  frameHeight: FH,
  columns: COLS,
  fps: 8,
  states: {
    idle: [0, 5],
    working: [6, 11],
    needsInput: [12, 17],
    done: [18, 23],
    error: [24, 29]
  }
};
writeFileSync(join(outDir, "pet.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log(`Wrote ${W}x${H} sheet.png + pet.json to ${outDir}`);
