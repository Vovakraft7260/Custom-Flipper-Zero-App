// Saves downloaded Flipper files on the phone (Documents/0ilrig).
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

export const SAVE_FOLDER = '0ilrig';

export async function saveToPhone(name, bytes) {
  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile({
      path: `${SAVE_FOLDER}/${name}`,
      data: toBase64(bytes),
      directory: Directory.Documents,
      recursive: true,
    });
    return res.uri;
  }
  // Browser preview: normal download
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
