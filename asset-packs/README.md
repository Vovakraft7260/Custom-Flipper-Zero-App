# Community asset packs

Packs in this folder show up in the 0ilrig Trmnl app under **Tools › asset packs**, next to the Momentum packs. Anyone can add one.

## Add your pack

1. Zip your pack. Inside the zip should be the pack's folders: `Anims`, `Icons` and/or `Fonts` (either at the top, or inside one folder named after the pack).
2. On GitHub, open this `asset-packs` folder, press **Add file › Upload files**, and drop the zip in.
   The zip's name becomes the pack's name, for example `Night Ocean.zip`.
3. Choose **Create a new branch and start a pull request**, then press **Propose changes**.

Once it's merged, the app shows it within a few minutes.

A plain folder works too: `asset-packs/<Pack Name>/Anims/...`.

## Optional extras (inside the pack folder or zip)

- `pack.json` with details:
  ```json
  { "author": "your name", "description": "what's in it", "source_url": "https://…" }
  ```
- Preview pictures named `preview.png`, `preview-2.gif` and so on.
  Without them, the app draws the first frame of the first animations.

Packs are built for Momentum firmware (they go to `/ext/asset_packs/` on the Flipper).
Only add packs you made or are allowed to share.
