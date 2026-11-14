# SDA Hymnal beta

Static website for https://ormt03.github.io/SDA-HYMNAL/beta/.
The original homepage is unchanged. Serve the repository root over HTTP to preview `/beta/`.

The beta reuses `../songs.json`, `../songs_es.json`, `../song_mapping.json` and the existing sheet images. 371 English hymn entries have MusicXML, copied from `outputs/SDA_Hymnal_Reviewed`. The Spanish score folder is ready for future reviewed scores. It loads MusicXML first and offers the original image and lyrics. Missing or failed scores fall back to the image.

The source-file hashes are recorded in `score-sources.json` for verifying the included reviewed set.

Run `python3 beta/tools/sync-reviewed.py` from the repository root to refresh the reviewed English collection. The helper validates the snapshot, copies scores, updates the manifest and source hashes, and leaves Git untouched.

## Add a score

1. Copy the ready `.musicxml` file into `beta/musicxml/English/` or `beta/musicxml/Spanish/`, depending on its language.
2. Add its relative URL in `beta/scores.json`, using a key such as `english:111` or `spanish:001`. Use the exact catalog number, including leading zeroes. Prefer the `_Full` score when the catalog uses a combined image.
3. Keep the file and manifest changes together. Availability labels and the filter update from the manifest.

The beta includes OpenSheetMusicDisplay 1.9.2 locally (BSD-3-Clause; see `vendor/OSMD-LICENSE.txt`), with no CDN dependency. It supports offline MusicXML, catalogs, lyrics and rendering through a dedicated beta service worker. Sheet images are network-only and are excluded from downloads. Music playback is not included.

## Checks performed

- JavaScript syntax check.
- All 371 manifest paths exist, parse as MusicXML, and match the reviewed source files by SHA-256.
- Every English and Spanish catalog image exists.
- Browser: hymn 001 and combined hymn 004 render as sheet music; image switch and lyrics work; Spanish numeric search and image fallback work.

Publication uses the repository’s `website` branch. Leave changes uncommitted until publication is requested.

## Offline use on iPhone

Add `/beta/` to the Home Screen from Safari, open the installed app online, and select **Download for offline use**. Keep it open until **Ready offline** appears. Download from the installed app itself, then test in Airplane Mode. Safari and Home Screen storage should not be assumed interchangeable.

The download has file-count progress, verifies every required resource before marking completion, and reuses saved scores when an initial download is interrupted. **Update offline download** refreshes available scores and catalogs. App icons are included; original sheet images are never saved by the beta. When offline, image views show lyrics instead.

`offline-config.js` lists app resources and the cache version. Increment its version/cache name when changing existing app resources or score contents for a new release. New manifest entries are picked up by the update button. The original worker's cleanup preserves beta caches; its other behavior stays unchanged.

Browser verification: saved the 361-score collection before the latest ten additions, shut down the local server, reloaded the app, and rendered newly added hymns 358 and 674 successfully. Search and lyrics were also verified offline with the initial collection. Automated download checks cover interrupted downloads, resume, refresh, completeness, image exclusion and navigation. Home Screen installation and storage behavior still need a check on an actual iPhone.
