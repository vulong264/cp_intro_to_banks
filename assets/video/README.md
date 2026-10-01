# The film

banks-film.html is the overview film as delivered: one self-contained HTML file with its own
player, sound, fonts and pictures, about 1.9 MB. The page never embeds it. It shows a poster, and
fetches the film only when a visitor presses play, then runs it in a frame inside the page.

| File | What it is |
| --- | --- |
| banks-film.html | The film, kept exactly as delivered |
| banks-film-poster.webp | One frame of the film, shown in the hero and while the film loads |
| prepare.mjs | Makes the poster from the film |
| film-embed.js | A small script the build adds to the copy of the film that ships |

With flags.videoReady on, build.mjs writes dist/banks-film.html and copies the poster. The copy
differs from the film here in two ways:

- Its CTA_HREF setting gets the link of the page's "Book a 30-minute intro" button.
- film-embed.js is added before the closing body tag. It acts only while the film runs inside the
  page: it tells the page when the film is ready, starts it (with sound where the browser allows
  it, otherwise muted with the film's own sound button showing), passes Esc and the film's two
  link clicks on to the page, and opens a booking page in a new tab. Opened on its own, the film
  behaves as delivered.

The build stops if the film names a client whose switch is off or a person who is not shown, or
if it contains an em dash or en dash. It warns if the film's player has changed shape.

To replace the film, save the new file as banks-film.html here, then:

    node assets/video/prepare.mjs        the poster, from second 27
    node assets/video/prepare.mjs 12     or from another second
    node build.mjs

prepare.mjs needs Node 22 or newer and a local Chrome. The build itself needs neither.
