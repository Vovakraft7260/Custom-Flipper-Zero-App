# 0ilrig Trmnl

An offline Android control app for the Flipper Zero. It connects over Bluetooth and needs no internet.

> Not affiliated with Flipper Devices. "Flipper Zero" is their trademark.

## What it does (v0.3)

- **Connect:** scan, pair and connect over Bluetooth. Already-paired Flippers show up right away.
- **Device info:** name, firmware (official, Momentum, ...), hardware, battery, SD and internal storage.
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
- **Remote:** live Flipper screen in an orange frame, with the D-pad, OK and Back buttons. Tap for a press, hold for a long press. Pressed buttons appear in a queue and are sent in order.
- **Quick launch:** you pick which apps appear (built-in apps, installed `.fap` apps, or any name).
- **Phone back button:** steps back through sheets, the editor, folders, tools and tabs, and only leaves the app at the end.

## Get the app

Every push builds an APK in GitHub Actions:

1. Open the **Actions** tab, then the latest **Build APK** run.
2. Download **0ilrig-trmnl-apk** under *Artifacts* (it's a zip with the APK inside).
3. Open the APK on your phone and allow "install unknown apps" when Android asks.

Pushing a tag like `v0.1.0` also publishes the APK on the **Releases** page.

### Updates that install over the old version

Without a signing key, builds are debug-signed with a random key, so you may need to uninstall before installing a newer build. To fix that, add these repository secrets: `OILRIG_KEYSTORE_BASE64`, `OILRIG_KEYSTORE_PASSWORD`, `OILRIG_KEY_ALIAS` and `OILRIG_KEY_PASSWORD`. From then on, builds are signed with your own key.

## Troubleshooting

**Can't connect, especially after switching firmware:** on the Flipper, go to *Settings > Bluetooth* and forget all paired devices. Then remove the Flipper in your phone's Bluetooth settings and connect again from the app.

## For developers

- UI is plain HTML/CSS/JS built with Vite and wrapped into Android with [Capacitor](https://capacitorjs.com).
- Bluetooth uses [`@capacitor-community/bluetooth-le`](https://github.com/capacitor-community/bluetooth-le). It talks Flipper RPC (protobuf) over the Flipper's BLE serial service, with the same UUIDs and flow control as the [official app](https://github.com/flipperdevices/Flipper-Android-App).
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
