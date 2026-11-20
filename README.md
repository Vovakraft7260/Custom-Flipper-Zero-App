# 0ilrig Trmnl

An offline Android control app for the Flipper Zero. It connects over Bluetooth and needs no internet.

> Not affiliated with Flipper Devices. "Flipper Zero" is their trademark.

## What it does (v0.1)

- **Connect:** scan, pair and connect over Bluetooth. Already-paired Flippers show up right away.
- **Device info:** name, firmware (official, Momentum, ...), hardware, battery, SD and internal storage.
- **File manager:** browse, upload from the phone, save to the phone (`Documents/0ilrig`), rename, delete, make folders, select many files at once.
- **Text editor:** edit `.txt`, `.ir`, `.sub`, `.nfc`, `.rfid`, Bad USB scripts and more, then save them straight back to the Flipper.
- **Run / open on Flipper:** start `.fap` apps, or open `.sub`, `.nfc`, `.ir`, `.rfid`, `.ibtn` and Bad USB files in their Flipper app.
- **Remote:** live Flipper screen with the D-pad, OK and Back buttons. Tap for a press, hold for a long press. Also has quick buttons to launch the built-in apps.

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
src/flipper/   protocol: ble.js (transport), rpc.js, framing.js, api.js, screen.js, demo.js (pretend Flipper)
src/ui/        screens: device, files, editor, remote
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
