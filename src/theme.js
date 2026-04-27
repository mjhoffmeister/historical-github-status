// Tiny theme controller. Loaded synchronously from <head> to avoid a
// flash-of-wrong-theme on first paint.
//
// Choices: 'auto' (follow OS), 'light', 'dark'.
// Storage:  localStorage['theme'] (string).
// Effect:   sets data-theme="light"|"dark" on <html>, or removes it for auto.
// Event:    dispatches a 'themechange' CustomEvent on window when applied.
//
// Uses a global object (window.__theme) rather than ES modules so it can
// run synchronously before module scripts load.
(function () {
  var STORE = 'theme';
  var media = (typeof window.matchMedia === 'function')
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

  function read() {
    try {
      var v = localStorage.getItem(STORE);
      if (v === 'light' || v === 'dark' || v === 'auto') return v;
    } catch (_) {}
    return 'auto';
  }

  function effective(choice) {
    if (choice === 'auto') return media && media.matches ? 'dark' : 'light';
    return choice;
  }

  function apply(choice) {
    var root = document.documentElement;
    if (choice === 'auto') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', choice);
    }
    try {
      window.dispatchEvent(new CustomEvent('themechange', {
        detail: { choice: choice, effective: effective(choice) },
      }));
    } catch (_) {}
  }

  function set(choice) {
    if (choice !== 'auto' && choice !== 'light' && choice !== 'dark') choice = 'auto';
    try { localStorage.setItem(STORE, choice); } catch (_) {}
    apply(choice);
  }

  // Initial apply.
  apply(read());

  // When in 'auto', changes to the OS preference must dispatch a themechange
  // so chart code can re-render if needed.
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', function () {
      if (read() === 'auto') apply('auto');
    });
  }

  window.__theme = {
    get: read,
    set: set,
    effective: function () { return effective(read()); },
  };
})();
