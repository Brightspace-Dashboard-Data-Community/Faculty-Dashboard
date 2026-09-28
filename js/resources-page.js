/**
 * Faculty Resources page – FAQ accordion (matches Student Dashboard support.html behavior).
 */
(function () {
  'use strict';
  document.querySelectorAll('.faq-question').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var expanded = btn.getAttribute('aria-expanded') === 'true';
      var id = btn.getAttribute('aria-controls');
      var panel = id ? document.getElementById(id) : null;
      btn.setAttribute('aria-expanded', String(!expanded));
      if (panel) {
        panel.hidden = expanded;
      }
    });
  });
})();
