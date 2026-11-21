// Web requests that also work for sites without CORS headers (like the Flipper
// app catalog): on the phone they go through Capacitor's native HTTP.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

async function request(url, { method = 'GET', body, binary = false } = {}) {
  const headers = { Accept: binary ? '*/*' : 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: body,
      responseType: binary ? 'arraybuffer' : 'json',
      connectTimeout: 20000,
      readTimeout: 60000,
    });
    if (res.status < 200 || res.status >= 300) throw httpError(res.status, res.data);
    if (!binary) return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    return base64ToBytes(res.data);
  }
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  return binary ? new Uint8Array(await res.arrayBuffer()) : res.json();
}

function httpError(status, data) {
  let detail = '';
  try {
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    detail = d?.detail?.description || d?.detail || '';
  } catch {
    /* not JSON */
  }
  const e = new Error(`Server answered ${status}${detail && typeof detail === 'string' ? `: ${detail}` : ''}`);
  e.status = status;
  return e;
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const http = {
  json: (url, opts) => request(url, opts),
  bytes: (url) => request(url, { binary: true }),
};
