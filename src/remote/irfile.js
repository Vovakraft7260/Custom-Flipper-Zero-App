// Turns universal-remote codes into a Flipper .ir file the Infrared app can load.

/** entries: [{ name, code }] where code is { p, a, c } (parsed) or { f, d, r } (raw). */
export function buildIrFile(entries) {
  const lines = ['Filetype: IR signals file', 'Version: 1'];
  for (const { name, code } of entries) {
    lines.push('#', `name: ${name}`);
    if (code.p) {
      lines.push('type: parsed', `protocol: ${code.p}`, `address: ${code.a}`, `command: ${code.c}`);
    } else {
      lines.push('type: raw', `frequency: ${code.f}`, `duty_cycle: ${code.d.toFixed(6)}`, `data: ${code.r}`);
    }
  }
  return lines.join('\n') + '\n';
}
