// build.mjs adds this script to the copy of the film that ships next to the page (dist/banks-film.html).
// It acts only while the film runs inside the page's player. Opened on its own, the film behaves
// exactly as delivered. It touches nothing inside the film's code: it presses the film's own buttons.
(function () {
  'use strict';
  var page = window.parent;
  if (page === window) return;
  var D = document;
  function el(id) { return D.getElementById(id); }
  function tell(what) { try { page.postMessage({ cpFilm: what }, '*'); } catch (e) {} }
  function press(id) { var b = el(id); if (b) b.click(); return !!b; }

  // The film's two links: the page counts the clicks, and a booking page opens outside the player.
  var book = el('hot-cta'), site = el('hot-site');
  if (book) {
    if (/^https?:/i.test(book.getAttribute('href') || '')) { book.target = '_blank'; book.rel = 'noopener'; }
    book.addEventListener('click', function () { tell('book'); });
  }
  if (site) site.addEventListener('click', function () { tell('site'); });

  // Esc closes the player even while the keyboard is inside the film.
  D.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !D.fullscreenElement && !D.webkitFullscreenElement) tell('close');
  });

  // May this frame play sound right now? Browsers differ, so ask this one by playing a tenth of a
  // second of silence. It answers yes, no, or nothing at all, which counts as no after a moment.
  function soundAllowed(answer) {
    var done = false;
    function end(ok) { if (!done) { done = true; answer(ok); } }
    try {
      var n = 800, bytes = new Uint8Array(44 + n), v = new DataView(bytes.buffer);
      v.setUint32(0, 0x52494646); v.setUint32(4, 36 + n, true); v.setUint32(8, 0x57415645);       // RIFF, size, WAVE
      v.setUint32(12, 0x666d7420); v.setUint32(16, 16, true); v.setUint16(20, 1, true);           // fmt, PCM
      v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);         // mono, 8 kHz
      v.setUint16(32, 1, true); v.setUint16(34, 8, true);                                         // 8 bit
      v.setUint32(36, 0x64617461); v.setUint32(40, n, true);                                      // data, size
      bytes.fill(128, 44);
      var a = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
      var p = a.play();
      if (!p || !p.then) return end(false);
      p.then(function () { a.pause(); end(true); }, function () { end(false); });
      setTimeout(function () { end(false); }, 1500);
    } catch (e) { end(false); }
  }

  function start() {
    tell('ready');
    var film = el('film');
    if (film) film.focus();
    // The visitor pressed play on the page, so the film starts by itself: with sound where the browser
    // allows it, and otherwise muted, with the film's own sound button showing.
    // Under reduced motion it waits for its own play button, as it does on its own.
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    soundAllowed(function (ok) { if (!(ok && press('sound'))) press('big'); });
  }
  if (window.__filmReady) start(); else window.addEventListener('film-ready', start, { once: true });
})();
