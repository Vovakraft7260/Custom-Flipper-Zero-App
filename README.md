# 0ilrig Trmnl

An offline Android control app for the Flipper Zero. It connects over Bluetooth and needs no internet.

> Not affiliated with Flipper Devices. "Flipper Zero" is their trademark.

## What it does (v0.5)

- **Connect:** scan, pair and connect over Bluetooth. Already-paired Flippers show up right away.
- **Device info:** name, firmware (official, Momentum, ...), hardware, battery, SD and internal storage.
- **Saved on Flipper:** Sub-GHz, NFC, RFID, Infrared, iButton and Bad USB items show as cards (like the official app's archive), with search and ★ favorites. Tap a card to open it. Rename and delete are inside the item's ⋯ menu, behind a confirm, so a stray tap can't delete anything.
- **Tools tab:**
  - **File manager:** browse, upload from the phone, save to the phone (`Documents/0ilrig`), rename, delete, make folders, select many files at once, and edit text files.
  - **Bad USB:** write, edit and run scripts (`/ext/badusb`). Works with both "Bad USB" (official) and "Bad KB" (Momentum).
  - **JS scripts:** write, edit and run Flipper JavaScript (`/ext/apps/Scripts`) with JS Runner.
  - **Signal folders:** Sub-GHz, NFC, RFID, Infrared, iButton and apps, each opening the file manager in its own folder.
- **Signal viewers (tap a signal file):**
  - **Infrared:** the `.ir` file becomes a remote. Tap a button and the Flipper sends it.
  - **Sub-GHz:** frequency, modulation, protocol and key, plus a waveform picture for RAW recordings. Hold to send.
  - **NFC / RFID / iButton:** card details (type, UID, data) and an emulate on/off button.
  - Sending works the way the official app does it: the Flipper app opens in RPC mode, loads the file and "presses" its button.
- **Universal TV remote (Tools tab):** a full remote for 105 TV brands: power, source, mute, D-pad with OK, back, home, menu, exit, info, guide, volume, channel, numbers, media and color keys, and app buttons. Several code sets per brand, a **save to Flipper** button (keeps the remote in Infrared so it works without the phone), and a "find my brand" scan for unknown TVs. The codes are bundled from [Flipper-IRDB](https://github.com/Lucaslhm/Flipper-IRDB) (CC0), so it works offline.
- **Remote:** live Flipper screen in an orange frame, with the D-pad, OK and Back buttons. Tap for a press, hold for a long press. Pressed buttons appear in a queue and are sent in order.
- **Quick launch:** you pick which apps appear (built-in apps, installed `.fap` apps, or any name).
- **Phone back button:** steps back through sheets, the editor, folders, tools and tabs, and only leaves the app at the end.

## Get the app

Every push builds an APK in GitHub Actions:

1. Open the **Actions** tab, then the latest **Build APK** run.
2. Download **0ilrig-trmnl-apk** under *Artifacts* (it's a zip with the APK inside).
3. Open the APK on your phone and allow "install unknown apps" when Android asks.

Once the signing key is set up (below), every change on `main` also publishes the APK on the **Releases** page, so you can grab it there without unzipping.

### Updates

The app checks the Releases page when it opens (and from **check for updates** on the connect screen). If there's a newer build it asks you; tap **download & install**, then open the downloaded file and choose *Update*. No internet? It just skips the check.

Want it fully hands-off? Add this repo to [Obtainium](https://github.com/ImranR98/Obtainium); it watches Releases and updates the app for you.

### Signing key (needed for updates)

Without a signing key, builds are debug-signed with a random key, so you may need to uninstall before installing a newer build. To fix that, add these repository secrets: `OILRIG_KEYSTORE_BASE64`, `OILRIG_KEYSTORE_PASSWORD`, `OILRIG_KEY_ALIAS` and `OILRIG_KEY_PASSWORD`. From then on, builds are signed with your own key and published as releases. Switching from a debug build to the first signed build needs one uninstall.

## Troubleshooting

**Can't connect, especially after switching firmware:** on the Flipper, go to *Settings > Bluetooth* and forget all paired devices. Then remove the Flipper in your phone's Bluetooth settings and connect again from the app.

## For developers

- UI is plain HTML/CSS/JS built with Vite and wrapped into Android with [Capacitor](https://capacitorjs.com).
- Bluetooth uses [`@capacitor-community/bluetooth-le`](https://github.com/capacitor-community/bluetooth-le). It talks Flipper RPC (protobuf) over the Flipper's BLE serial service, with the same UUIDs and flow control as the [official app](https://github.com/flipperdevices/Flipper-Android-App).
- `src/remote/tv-codes.js` is generated from Flipper-IRDB with `node scripts/build-tv-remotes.mjs <path to Flipper-IRDB/TVs>`.
- `proto/` holds Flipper's [protobuf definitions](https://github.com/flipperdevices/flipperzero-protobuf). `npm run proto` regenerates `src/flipper/proto-bundle.js`.

```
src/flipper/   protocol: ble.js (transport), rpc.js, framing.js, api.js, screen.js, emulate.js, flipperformat.js, demo.js (pretend Flipper)
src/ui/        screens: device, tools (files, script tools), signals (viewers), editor, remote
test/          node tests against the pretend Flipper
```

```sh
npm install
npm test             # protocol tests
npm run dev          # browser preview, then press "try demo" (no Flipper needed)
npm run android:sync # build and copy into android/ (needs Android Studio / SDK to build locally)
```

## License

GPL-3.0. See [LICENSE](LICENSE).
