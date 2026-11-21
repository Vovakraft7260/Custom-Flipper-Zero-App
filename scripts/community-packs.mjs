// Community asset packs kept in this repo's asset-packs/ folder.
// Each pack is a folder (or a .zip / .tar.gz) holding Anims/, Icons/ and/or Fonts/,
// plus optional pack.json { "author", "description", "source_url" } and preview images.
// Builds a ready .tar.gz per pack and preview pictures for the app.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gzipSync, deflateSync } from 'node:zlib';
import { packContents, framesOf, readArchive } from '../src/assets/packs.js';
import { crc32 } from '../src/assets/archive.js';

const IMAGE = /^preview[^/]*\.(png|gif|jpe?g)$/i;

function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push({ path: rel, data: new Uint8Array(readFileSync(full)) });
  }
  return out;
}

/** Minimal ustar writer: [{ path, data }] → tar bytes. */
export function writeTar(files) {
  const enc = new TextEncoder();
  const blocks = [];
  const field = (buf, off, len, str) => buf.set(enc.encode(str).subarray(0, len), off);
  const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  for (const f of files) {
    const h = new Uint8Array(512);
    let name = f.path;
    let prefix = '';
    if (enc.encode(name).length > 100) {
      const cut = name.lastIndexOf('/', 154);
      prefix = name.slice(0, cut);
      name = name.slice(cut + 1);
    }
    field(h, 0, 100, name);
    field(h, 100, 8, octal(0o644, 8));
    field(h, 108, 8, octal(0, 8));
    field(h, 116, 8, octal(0, 8));
    field(h, 124, 12, octal(f.data.length, 12));
    field(h, 136, 12, octal(0, 12));
    field(h, 148, 8, '        ');
    h[156] = 0x30;
    field(h, 257, 6, 'ustar\0');
    field(h, 263, 2, '00');
    field(h, 345, 155, prefix);
    const sum = h.reduce((a, b) => a + b, 0);
    field(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    blocks.push(h, f.data, new Uint8Array((512 - (f.data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of blocks) (out.set(b, o), (o += b.length));
  return out;
}

/** A 1-bit frame as a PNG (Flipper orange, black pixels, scaled up). */
export function framePng({ width, height, pixels }, scale = 3) {
  const W = width * scale;
  const H = height * scale;
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 3);
    for (let x = 0; x < W; x++) {
      const on = pixels[Math.floor(y / scale) * width + Math.floor(x / scale)];
      raw.set(on ? [0, 0, 0] : [255, 130, 0], row + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const t = new TextEncoder().encode(type);
    const body = new Uint8Array(t.length + data.length);
    body.set(t);
    body.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(body, 4);
    dv.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pack';

/**
 * Reads every pack in srcDir, writes <pubDir>/packs/<slug>/{pack.tar.gz, preview-N.png|…}
 * and returns index entries (paths relative to pubDir).
 */
export async function buildCommunityPacks(srcDir, pubDir) {
  if (!existsSync(srcDir)) return [];
  const packs = [];
  const used = new Set();
  for (const entry of readdirSync(srcDir).sort()) {
    if (entry.startsWith('.') || /^readme/i.test(entry)) continue;
    const full = join(srcDir, entry);
    try {
      let files;
      let fallbackName;
      if (statSync(full).isDirectory()) {
        files = walk(full, entry);
        fallbackName = entry;
      } else if (/\.(zip|tar\.gz|tgz|tar)$/i.test(entry)) {
        files = await readArchive(new Uint8Array(readFileSync(full)));
        fallbackName = basename(entry).replace(/\.(zip|tar\.gz|tgz|tar)$/i, '');
      } else continue;
      const c = packContents(files);
      const name = c.name === 'Imported pack' ? fallbackName : c.name;
      let meta = {};
      const metaFile = c.files.find((f) => f.path === 'pack.json');
      if (metaFile) meta = JSON.parse(new TextDecoder().decode(metaFile.data));
      const extras = c.files.filter((f) => f.path === 'pack.json' || IMAGE.test(f.path));
      const payload = c.files.filter((f) => !extras.includes(f));
      let id = slug(name);
      while (used.has(id)) id += '-2';
      used.add(id);
      const out = join(pubDir, 'packs', id);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'pack.tar.gz'), gzipSync(writeTar(payload.map((f) => ({ path: `${name}/${f.path}`, data: f.data })))));
      const previews = [];
      for (const img of extras.filter((f) => IMAGE.test(f.path)).sort((a, b) => a.path.localeCompare(b.path))) {
        writeFileSync(join(out, img.path), img.data);
        previews.push(`packs/${id}/${img.path}`);
      }
      if (!previews.length) {
        // No pictures given: draw the first frame of up to 3 animations.
        for (const a of c.anims.slice(0, 3)) {
          try {
            const frame = framesOf(a)[0];
            if (!frame) continue;
            const file = `preview-${previews.length + 1}.png`;
            writeFileSync(join(out, file), framePng(frame));
            previews.push(`packs/${id}/${file}`);
          } catch {
            /* skip a broken animation */
          }
        }
      }
      packs.push({
        id,
        name: meta.name || name,
        author: meta.author || '',
        description: meta.description || '',
        sourceUrl: meta.source_url || '',
        previews,
        tar: `packs/${id}/pack.tar.gz`,
        files: payload.length,
      });
      console.log(`community: ${name} (${payload.length} files)`);
    } catch (e) {
      console.warn(`community: skipped ${entry}: ${e.message}`);
    }
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name));
}
