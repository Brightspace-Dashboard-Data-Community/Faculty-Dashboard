/**
 * D2L Faculty Dashboard - Announcements (read-only)
 * Loads announcements from js/faculty-news-data.js (window.FACULTY_NEWS).
 * To publish: edit that file and redeploy.
 */

(function() {
  'use strict';

  let allNewsItems = [];
  let currentFilter = 'all';

  function loadNewsItems() {
    var source = Array.isArray(window.FACULTY_NEWS) ? window.FACULTY_NEWS : [];
    var items = source.filter(function(item) {
      return !item.archived;
    });

    items.sort(function(a, b) {
      var pinA = a.pinned === true ? 1 : 0;
      var pinB = b.pinned === true ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      var dateA = new Date(a.created_at || a.date || 0).getTime();
      var dateB = new Date(b.created_at || b.date || 0).getTime();
      return dateB - dateA;
    });

    return items;
  }

  function formatDate(dateString) {
    try {
      var date = new Date(dateString);
      var month = date.toLocaleString('default', { month: 'long' });
      var day = date.getDate();
      var year = date.getFullYear();
      return month + ' ' + day + ', ' + year;
    } catch (e) {
      return dateString;
    }
  }

  function isThisWeek(dateString) {
    try {
      var date = new Date(dateString);
      var now = new Date();
      var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return date >= weekAgo && date <= now;
    } catch (e) {
      return false;
    }
  }

  function isUrgent(item) {
    if (item.urgent !== null && item.urgent !== undefined) {
      return item.urgent === true;
    }
    return item.type === 'Error' || isThisWeek(item.date || item.created_at);
  }

  function calculateSummaryStats(newsItems) {
    var errors = newsItems.filter(function(item) { return item.type === 'Error'; }).length;
    var urgent = newsItems.filter(function(item) { return isUrgent(item); }).length;
    var thisWeek = newsItems.filter(function(item) {
      return isThisWeek(item.date || item.created_at);
    }).length;
    var totalActive = newsItems.length;
    var events = newsItems.filter(function(item) { return item.type === 'Update'; }).length;
    var academic = newsItems.filter(function(item) { return item.type === 'Announcement'; }).length;
    var general = newsItems.filter(function(item) { return item.type === 'General'; }).length;

    return { errors: errors, urgent: urgent, thisWeek: thisWeek, totalActive: totalActive, events: events, academic: academic, general: general };
  }

  function getTagClass(type) {
    switch (type) {
      case 'Announcement':
        return 'd2l';
      case 'Error':
        return 'error';
      case 'Update':
        return 'd2l';
      default:
        return 'd2l';
    }
  }

  function getTagIcon(type) {
    switch (type) {
      case 'Announcement':
        return 'fa-bullhorn';
      case 'Error':
        return 'fa-exclamation-triangle';
      case 'Update':
        return 'fa-sync-alt';
      default:
        return 'fa-info-circle';
    }
  }

  function filterNewsItems(newsItems, filterType) {
    if (filterType === 'all') {
      return newsItems;
    } else if (filterType === 'errors') {
      return newsItems.filter(function(item) { return item.type === 'Error'; });
    } else if (filterType === 'urgent') {
      return newsItems.filter(function(item) { return isUrgent(item); });
    } else if (filterType === 'events') {
      return newsItems.filter(function(item) { return item.type === 'Update'; });
    } else if (filterType === 'academic') {
      return newsItems.filter(function(item) { return item.type === 'Announcement'; });
    } else if (filterType === 'general') {
      return newsItems.filter(function(item) { return item.type === 'General'; });
    }
    return newsItems;
  }

  function renderSummaryCards(newsItems) {
    var container = document.getElementById('announcements-summary');
    if (!container) return;

    var stats = calculateSummaryStats(newsItems);

    container.innerHTML =
      '<div class="summary-card">' +
        '<div class="summary-card-header">' +
          '<div class="summary-card-icon errors">' +
            '<i class="fas fa-envelope" aria-hidden="true"></i>' +
          '</div>' +
        '</div>' +
        '<div class="summary-card-value">' + stats.errors + '</div>' +
        '<div class="summary-card-label">Errors</div>' +
      '</div>' +
      '<div class="summary-card">' +
        '<div class="summary-card-header">' +
          '<div class="summary-card-icon urgent">' +
            '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>' +
          '</div>' +
        '</div>' +
        '<div class="summary-card-value">' + stats.urgent + '</div>' +
        '<div class="summary-card-label">Urgent</div>' +
      '</div>' +
      '<div class="summary-card">' +
        '<div class="summary-card-header">' +
          '<div class="summary-card-icon this-week">' +
            '<i class="fas fa-calendar-alt" aria-hidden="true"></i>' +
          '</div>' +
        '</div>' +
        '<div class="summary-card-value">' + stats.thisWeek + '</div>' +
        '<div class="summary-card-label">This Week</div>' +
      '</div>' +
      '<div class="summary-card">' +
        '<div class="summary-card-header">' +
          '<div class="summary-card-icon total-active">' +
            '<i class="fas fa-layer-group" aria-hidden="true"></i>' +
          '</div>' +
        '</div>' +
        '<div class="summary-card-value">' + stats.totalActive + '</div>' +
        '<div class="summary-card-label">Total Active</div>' +
      '</div>';
  }

  function renderFilterButtons(newsItems) {
    var container = document.getElementById('announcements-filters');
    if (!container) return;

    var stats = calculateSummaryStats(newsItems);

    container.innerHTML =
      '<button class="filter-button' + (currentFilter === 'all' ? ' active' : '') + '" data-filter="all">' +
        '<i class="fas fa-th" aria-hidden="true"></i>' +
        '<span>All Announcements</span>' +
        '<span class="filter-badge">' + stats.totalActive + '</span>' +
      '</button>' +
      '<button class="filter-button errors' + (currentFilter === 'errors' ? ' active' : '') + '" data-filter="errors">' +
        '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>' +
        '<span>Errors</span>' +
        '<span class="filter-badge">' + stats.errors + '</span>' +
      '</button>' +
      '<button class="filter-button urgent' + (currentFilter === 'urgent' ? ' active' : '') + '" data-filter="urgent">' +
        '<i class="fas fa-exclamation-triangle" aria-hidden="true"></i>' +
        '<span>Urgent</span>' +
        '<span class="filter-badge">' + stats.urgent + '</span>' +
      '</button>' +
      '<button class="filter-button' + (currentFilter === 'events' ? ' active' : '') + '" data-filter="events">' +
        '<i class="fas fa-calendar-alt" aria-hidden="true"></i>' +
        '<span>Events</span>' +
        '<span class="filter-badge">' + stats.events + '</span>' +
      '</button>' +
      '<button class="filter-button' + (currentFilter === 'academic' ? ' active' : '') + '" data-filter="academic">' +
        '<i class="fas fa-graduation-cap" aria-hidden="true"></i>' +
        '<span>Academic</span>' +
        '<span class="filter-badge">' + stats.academic + '</span>' +
      '</button>' +
      '<button class="filter-button' + (currentFilter === 'general' ? ' active' : '') + '" data-filter="general">' +
        '<i class="fas fa-folder" aria-hidden="true"></i>' +
        '<span>General</span>' +
        '<span class="filter-badge">' + stats.general + '</span>' +
      '</button>';

    container.querySelectorAll('.filter-button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        container.querySelectorAll('.filter-button').forEach(function(b) {
          b.classList.remove('active');
        });
        this.classList.add('active');
        currentFilter = this.dataset.filter;
        renderAnnouncements(allNewsItems);
      });
    });
  }

  function parseTags(tagsString) {
    if (!tagsString || String(tagsString).trim() === '') return [];
    return String(tagsString).split(',').map(function(tag) {
      return tag.trim();
    }).filter(function(tag) {
      return tag.length > 0;
    });
  }

  function getBucketIcon(type) {
    switch (type) {
      case 'Announcement':
        return 'fa-bullhorn';
      case 'Update':
        return 'fa-sync-alt';
      case 'Error':
        return 'fa-exclamation-triangle';
      case 'General':
        return 'fa-folder';
      default:
        return 'fa-bullhorn';
    }
  }

  function getBucketColor(type) {
    switch (type) {
      case 'Announcement':
        return 'var(--primary-green)';
      case 'Update':
        return 'var(--teal-blue)';
      case 'Error':
        return 'var(--error-red)';
      case 'General':
        return 'var(--primary-green)';
      default:
        return 'var(--primary-green)';
    }
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function renderAnnouncementCard(item) {
    var formattedDate = formatDate(item.date || item.created_at);
    var isUrgentItem = isUrgent(item);
    var customTags = parseTags(item.tags || '');
    var content = item.content || '';
    var contentPreview = content.length > 150
      ? content.substring(0, 150) + '...'
      : content;

    var tagsHTML =
      '<span class="announcement-tag bucket" style="background: ' + getBucketColor(item.type) + '15; color: ' + getBucketColor(item.type) + '; border: 1px solid ' + getBucketColor(item.type) + '40;">' +
        '<i class="fas ' + getBucketIcon(item.type) + '" style="font-size: 10px;"></i> ' +
        escapeHtml(item.type || 'Announcement') +
      '</span>';

    if (isUrgentItem && item.type !== 'Error') {
      tagsHTML += '<span class="announcement-tag urgent-tag">D2L</span>';
    } else {
      tagsHTML += '<span class="announcement-tag d2l">D2L</span>';
    }

    customTags.forEach(function(tag) {
      if (isUrgentItem && item.type !== 'Error') {
        tagsHTML += '<span class="announcement-tag urgent-tag">' + escapeHtml(tag) + '</span>';
      } else {
        tagsHTML += '<span class="announcement-tag d2l">' + escapeHtml(tag) + '</span>';
      }
    });

    if (item.type === 'Error') {
      tagsHTML += '<span class="announcement-tag error">ERROR</span>';
    } else if (isUrgentItem && item.type !== 'Error') {
      tagsHTML += '<span class="announcement-tag urgent">URGENT</span>';
    }

    tagsHTML += '<span class="announcement-date">' + formattedDate + '</span>';

    return (
      '<div class="announcement-card" data-id="' + item.id + '" data-type="' + escapeHtml(item.type || 'Announcement') + '">' +
        '<div class="announcement-tags">' + tagsHTML + '</div>' +
        '<h3 class="announcement-title">' + escapeHtml(item.title) + '</h3>' +
        '<div class="announcement-content">' + escapeHtml(contentPreview) + '</div>' +
        '<div class="announcement-author">' +
          '<i class="fas fa-user" aria-hidden="true"></i>' +
          '<span>' + escapeHtml(item.created_by || 'System') + '</span>' +
        '</div>' +
        '<div class="announcement-footer">' +
          '<a href="#" class="announcement-read-link" data-id="' + item.id + '">' +
            'Read Full Announcement <i class="fas fa-arrow-right" aria-hidden="true"></i>' +
          '</a>' +
        '</div>' +
      '</div>'
    );
  }

  function renderAnnouncements(newsItems) {
    allNewsItems = newsItems;

    var filteredItems = filterNewsItems(newsItems, currentFilter);
    var pinnedItems = filteredItems.filter(function(item) { return item.pinned === true; });
    var recentItems = filteredItems.filter(function(item) { return !item.pinned; });

    var pinnedContainer = document.getElementById('pinned-announcements');
    if (pinnedContainer) {
      if (pinnedItems.length > 0) {
        pinnedContainer.innerHTML = pinnedItems.map(renderAnnouncementCard).join('');
      } else {
        pinnedContainer.innerHTML = '<div class="no-announcements">No pinned announcements</div>';
      }
    }

    var recentContainer = document.getElementById('recent-announcements');
    if (recentContainer) {
      if (recentItems.length > 0) {
        recentContainer.innerHTML = recentItems.map(renderAnnouncementCard).join('');
      } else {
        recentContainer.innerHTML = '<div class="no-announcements">No recent announcements</div>';
      }
    }

    addAnnouncementEventHandlers();
  }

  function addAnnouncementEventHandlers() {
    document.querySelectorAll('.announcement-read-link').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        var id = this.dataset.id;
        var item = allNewsItems.find(function(i) {
          return String(i.id) === String(id);
        });
        if (item) {
          showFullAnnouncement(item);
        }
      });
    });
  }

  function showFullAnnouncement(item) {
    var formattedDate = formatDate(item.date || item.created_at);
    var customTags = parseTags(item.tags || '');
    var isUrgentItem = isUrgent(item);

    var tagsHTML =
      '<span class="announcement-tag bucket" style="background: ' + getBucketColor(item.type) + '15; color: ' + getBucketColor(item.type) + '; border: 1px solid ' + getBucketColor(item.type) + '40;">' +
        '<i class="fas ' + getBucketIcon(item.type) + '" style="font-size: 10px;"></i> ' +
        escapeHtml(item.type || 'Announcement') +
      '</span>';

    if (isUrgentItem && item.type !== 'Error') {
      tagsHTML += '<span class="announcement-tag urgent-tag">D2L</span>';
    } else {
      tagsHTML += '<span class="announcement-tag d2l">D2L</span>';
    }

    customTags.forEach(function(tag) {
      if (isUrgentItem && item.type !== 'Error') {
        tagsHTML += '<span class="announcement-tag urgent-tag">' + escapeHtml(tag) + '</span>';
      } else {
        tagsHTML += '<span class="announcement-tag d2l">' + escapeHtml(tag) + '</span>';
      }
    });

    if (item.type === 'Error') {
      tagsHTML += '<span class="announcement-tag error">ERROR</span>';
    } else if (isUrgentItem && item.type !== 'Error') {
      tagsHTML += '<span class="announcement-tag urgent">URGENT</span>';
    }

    tagsHTML += '<span class="announcement-date">' + formattedDate + '</span>';

    var modal = document.createElement('div');
    modal.className = 'announcement-edit-modal-overlay';
    modal.innerHTML =
      '<div class="announcement-edit-modal">' +
        '<div class="modal-header">' +
          '<h3>' + escapeHtml(item.title) + '</h3>' +
          '<button class="modal-close" aria-label="Close modal">' +
            '<i class="fas fa-times"></i>' +
          '</button>' +
        '</div>' +
        '<div class="modal-form">' +
          '<div class="announcement-tags" style="margin-bottom: 16px;">' + tagsHTML + '</div>' +
          '<div class="announcement-content" style="font-size: 15px; line-height: 1.8; margin-bottom: 16px;">' +
            escapeHtml(item.content || '').replace(/\n/g, '<br>') +
          '</div>' +
          '<div class="announcement-author" style="margin-bottom: 0;">' +
            '<i class="fas fa-user" aria-hidden="true"></i>' +
            '<span>' + escapeHtml(item.created_by || 'System') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    var closeModal = function() { modal.remove(); };
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });
  }

  function refreshNewsItems() {
    var newsItems = loadNewsItems();
    renderSummaryCards(newsItems);
    renderFilterButtons(newsItems);
    renderAnnouncements(newsItems);
  }

  function init() {
    refreshNewsItems();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
