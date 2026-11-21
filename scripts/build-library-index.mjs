// Builds the signal library index from the community repos listed in
// scripts/library-sources.json. Only file names are fetched (no contents).
// Usage: node scripts/build-library-index.mjs <work dir> <out.json>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [work = 'library-work', out = 'library-index.json'] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const { sources } = JSON.parse(readFileSync(join(here, 'library-sources.json'), 'utf8'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

mkdirSync(work, { recursive: true });
const result = { v: 1, generated: new Date().toISOString(), sources: [] };

for (const src of sources) {
  const dir = join(work, src.repo.replace('/', '__'));
  if (!existsSync(dir)) {
    git(work, 'clone', '--quiet', '--depth', '1', '--filter=blob:none', '--no-checkout', `https://github.com/${src.repo}`, dir);
  }
  const sha = git(dir, 'rev-parse', 'HEAD').trim();
  const exclude = src.exclude ? new RegExp(src.exclude, 'i') : null;
  const prefix = src.dir ? `${src.dir}/` : '';
  const dirs = [];
  const dirIndex = new Map();
  const files = [];
  // "<mode> blob <sha>\t<path>"; submodules ("commit") are skipped.
  // (No sizes: asking git for them would download every file.)
  for (const line of git(dir, 'ls-tree', '-r', '-z', 'HEAD', ...(src.dir ? [src.dir] : [])).split('\0')) {
    const m = /^\d+ blob \w+\t(.+)$/s.exec(line);
    if (!m) continue;
    const [, path] = m;
    if (!path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length);
    const lower = rel.toLowerCase();
    if (!src.exts.some((x) => lower.endsWith(x))) continue;
    if (exclude && exclude.test(rel)) continue;
    const cut = rel.lastIndexOf('/');
    const folder = cut < 0 ? '' : rel.slice(0, cut);
    if (!dirIndex.has(folder)) {
      dirIndex.set(folder, dirs.length);
      dirs.push(folder);
    }
    files.push([dirIndex.get(folder), rel.slice(cut + 1)]);
  }
  result.sources.push({ id: src.id, name: src.name, repo: src.repo, sha, license: src.license, root: src.dir || '', dirs, files });
  console.log(`${src.id}: ${files.length} files in ${dirs.length} folders`);
}

writeFileSync(out, JSON.stringify(result));
console.log(`wrote ${out}`);
