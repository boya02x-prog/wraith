"use client";

// Tiny APNG (animated PNG) writer. A data URL of an APNG is still "data:image/png;base64,...", so it passes the existing
// image rules for posts and comments, and every modern browser animates it in a plain <img>. No library needed:
// each frame is first encoded by the canvas as an ordinary PNG, then the compressed pixel data is re-packed with animation chunks.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const ascii = (s: string) => new Uint8Array([...s].map((ch) => ch.charCodeAt(0)));

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(ascii(type), 0);
  typeAndData.set(data, 4);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(typeAndData, 4);
  out.set(u32(crc32(typeAndData)), 8 + data.length);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function fromDataUrl(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pulls the header and the concatenated compressed pixel data out of a normal PNG. */
function parsePng(bytes: Uint8Array): { ihdr: Uint8Array; idat: Uint8Array } {
  let pos = 8; // skip signature
  let ihdr = new Uint8Array(0);
  const idats: Uint8Array[] = [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") ihdr = data.slice();
    else if (type === "IDAT") idats.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  return { ihdr, idat: concat(idats) };
}

/** frames: PNG data URLs of identical size. delayMs: time per frame. Loops forever. Returns an APNG data URL. */
export function framesToApng(frames: string[], delayMs: number): string {
  const parsed = frames.map((f) => parsePng(fromDataUrl(f)));
  const ihdr = parsed[0].ihdr;
  const w = new DataView(ihdr.buffer, ihdr.byteOffset, 8).getUint32(0);
  const h = new DataView(ihdr.buffer, ihdr.byteOffset, 8).getUint32(4);

  let seq = 0;
  const fctl = () => {
    const d = new Uint8Array(26);
    const dv = new DataView(d.buffer);
    dv.setUint32(0, seq++);
    dv.setUint32(4, w); dv.setUint32(8, h);
    dv.setUint32(12, 0); dv.setUint32(16, 0);
    dv.setUint16(20, delayMs); dv.setUint16(22, 1000);
    d[24] = 1; // dispose: clear to transparent before the next frame
    d[25] = 0; // blend: replace
    return chunk("fcTL", d);
  };

  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);
  new DataView(actl.buffer).setUint32(4, 0); // 0 = loop forever

  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("acTL", actl)];
  parts.push(fctl(), chunk("IDAT", parsed[0].idat));
  for (let i = 1; i < parsed.length; i++) {
    parts.push(fctl());
    const fd = new Uint8Array(4 + parsed[i].idat.length);
    new DataView(fd.buffer).setUint32(0, seq++);
    fd.set(parsed[i].idat, 4);
    parts.push(chunk("fdAT", fd));
  }
  parts.push(chunk("IEND", new Uint8Array(0)));

  const bytes = concat(parts);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}
