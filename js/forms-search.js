/**
 * Faculty Forms page — filter form sections by search query
 * and expand/collapse all category accordions.
 */
(function () {
  'use strict';

  var root = document.getElementById('forms-searchable-region');
  var input = document.getElementById('forms-search-input');
  var clearBtn = document.getElementById('forms-search-clear');
  var emptyMsg = document.getElementById('forms-search-empty');
  var expandAllBtn = document.getElementById('forms-expand-all');
  var collapseAllBtn = document.getElementById('forms-collapse-all');

  if (!root) {
    return;
  }

  function getSections() {
    return root.querySelectorAll('.forms-section');
  }

  function setAllOpen(open) {
    var sections = getSections();
    for (var i = 0; i < sections.length; i++) {
      if (!sections[i].hidden) {
        sections[i].open = open;
      }
    }
  }

  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function getSectionTitleText(h2) {
    if (!h2) {
      return '';
    }
    var clone = h2.cloneNode(true);
    var icons = clone.querySelectorAll('i');
    for (var i = 0; i < icons.length; i++) {
      icons[i].remove();
    }
    return normalize(clone.textContent);
  }

  function filter() {
    if (!input) {
      return;
    }

    var q = normalize(input.value);
    if (clearBtn) {
      clearBtn.hidden = !q;
    }

    var sections = getSections();
    var anyVisible = false;

    for (var s = 0; s < sections.length; s++) {
      var section = sections[s];
      var titleEl = section.querySelector('.forms-section-title');
      var titleText = getSectionTitleText(titleEl);
      var items = section.querySelectorAll('.forms-list-item');
      var sectionVisible = false;

      for (var j = 0; j < items.length; j++) {
        var li = items[j];
        var a = li.querySelector('a');
        var linkText = normalize(a ? a.textContent : '');
        var match = !q || titleText.indexOf(q) !== -1 || linkText.indexOf(q) !== -1;
        li.hidden = !match;
        if (match) {
          sectionVisible = true;
          anyVisible = true;
        }
      }

      section.hidden = !sectionVisible;
      if (q && sectionVisible) {
        section.open = true;
      }
    }

    if (emptyMsg) {
      emptyMsg.hidden = !q || anyVisible;
    }
  }

  if (input) {
    input.addEventListener('input', filter);
    input.addEventListener('search', function () {
      if (!input.value) {
        filter();
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (!input) {
        return;
      }
      input.value = '';
      input.focus();
      filter();
    });
  }

  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', function () {
      setAllOpen(true);
    });
  }

  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', function () {
      setAllOpen(false);
    });
  }
})();
