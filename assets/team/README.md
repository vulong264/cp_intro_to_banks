# Team photos

build.mjs embeds <key>.webp from this folder for each person the page shows, where <key> is the
person's key in content/en.json (harley, ben, andy, long). A person without a photo gets initials.
A person whose switch in config.json is off is left out, photo included.

original/ holds the cut-outs as supplied. prepare.py crops each to head and shoulders on a light
backdrop and writes the .webp files here:

    python3 assets/team/prepare.py

To add or replace a photo, put the file in original/, add or edit its line in PEOPLE at the top of
prepare.py (the head's horizontal centre and the top of the hair, in pixels), run it, then run
node build.mjs.
