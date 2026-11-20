// Flipper RPC message types, loaded from the bundled proto definitions (works offline).
import protobuf from 'protobufjs/light.js';
import bundle from './proto-bundle.js';

const root = protobuf.Root.fromJSON(bundle);

export const Main = root.lookupType('PB.Main');
export const CommandStatus = root.lookupEnum('PB.CommandStatus').values;
export const InputKey = root.lookupEnum('PB_Gui.InputKey').values;
export const InputType = root.lookupEnum('PB_Gui.InputType').values;
export const FileType = root.lookupEnum('PB_Storage.File.FileType').values;
export const ScreenOrientation = root.lookupEnum('PB_Gui.ScreenOrientation').values;

const statusNames = Object.fromEntries(Object.entries(CommandStatus).map(([k, v]) => [v, k]));
export const commandStatusName = (code) => statusNames[code] ?? `UNKNOWN_${code}`;

/** Encode one Main message with its varint length prefix, as the Flipper expects. */
export function encodeMain(obj) {
  return Main.encodeDelimited(Main.fromObject(obj)).finish();
}

/** Decode one Main message body (without length prefix) into a plain object. */
export function decodeMain(bytes) {
  const msg = Main.decode(bytes);
  const obj = Main.toObject(msg, { longs: Number, oneofs: true, defaults: false });
  obj.command_id ??= 0;
  obj.command_status ??= 0;
  obj.has_next ??= false;
  return obj;
}
