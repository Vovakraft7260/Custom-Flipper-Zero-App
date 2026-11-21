// Builds the asset pack list from Momentum's Asset-Packs repo (each pack has
// meta.json, preview images and a ready-made .tar.gz for the Flipper).
// Usage: node scripts/build-packs-index.mjs <work dir> <out.json>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [work = 'packs-work', out = 'packs.json'] = process.argv.slice(2);
const SOURCES = [{ id: 'momentum', name: 'Momentum asset packs', repo: 'Next-Flip/Asset-Packs' }];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

mkdirSync(work, { recursive: true });
const result = { v: 1, generated: new Date().toISOString(), sources: [] };
for (const src of SOURCES) {
  const dir = join(work, src.repo.replace('/', '__'));
  if (!existsSync(dir)) git(work, 'clone', '--quiet', '--depth', '1', '--filter=blob:none', '--no-checkout', `https://github.com/${src.repo}`, dir);
  const sha = git(dir, 'rev-parse', 'HEAD').trim();
  const files = git(dir, 'ls-tree', '-r', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean);
  const byPack = new Map();
  for (const f of files) {
    const [pack, kind, ...rest] = f.split('/');
    if (!rest.length || pack.startsWith('.')) continue;
    if (!byPack.has(pack)) byPack.set(pack, { previews: [], tar: null, zip: null, files: 0 });
    const p = byPack.get(pack);
    if (kind === 'preview') p.previews.push(f);
    else if (kind === 'download' && f.endsWith('.tar.gz')) p.tar = f;
    else if (kind === 'download' && f.endsWith('.zip')) p.zip = f;
    else if (kind === 'source') p.files++;
  }
  const packs = [];
  for (const [id, p] of byPack) {
    if (!p.tar || !files.includes(`${id}/meta.json`)) continue;
    let meta = {};
    try {
      meta = JSON.parse(git(dir, 'show', `HEAD:${id}/meta.json`));
    } catch {
      /* broken meta: still list it by folder name */
    }
    const order = (f) => Number(/\/(\d+)\.\w+$/.exec(f)?.[1] ?? 99);
    packs.push({
      id,
      name: meta.name || id,
      author: meta.author || '',
      description: meta.description || '',
      sourceUrl: meta.source_url || '',
      previews: p.previews.sort((a, b) => order(a) - order(b)),
      tar: p.tar,
      files: p.files,
    });
  }
  packs.sort((a, b) => a.name.localeCompare(b.name));
  result.sources.push({ id: src.id, name: src.name, repo: src.repo, sha, packs });
  console.log(`${src.id}: ${packs.length} packs`);
}
writeFileSync(out, JSON.stringify(result));
console.log(`wrote ${out}`);
