// A pretend Flipper: answers RPC requests like the real one.
import { md5 } from '../firmware/md5.js';
// Used by the tests, and by the "demo" button in the browser preview.
import { encodeMain } from './proto.js';
import { FrameDecoder } from './framing.js';

export class FakeFlipper {
  constructor({ packetSize = 7 } = {}) {
    this.files = new Map([['/ext/infrared/tv.ir', new TextEncoder().encode('Filetype: IR signals file\n')]]);
    this.dirs = new Set(['/ext', '/ext/infrared']);
    this.streamTimer = null;
    this.writes = new Map(); // command_id -> chunks
    this.inputs = [];
    this.received = [];
    this.packetSize = packetSize;
    this.decoder = new FrameDecoder((m) => this.handle(m));
    this.onData = () => {};
  }

  // Transport interface used by FlipperRpc
  async send(bytes) {
    this.decoder.push(bytes);
  }

  reply(obj) {
    // Deliver in small packets to exercise reassembly
    const bytes = encodeMain(obj);
    for (let i = 0; i < bytes.length; i += this.packetSize) this.onData(bytes.slice(i, i + this.packetSize));
  }

  handle(m) {
    this.received.push(m);
    const id = m.command_id;
    switch (m.content) {
      case 'system_device_info_request':
        this.reply({ command_id: id, has_next: true, system_device_info_response: { key: 'hardware_name', value: 'Rig0' } });
        this.reply({ command_id: id, system_device_info_response: { key: 'firmware_origin_fork', value: 'Momentum' } });
        break;
      case 'storage_list_request': {
        const dir = m.storage_list_request.path;
        if (!this.dirs.has(dir)) return this.reply({ command_id: id, command_status: 7, empty: {} });
        const entries = [];
        for (const d of this.dirs) if (parent(d) === dir) entries.push({ type: 1, name: base(d) });
        for (const [f, data] of this.files) if (parent(f) === dir) entries.push({ type: 0, name: base(f), size: data.length });
        // Split over two responses like the real Flipper does for long lists
        const half = Math.ceil(entries.length / 2);
        this.reply({ command_id: id, has_next: true, storage_list_response: { file: entries.slice(0, half) } });
        this.reply({ command_id: id, storage_list_response: { file: entries.slice(half) } });
        break;
      }
      case 'storage_read_request': {
        const data = this.files.get(m.storage_read_request.path);
        if (!data) return this.reply({ command_id: id, command_status: 7, empty: {} });
        for (let off = 0; off < data.length || off === 0; off += 10) {
          const last = off + 10 >= data.length;
          this.reply({ command_id: id, has_next: !last, storage_read_response: { file: { data: data.slice(off, off + 10) } } });
          if (last) break;
        }
        break;
      }
      case 'storage_write_request': {
        const chunks = this.writes.get(id) ?? [];
        chunks.push(m.storage_write_request.file?.data ?? new Uint8Array(0));
        this.writes.set(id, chunks);
        if (!m.has_next) {
          const total = chunks.reduce((n, c) => n + c.length, 0);
          const out = new Uint8Array(total);
          let o = 0;
          for (const c of chunks) (out.set(c, o), (o += c.length));
          this.files.set(m.storage_write_request.path, out);
          this.reply({ command_id: id, empty: {} });
        }
        break;
      }
      case 'system_protobuf_version_request':
        this.reply({ command_id: id, system_protobuf_version_response: { major: 0, minor: 25 } });
        break;
      case 'app_start_request':
        this.reply({ command_id: id, empty: {} });
        if (m.app_start_request.args === 'RPC') this.reply({ command_id: 0, app_state_response: { state: 1 } });
        break;
      case 'gui_start_screen_stream_request':
        this.reply({ command_id: id, empty: {} });
        clearInterval(this.streamTimer);
        this.streamTimer = setInterval(() => this.reply({ command_id: 0, gui_screen_frame: { data: demoFrame(this.inputs.length) } }), 200);
        break;
      case 'gui_stop_screen_stream_request':
        clearInterval(this.streamTimer);
        this.reply({ command_id: id, empty: {} });
        break;
      case 'storage_info_request':
        this.reply({ command_id: id, storage_info_response: { total_space: 31_000_000_000, free_space: 29_500_000_000 } });
        break;
      case 'system_power_info_request':
        this.reply({ command_id: id, has_next: true, system_power_info_response: { key: 'charge_level', value: '87' } });
        this.reply({ command_id: id, system_power_info_response: { key: 'charge_state', value: 'discharging' } });
        break;
      case 'storage_delete_request':
        for (const k of [...this.files.keys()]) if (k === m.storage_delete_request.path || k.startsWith(m.storage_delete_request.path + '/')) this.files.delete(k);
        for (const d of [...this.dirs]) if (d === m.storage_delete_request.path || d.startsWith(m.storage_delete_request.path + '/')) this.dirs.delete(d);
        this.reply({ command_id: id, empty: {} });
        break;
      case 'storage_mkdir_request':
        this.dirs.add(m.storage_mkdir_request.path);
        this.reply({ command_id: id, empty: {} });
        break;
      case 'storage_rename_request': {
        const { old_path: from, new_path: to } = m.storage_rename_request;
        if (this.files.has(from)) (this.files.set(to, this.files.get(from)), this.files.delete(from));
        if (this.dirs.has(from)) (this.dirs.add(to), this.dirs.delete(from));
        this.reply({ command_id: id, empty: {} });
        break;
      }
      case 'storage_md5sum_request': {
        const data = this.files.get(m.storage_md5sum_request.path);
        if (!data) this.reply({ command_id: id, command_status: 2, empty: {} });
        else this.reply({ command_id: id, storage_md5sum_response: { md5sum: md5(data) } });
        break;
      }
      case 'gui_send_input_event_request':
        this.inputs.push(m.gui_send_input_event_request);
        this.reply({ command_id: id, empty: {} });
        break;
      default:
        this.reply({ command_id: id, empty: {} });
    }
  }
}

/** Demo picture: a frame border and a moving dot. */
function demoFrame(n) {
  const data = new Uint8Array(1024);
  const set = (x, y) => (data[(y >> 3) * 128 + x] |= 1 << (y & 7));
  for (let x = 0; x < 128; x++) (set(x, 0), set(x, 63));
  for (let y = 0; y < 64; y++) (set(0, y), set(127, y));
  const cx = 10 + ((n * 9) % 108);
  for (let dx = 0; dx < 6; dx++) for (let dy = 0; dy < 6; dy++) set(cx + dx, 29 + dy);
  return data;
}

/** Fills the demo with a typical Momentum SD card layout. */
export function demoFlipper() {
  const f = new FakeFlipper({ packetSize: 64 });
  const enc = (t) => new TextEncoder().encode(t);
  for (const d of ['/int', '/ext/subghz', '/ext/nfc', '/ext/lfrfid', '/ext/badusb', '/ext/apps', '/ext/apps/Tools', '/ext/asset_packs']) f.dirs.add(d);
  f.files.set('/ext/subghz/garage.sub', enc('Filetype: Flipper SubGhz Key File\nVersion: 1\nFrequency: 433920000\nPreset: FuriHalSubGhzPresetOok650Async\nProtocol: Princeton\nBit: 24\nKey: 00 00 00 00 00 95 D5 D4\nTE: 400\n'));
  f.files.set('/ext/nfc/card.nfc', enc('Filetype: Flipper NFC device\nVersion: 4\nDevice type: NTAG215\nUID: 04 85 92 8A A0 61 81\n'));
  f.files.set('/ext/badusb/hello.txt', enc('REM hello world\nDELAY 500\nGUI r\nSTRING notepad\nENTER\n'));
  f.files.set('/ext/apps/Tools/clock.fap', new Uint8Array(4096));
  f.dirs.add('/ext/ibutton');
  f.files.set('/ext/infrared/tv.ir', enc('Filetype: IR signals file\nVersion: 1\n#\nname: Power\ntype: parsed\nprotocol: NEC\naddress: 07 00 00 00\ncommand: 02 00 00 00\n#\nname: Vol_up\ntype: parsed\nprotocol: NEC\naddress: 07 00 00 00\ncommand: 07 00 00 00\n#\nname: Vol_dn\ntype: parsed\nprotocol: NEC\naddress: 07 00 00 00\ncommand: 0B 00 00 00\n#\nname: Ch_next\ntype: parsed\nprotocol: NEC\naddress: 07 00 00 00\ncommand: 12 00 00 00\n#\nname: Ch_prev\ntype: parsed\nprotocol: NEC\naddress: 07 00 00 00\ncommand: 10 00 00 00\n#\nname: Mute\ntype: parsed\nprotocol: NEC\naddress: 07 00 00 00\ncommand: 0F 00 00 00\n#\nname: Netflix\ntype: parsed\nprotocol: NEC\naddress: 07 00 00 00\ncommand: 1A 00 00 00\n'));
  const raw = [];
  for (let i = 0; i < 120; i++) raw.push(i % 2 ? -(200 + ((i * 37) % 900)) : 300 + ((i * 53) % 700));
  f.files.set('/ext/subghz/doorbell_raw.sub', enc(`Filetype: Flipper SubGhz RAW File\nVersion: 1\nFrequency: 433920000\nPreset: FuriHalSubGhzPresetOok650Async\nProtocol: RAW\nRAW_Data: ${raw.slice(0, 60).join(' ')}\nRAW_Data: ${raw.slice(60).join(' ')}\n`));
  f.files.set('/ext/lfrfid/office.rfid', enc('Filetype: Flipper RFID key\nVersion: 1\nKey type: EM4100\nData: 1A 2B 3C 4D 5E\n'));
  f.files.set('/ext/ibutton/door.ibtn', enc('Filetype: Flipper iButton key\nVersion: 2\nProtocol: DS1990\nRom Data: 01 A2 B3 C4 D5 E6 F7 08\n'));
  f.handleOrig = f.handle;
  f.handle = (m) => {
    if (m.content === 'system_device_info_request') {
      const kv = { hardware_name: 'Rig0', hardware_model: 'Flipper Zero', hardware_ver: '12', firmware_origin_fork: 'Momentum', firmware_version: 'mntm-010', firmware_branch: 'release', firmware_api_major: '87', firmware_api_minor: '1', hardware_target: '7', protobuf_version_major: '0', protobuf_version_minor: '25' };
      const entries = Object.entries(kv);
      entries.forEach(([key, value], i) => f.reply({ command_id: m.command_id, has_next: i < entries.length - 1, system_device_info_response: { key, value } }));
      return;
    }
    f.handleOrig(m);
  };
  f.disconnect = async () => clearInterval(f.streamTimer);
  return f;
}

const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const base = (p) => p.slice(p.lastIndexOf('/') + 1);
