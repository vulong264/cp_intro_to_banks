# Logos

build.mjs embeds every image in this folder into dist/banks.html, by file name:

| File | Where it shows |
| --- | --- |
| aws-advanced-tier, aws-ai-competency | Credential badges in the hero and footer |
| iso-27001 | The certification body's mark, never the ISO logo, and only while flags.isoMark is on |
| tps, mbbank, tpbank, ensign, buymed, sleek, nanoco | Client panel under the hero, and the proof cards; only while that client's switch is on |
| coderpush | Header and footer wordmark; the text wordmark shows until this file exists |

Raster files (.webp, .png) are drawn at half their pixel size, so prepare them at twice the size you want.
SVG files also work and are sized by their viewBox.

original/ holds the files as supplied. prepare.py turns them into the .webp files here:

    python3 assets/logos/prepare.py

To add or replace a logo, put the supplied file in original/, add or edit its line near the end of
prepare.py, run it, then run node build.mjs. The build prints each logo's size and stops if the page
would pass its size limit.
