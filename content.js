(function () {
  'use strict';

  var chatMap = new Map(); // jid -> { name, isGroup }

  // ── Inject inject.js into the page world ──────────────────────────────────
  var script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function () { script.remove(); };
  (document.head || document.documentElement).appendChild(script);

  // ── Receive chat map from inject.js ───────────────────────────────────────
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'WA_CHAT_MAP') return;

    var chats = event.data.chats;
    if (!Array.isArray(chats)) return;

    console.log('[wa-gid content] received', chats.length, 'chats');
    chats.forEach(function (c) {
      if (c && c.jid) chatMap.set(c.jid, { name: c.name, isGroup: c.isGroup });
    });

    var groups = Array.from(chatMap.values()).filter(function (v) { return v.isGroup; });
    console.log('[wa-gid content] groups in map:', groups.length);

    annotateAllVisibleRows();
  });

  // ── JID extraction from a row DOM node ────────────────────────────────────
  function extractJidFromRow(row) {
    // Strategy A: data-id on the row itself or an ancestor
    if (row.dataset && row.dataset.id) return row.dataset.id;
    var parent = row.closest('[data-id]');
    if (parent) return parent.dataset.id;

    // Strategy B: name-match against chatMap (fuzzy — handles emoji suffix/prefix)
    var titleEl =
      row.querySelector('[data-testid="cell-frame-title"] span') ||
      row.querySelector('[data-testid="cell-frame-title"]');
    if (!titleEl) return null;
    var domName = titleEl.textContent.trim().replace(/ /g, ' ');
    if (!domName) return null;

    // Exact match first
    for (var entry of chatMap.entries()) {
      if (entry[1].name === domName) return entry[0];
    }
    // Prefix/suffix match: IDB subject may have emoji that DOM strips
    for (var entry of chatMap.entries()) {
      var idbName = entry[1].name;
      if (idbName && (idbName.startsWith(domName) || domName.startsWith(idbName))) {
        return entry[0];
      }
    }

    return null;
  }

  // ── Badge injection ───────────────────────────────────────────────────────
  function annotateAllVisibleRows() {
    var rows = document.querySelectorAll('[data-testid="cell-frame-container"]');
    rows.forEach(function (row) {
      if (row.dataset.gidShown) return;

      var jid = extractJidFromRow(row);
      if (!jid) return;
      if (!jid.endsWith('@g.us')) return;

      // Mark early to prevent double-processing even if info lookup fails
      row.dataset.gidShown = 'true';

      var titleEl = row.querySelector('[data-testid="cell-frame-title"]');
      var insertAfter = titleEl || row;

      var badge = document.createElement('div');
      badge.className = 'wa-group-id-badge';
      badge.textContent = jid;
      badge.title = 'Click to copy JID';
      badge.addEventListener('click', function (e) {
        e.stopPropagation();
        navigator.clipboard.writeText(e.currentTarget.textContent).catch(function () {});
      });
      insertAfter.parentNode.insertBefore(badge, insertAfter.nextSibling);
    });
  }

  // ── MutationObserver on the chat list ─────────────────────────────────────
  function startObserving() {
    var listContainer = document.querySelector('[data-testid="chat-list"]');
    if (!listContainer) {
      setTimeout(startObserving, 500);
      return;
    }

    console.log('[wa-gid content] chat-list found, attaching observer');
    annotateAllVisibleRows();

    var observer = new MutationObserver(function () {
      annotateAllVisibleRows();
    });
    observer.observe(listContainer, { childList: true, subtree: true });
  }

  startObserving();

  // ── Periodic refresh ──────────────────────────────────────────────────────
  setInterval(function () {
    window.postMessage({ type: 'WA_REQUEST_CHATS' }, '*');
  }, 30000);
})();
