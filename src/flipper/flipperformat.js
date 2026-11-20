// Reads Flipper's text file format ("Key: Value" lines) for signal files.

/** Splits a file into entries [{ key, value }] in order (comments and blanks dropped). */
export function parseLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    out.push({ key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
  }
  return out;
}

/** Simple key → value map (first occurrence wins; repeated keys like RAW_Data are joined). */
export function parseFields(text) {
  const map = {};
  for (const { key, value } of parseLines(text)) {
    if (key in map) {
      if (key === 'RAW_Data') map[key] += ` ${value}`;
      continue;
    }
    map[key] = value;
  }
  return map;
}

/** Infrared remote: every signal starts with "name:". */
export function parseInfrared(text) {
  const signals = [];
  let cur = null;
  for (const { key, value } of parseLines(text)) {
    if (key === 'name') {
      cur = { name: value };
      signals.push(cur);
    } else if (cur) {
      cur[key] = value;
    }
  }
  return signals;
}

const PRESETS = {
  FuriHalSubGhzPresetOok270Async: 'AM270',
  FuriHalSubGhzPresetOok650Async: 'AM650',
  FuriHalSubGhzPreset2FSKDev238Async: 'FM238',
  FuriHalSubGhzPreset2FSKDev476Async: 'FM476',
  FuriHalSubGhzPresetMSK99_97KbAsync: 'MSK',
  FuriHalSubGhzPresetGFSK9_99KbAsync: 'GFSK',
  FuriHalSubGhzPresetCustom: 'custom',
};

/** Sub-GHz key or RAW recording. */
export function parseSubGhz(text) {
  const f = parseFields(text);
  const hz = Number(f.Frequency);
  const raw = f.RAW_Data ? f.RAW_Data.split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n !== 0) : null;
  return {
    fileType: f.Filetype ?? '',
    frequency: Number.isFinite(hz) ? hz : null,
    frequencyText: Number.isFinite(hz) ? `${(hz / 1e6).toFixed(2)} MHz` : '?',
    preset: PRESETS[f.Preset] ?? f.Preset ?? '?',
    protocol: f.Protocol ?? '?',
    isRaw: f.Protocol === 'RAW',
    bits: f.Bit ?? null,
    key: f.Key ?? null,
    te: f.TE ?? null,
    raw,
    fields: f,
  };
}

/** Total length of a RAW recording in milliseconds. */
export function rawDurationMs(raw) {
  return raw ? raw.reduce((n, d) => n + Math.abs(d), 0) / 1000 : 0;
}

/** Fields worth showing for NFC / RFID / iButton, in a friendly order. */
export function keyFileSummary(kind, text) {
  const f = parseFields(text);
  const pick = (pairs) => pairs.filter(([, k]) => f[k] !== undefined).map(([label, k]) => [label, f[k]]);
  if (kind === 'nfc') {
    return pick([
      ['type', 'Device type'],
      ['uid', 'UID'],
      ['atqa', 'ATQA'],
      ['sak', 'SAK'],
      ['mifare', 'Mifare Classic type'],
      ['pages', 'Pages total'],
      ['data format', 'Data format version'],
    ]);
  }
  if (kind === 'rfid') return pick([['type', 'Key type'], ['data', 'Data']]);
  if (kind === 'ibutton') {
    return pick([
      ['protocol', 'Protocol'],
      ['key type', 'Key type'],
      ['rom', 'Rom Data'],
      ['key', 'Key'],
      ['data', 'Data'],
    ]);
  }
  return [];
}
