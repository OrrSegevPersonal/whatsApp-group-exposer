(function () {
  'use strict';

  function readFromIndexedDB() {
    return new Promise(function (resolve) {
      var req = indexedDB.open('model-storage');
      req.onerror = function () { resolve([]); };
      req.onsuccess = function (e) {
        var db = e.target.result;
        var storeNames = Array.from(db.objectStoreNames);
        var chats = [];
        var pending = 0;

        function finish() {
          db.close();
          resolve(chats);
        }

        // Read group-metadata for group JIDs + subjects
        if (storeNames.indexOf('group-metadata') !== -1) {
          pending++;
          var tx = db.transaction('group-metadata', 'readonly');
          var all = tx.objectStore('group-metadata').getAll();
          all.onsuccess = function () {
            all.result.forEach(function (item) {
              if (item.id && item.id.endsWith('@g.us')) {
                chats.push({ jid: item.id, name: item.subject || item.id, isGroup: true });
              }
            });
            if (--pending === 0) finish();
          };
          all.onerror = function () { if (--pending === 0) finish(); };
        }

        // Also read the chat store to catch any groups we might have missed
        if (storeNames.indexOf('chat') !== -1) {
          pending++;
          var tx2 = db.transaction('chat', 'readonly');
          var allChats = tx2.objectStore('chat').getAll();
          allChats.onsuccess = function () {
            allChats.result.forEach(function (item) {
              var jid = item.id || (item.key && item.key._serialized);
              if (!jid || !jid.endsWith('@g.us')) return;
              // Only add if not already in the map from group-metadata
              var exists = chats.some(function (c) { return c.jid === jid; });
              if (!exists) {
                chats.push({ jid: jid, name: item.name || item.formattedTitle || jid, isGroup: true });
              }
            });
            if (--pending === 0) finish();
          };
          allChats.onerror = function () { if (--pending === 0) finish(); };
        }

        if (pending === 0) finish();
      };
    });
  }

  function extractAndSend() {
    readFromIndexedDB().then(function (chats) {
      if (!chats.length) {
        console.log('[wa-gid inject] IndexedDB returned 0 chats, will retry');
        return;
      }
      console.log('[wa-gid inject] sending', chats.length, 'chats from IndexedDB');
      window.postMessage({ type: 'WA_CHAT_MAP', chats: chats }, '*');
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'WA_REQUEST_CHATS') {
      console.log('[wa-gid inject] re-fetch requested');
      extractAndSend();
    }
  });

  console.log('[wa-gid inject] script loaded, reading IndexedDB');
  extractAndSend();

  // Retry after a short delay in case IDB isn't ready immediately
  setTimeout(extractAndSend, 2000);
  setTimeout(extractAndSend, 5000);
})();
