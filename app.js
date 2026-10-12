/* Chat Archive Viewer — static, offline. Data comes from data.js (window.CHAT).
 * All message text is treated as hostile: it is HTML-escaped before any formatting is applied,
 * only http(s) links are produced, and nothing remote is ever fetched. */
(function () {
  'use strict';

  var D = window.CHAT;
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    app: $('app'), chat: $('chat'), roomList: $('room-list'), filter: $('room-filter'),
    ws: $('ws-switch'), rhIcon: $('rh-icon'), rhName: $('rh-name'), rhSub: $('rh-sub'),
    modeSeg: $('mode-seg'), dateInput: $('date-input'), toBottom: $('to-bottom'),
    panel: $('search-panel'), sInput: $('search-input'), sStatus: $('sp-status'),
    sResults: $('sp-results'), scopeSeg: $('scope-seg'), footNote: $('foot-note')
  };

  /* ---------- storage helpers (may throw under file:// in some browsers) ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  /* ---------- data prep ---------- */
  var rooms = D.rooms;
  var users = D.users;
  var ALL = [];            // every message in global (chronological) order
  var byId = {};           // message id -> {r, i}
  rooms.forEach(function (room, r) {
    room.idx = r;
    room.first = room.msgs[0][1];
    room.last = room.msgs[room.msgs.length - 1][1];
    room.msgs.forEach(function (m, i) {
      var ref = { r: r, i: i, m: m };
      ALL.push(ref);
      byId[m[0]] = ref;
    });
  });
  ALL.sort(function (a, b) { return a.m[0] - b.m[0]; });
  var wsCounts = D.servers.map(function (_, s) {
    return rooms.reduce(function (n, r) { return n + (r.server === s ? r.msgs.length : 0); }, 0);
  });

  /* ---------- formatting ---------- */
  var EMOJI = {
    grin: '😁', joy: '😂', laughing: '😆', sweat_smile: '😅',
    thumbsup: '👍', hand_splayed: '🖐️', grinning: '😀',
    smile: '😄', rofl: '🤣', nerd: '🤓', sleepy: '😪',
    sunglasses: '😎'
  };

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(text) {
    var stash = [];
    function put(h) { stash.push(h); return '\u0000' + (stash.length - 1) + '\u0000'; }
    var t = String(text).replace(/\u0000/g, '');
    t = t.replace(/```([\s\S]*?)```/g, function (m, c) {
      return put('<pre><code>' + esc(c.replace(/^\n/, '').replace(/\n$/, '')) + '</code></pre>');
    });
    t = t.replace(/`([^`\n]+)`/g, function (m, c) { return put('<code>' + esc(c) + '</code>'); });
    t = t.replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, function (u) {
      var tail = '';
      var mm = u.match(/[.,;:!?)\]}]+$/);
      if (mm) { tail = mm[0]; u = u.slice(0, -tail.length); }
      return put('<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer nofollow" title="External link">' + esc(u) + '</a>') + tail;
    });
    t = esc(t);
    t = t.replace(/^&gt; ?(.*)(\n|$)/gm, '<span class="quote">$1</span>');
    t = t.replace(/(^|[^\w*])(\*{1,2})([^\s*](?:[^*\n]*?[^\s*])?)\2(?![\w*])/g, '$1<b>$3</b>');
    t = t.replace(/(^|[^\w])_([^\s_](?:[^_\n]*?[^\s_])?)_(?!\w)/g, '$1<i>$2</i>');
    t = t.replace(/(^|[^\w~])~([^\s~](?:[^~\n]*?[^\s~])?)~(?![\w~])/g, '$1<s>$2</s>');
    t = t.replace(/(^|[^\w@])@([A-Za-z0-9_.\-]*[A-Za-z0-9_])/g, '$1<span class="mention">@$2</span>');
    t = t.replace(/(^|[^\w:]):([a-z0-9_+\-]+):(?!\w)/g, function (m, p, name) {
      return EMOJI[name] ? p + '<span class="emoji" title=":' + name + ':">' + EMOJI[name] + '</span>' : m;
    });
    return t.replace(/\u0000(\d+)\u0000/g, function (m, i) { return stash[+i]; });
  }

  /* ---------- dates ---------- */
  function dayLabel(ts) {
    var y = +ts.slice(0, 4), mo = +ts.slice(5, 7), d = +ts.slice(8, 10);
    return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', {
      timeZone: 'UTC', weekday: 'short', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
  function tsMs(ts) {
    return Date.UTC(+ts.slice(0, 4), +ts.slice(5, 7) - 1, +ts.slice(8, 10), +ts.slice(11, 13), +ts.slice(14, 16), +ts.slice(17, 19));
  }
  function shortDate(ts) { return ts.slice(0, 10); }

  /* ---------- icons ---------- */
  var ICON = {
    channel: '<svg viewBox="0 0 24 24"><path d="M9.5 3 8.800 7H5v2h3.500l-.7 4H4v2h3.500l-.7 4h2l.7-4h4l-.7 4h2l.7-4H20v-2h-3.500l.7-4H21V7h-3.500l.7-4h-2l-.7 4h-4l.7-4zm.0 6h4l-.7 4h-4z" fill="currentColor"/></svg>',
    group: '<svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 00-5 5v2H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm0 2a3 3 0 013 3v2H9V7a3 3 0 013-3z" fill="currentColor"/></svg>',
    dm: '<svg viewBox="0 0 24 24"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.400 0-8 2.200-8 5v3h16v-3c0-2.800-3.600-5-8-5z" fill="currentColor"/></svg>',
    unnamed: '<svg viewBox="0 0 24 24"><path d="M4 3h16a2 2 0 012 2v11a2 2 0 01-2 2H8l-5 4V5a2 2 0 011-2z" fill="currentColor"/></svg>'
  };

  /* ---------- state ---------- */
  var state = { ws: 0, room: -1, mode: 'en', scope: 'room', hits: [], shown: 0, terms: [] };
  var roomMeta = {};   // roomIdx -> { dayFirst... } (kept minimal)

  /* ---------- sidebar ---------- */
  function renderWorkspaces() {
    els.ws.innerHTML = D.servers.map(function (s, i) {
      return '<button class="ws-btn" role="tab" data-ws="' + i + '" aria-selected="' + (i === state.ws) + '">' +
        '<span class="ws-dot"></span><span class="ws-name">' + esc(s) + '</span>' +
        '<span class="ws-n">' + wsCounts[i].toLocaleString() + '</span></button>';
    }).join('');
  }

  function roomItem(room) {
    var active = room.idx === state.room ? ' active' : '';
    return '<button class="rl-item' + active + '" data-room="' + room.idx + '" title="' + esc(room.id) + '">' +
      '<span class="rl-ico">' + ICON[room.type] + '</span>' +
      '<span class="rl-label">' + esc(room.label) + '</span>' +
      '<span class="rl-count">' + room.msgs.length.toLocaleString() + '</span></button>';
  }

  function renderRoomList() {
    var q = els.filter.value.trim().toLowerCase();
    var list = rooms.filter(function (r) {
      if (r.server !== state.ws) return false;
      if (!q) return true;
      return (r.label + ' ' + r.id + ' ' + r.participants.join(' ')).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.last < b.last ? 1 : a.last > b.last ? -1 : 0; });
    var sections = [
      ['Channels', function (r) { return r.type === 'channel' || r.type === 'group'; }],
      ['Direct messages', function (r) { return r.type === 'dm'; }],
      ['Other conversations', function (r) { return r.type === 'unnamed'; }]
    ];
    var html = '';
    sections.forEach(function (s) {
      var items = list.filter(s[1]);
      if (items.length) html += '<div class="rl-section">' + s[0] + '</div>' + items.map(roomItem).join('');
    });
    els.roomList.innerHTML = html || '<div class="rl-none">No matching rooms</div>';
  }

  function markActiveRoom() {
    var prev = els.roomList.querySelector('.rl-item.active');
    if (prev) prev.classList.remove('active');
    var cur = els.roomList.querySelector('[data-room="' + state.room + '"]');
    if (cur) cur.classList.add('active');
  }

  /* ---------- room rendering ---------- */
  function avatarClass(u) {
    var h = 0;
    for (var i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0;
    return u === 'rocket.cat' ? 'c7' : 'c' + (h % 7);
  }

  function rowHTML(m, prev) {
    var ts = m[1], user = users[m[2]], ru = m[3] === 1;
    var newDay = !prev || shortDate(prev[1]) !== shortDate(ts);
    var first = newDay || users[prev[2]] !== user || tsMs(ts) - tsMs(prev[1]) > 5 * 60000;
    var h = '';
    if (newDay) h += '<div class="day">' + esc(dayLabel(ts)) + '</div>';
    var sys = user === 'rocket.cat';
    h += '<div class="msg' + (first ? ' first' : '') + (sys ? ' system' : '') + '" data-id="' + m[0] + '">';
    h += '<div class="gutter">';
    h += first
      ? '<div class="avatar ' + avatarClass(user) + '" aria-hidden="true">' + esc(user.charAt(0)) + '</div>'
      : '<span class="gutter-time">' + ts.slice(11, 16) + '</span>';
    h += '</div><div class="m-main">';
    if (first) {
      h += '<div class="m-head"><span class="m-user' + (sys ? ' bot' : '') + '">' + esc(user) + '</span>' +
        (sys ? '<span class="badge">bot</span>' : '') +
        '<span class="m-time" title="' + ts.replace('T', ' ') + '">' + ts.slice(11, 16) + '</span>' +
        '<span class="badge' + (ru ? ' ru' : '') + '">' + (ru ? 'RU → EN' : 'EN') + '</span></div>';
    }
    h += '<button class="m-id" data-link="' + m[0] + '" title="Copy link to this message">#' + m[0] + '</button>';
    if (ru) {
      h += '<div class="m-body v-en">' + fmt(m[5]) + '</div>';
      h += '<div class="v-orig v-orig-box"><div class="lang-tag">ORIGINAL (RU)</div><div class="m-body">' + fmt(m[4]) + '</div></div>';
      h += '<button class="m-toggle"><span class="t-a">Show original</span><span class="t-b">Show translation</span><span class="t-c">Hide original</span></button>';
    } else {
      h += '<div class="m-body">' + fmt(m[4]) + '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function scrollToBottom() {
    var c = els.chat;
    c.scrollTop = c.scrollHeight;
    requestAnimationFrame(function () { c.scrollTop = c.scrollHeight; updateToBottom(); });
    setTimeout(function () { c.scrollTop = c.scrollHeight; updateToBottom(); }, 120);
  }

  function showMessage(id) {
    var el = els.chat.querySelector('.msg[data-id="' + id + '"]');
    if (!el) return false;
    function go() { el.scrollIntoView({ block: 'center' }); }
    go();
    requestAnimationFrame(go);
    setTimeout(go, 150);
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    return true;
  }

  function setHash(room, id) {
    try {
      history.replaceState(null, '', '#r=' + room + (id ? '&m=' + id : ''));
    } catch (e) { /* file:// restrictions */ }
  }

  function openRoom(r, msgId, opts) {
    opts = opts || {};
    var room = rooms[r];
    if (!room) return;
    state.room = r;
    if (state.ws !== room.server) { state.ws = room.server; renderWorkspaces(); renderRoomList(); }
    markActiveRoom();

    var parts = [], prev = null;
    var msgs = room.msgs;
    for (var i = 0; i < msgs.length; i++) { parts.push(rowHTML(msgs[i], prev)); prev = msgs[i]; }
    els.chat.classList.toggle('big', msgs.length > 600);
    els.chat.innerHTML = parts.join('');

    els.rhIcon.innerHTML = ICON[room.type];
    els.rhName.textContent = room.label;
    var kind = { channel: 'Public channel', group: 'Private group', dm: 'Direct message', unnamed: 'Conversation' }[room.type];
    els.rhSub.innerHTML = esc(kind) + ' · ' + esc(room.participants.join(', ')) + ' · ' +
      msgs.length.toLocaleString() + ' messages · ' + esc(shortDate(room.first)) + ' → ' + esc(shortDate(room.last)) +
      ' · ID <button class="copy-id" data-copy="' + esc(room.id) + '" title="Copy room ID">' + esc(room.id) + '</button>';
    els.dateInput.min = shortDate(room.first);
    els.dateInput.max = shortDate(room.last);
    els.dateInput.value = '';
    document.title = room.label + ' — Chat Archive Viewer';

    if (msgId && showMessage(msgId)) setHash(r, msgId);
    else { scrollToBottom(); setHash(r); }
    if (!opts.keepSidebar) closeDrawer();
    if (state.scope === 'room' && !els.panel.hidden) runSearch();
  }

  /* ---------- mode toggle ---------- */
  function setMode(mode) {
    state.mode = mode;
    lsSet('cav-mode', mode);
    els.chat.classList.remove('mode-en', 'mode-orig', 'mode-both');
    els.chat.classList.add('mode-' + mode);
    var ov = els.chat.querySelectorAll('[data-ov]');
    for (var i = 0; i < ov.length; i++) ov[i].removeAttribute('data-ov');
    Array.prototype.forEach.call(els.modeSeg.children, function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-mode') === mode));
    });
  }

  function toggleRow(row) {
    var cur = row.getAttribute('data-ov') || state.mode;
    var next = cur === 'en' ? 'orig' : 'en';
    if (next === state.mode) row.removeAttribute('data-ov');
    else row.setAttribute('data-ov', next);
  }

  /* ---------- scroll helpers ---------- */
  var tbRaf = 0;
  function updateToBottom() {
    var c = els.chat;
    els.toBottom.hidden = c.scrollHeight - c.scrollTop - c.clientHeight < 300;
  }
  els.chat.addEventListener('scroll', function () {
    if (tbRaf) return;
    tbRaf = requestAnimationFrame(function () { tbRaf = 0; updateToBottom(); });
  });
  els.toBottom.addEventListener('click', scrollToBottom);

  /* ---------- toast / clipboard ---------- */
  var toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.className = 'offscreen';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      toast(ok ? 'Copied' : 'Copy failed');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, fallback);
    } else fallback();
  }

  /* ---------- search ---------- */
  var lcCache = null;
  function lcFor(ref) {
    if (!lcCache) lcCache = {};
    var m = ref.m, k = m[0];
    return lcCache[k] || (lcCache[k] = (m[4] + '\n' + (m[5] || '')).toLowerCase());
  }

  function highlight(text, terms) {
    if (!terms.length) return esc(text);
    var lower = text.toLowerCase(), out = '', pos = 0;
    while (pos < text.length) {
      var best = -1, bestLen = 0;
      for (var i = 0; i < terms.length; i++) {
        var at = lower.indexOf(terms[i], pos);
        if (at !== -1 && (best === -1 || at < best || (at === best && terms[i].length > bestLen))) { best = at; bestLen = terms[i].length; }
      }
      if (best === -1) break;
      out += esc(text.slice(pos, best)) + '<mark>' + esc(text.slice(best, best + bestLen)) + '</mark>';
      pos = best + bestLen;
    }
    return out + esc(text.slice(pos));
  }

  function snippet(text, terms) {
    var max = 240;
    if (text.length <= max) return text;
    var lower = text.toLowerCase(), at = -1;
    for (var i = 0; i < terms.length; i++) { var p = lower.indexOf(terms[i]); if (p !== -1 && (at === -1 || p < at)) at = p; }
    var start = Math.max(0, (at === -1 ? 0 : at) - 70);
    return (start > 0 ? '…' : '') + text.slice(start, start + max) + (start + max < text.length ? '…' : '');
  }

  function runSearch() {
    var q = els.sInput.value.trim().toLowerCase();
    var terms = q.split(/\s+/).filter(Boolean);
    state.terms = terms;
    if (!terms.length) {
      state.hits = []; els.sResults.innerHTML = ''; els.sStatus.textContent = 'Type to search both the Russian originals and the English translations.';
      return;
    }
    var hits = [];
    for (var i = 0; i < ALL.length; i++) {
      var ref = ALL[i];
      if (state.scope === 'room' && ref.r !== state.room) continue;
      var lc = lcFor(ref), ok = true;
      for (var t = 0; t < terms.length; t++) if (lc.indexOf(terms[t]) === -1) { ok = false; break; }
      if (ok) hits.push(ref);
    }
    state.hits = hits;
    state.shown = 0;
    els.sResults.innerHTML = '';
    els.sStatus.textContent = hits.length.toLocaleString() + ' match' + (hits.length === 1 ? '' : 'es') +
      (state.scope === 'room' ? ' in this room' : ' across all rooms');
    appendHits();
  }

  function appendHits() {
    var end = Math.min(state.hits.length, state.shown + 100), h = '';
    for (var i = state.shown; i < end; i++) {
      var ref = state.hits[i], m = ref.m, room = rooms[ref.r], ru = m[3] === 1;
      h += '<button class="hit" data-room="' + ref.r + '" data-msg="' + m[0] + '"><div class="hit-head">' +
        (state.scope === 'all' ? '<span class="hit-room">' + esc(room.label) + '</span>' : '') +
        '<b>' + esc(users[m[2]]) + '</b><span>' + esc(m[1].replace('T', ' ')) + '</span></div>' +
        '<div class="hit-text">' + highlight(snippet(ru ? m[5] : m[4], state.terms), state.terms) + '</div>' +
        (ru ? '<div class="hit-alt">' + highlight(snippet(m[4], state.terms), state.terms) + '</div>' : '') + '</button>';
    }
    state.shown = end;
    var old = els.sResults.querySelector('.more');
    if (old) old.remove();
    els.sResults.insertAdjacentHTML('beforeend', h);
    if (end < state.hits.length) {
      els.sResults.insertAdjacentHTML('beforeend', '<button class="hit more">Show more (' + (state.hits.length - end).toLocaleString() + ' remaining)</button>');
    }
  }

  function openSearch() {
    els.panel.hidden = false;
    els.sInput.focus();
    els.sInput.select();
    if (!els.sInput.value) runSearch();
  }
  function closeSearch() { els.panel.hidden = true; }

  function setScope(scope) {
    state.scope = scope;
    Array.prototype.forEach.call(els.scopeSeg.children, function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-scope') === scope));
    });
  }

  /* ---------- drawer (mobile) ---------- */
  function openDrawer() { els.app.classList.add('sb-open'); }
  function closeDrawer() { els.app.classList.remove('sb-open'); }

  /* ---------- theme ---------- */
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    lsSet('cav-theme', t);
  }

  /* ---------- events ---------- */
  els.roomList.addEventListener('click', function (e) {
    var b = e.target.closest('[data-room]');
    if (b) openRoom(+b.getAttribute('data-room'));
  });
  els.ws.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ws]');
    if (!b) return;
    state.ws = +b.getAttribute('data-ws');
    renderWorkspaces(); renderRoomList();
    var first = els.roomList.querySelector('[data-room]');
    if (first) openRoom(+first.getAttribute('data-room'), null, { keepSidebar: true });
  });
  els.filter.addEventListener('input', renderRoomList);
  els.modeSeg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]');
    if (b) setMode(b.getAttribute('data-mode'));
  });
  els.chat.addEventListener('click', function (e) {
    var t = e.target.closest('.m-toggle');
    if (t) { toggleRow(t.closest('.msg')); return; }
    var l = e.target.closest('.m-id');
    if (l) {
      var id = l.getAttribute('data-link');
      copyText(location.href.split('#')[0] + '#r=' + byId[id].r + '&m=' + id);
    }
  });
  els.rhSub.addEventListener('click', function (e) {
    var c = e.target.closest('.copy-id');
    if (c) copyText(c.getAttribute('data-copy'));
  });
  els.dateInput.addEventListener('change', function () {
    var v = els.dateInput.value;
    if (!v || state.room < 0) return;
    var msgs = rooms[state.room].msgs;
    for (var i = 0; i < msgs.length; i++) {
      if (shortDate(msgs[i][1]) >= v) { showMessage(msgs[i][0]); setHash(state.room, msgs[i][0]); return; }
    }
    scrollToBottom();
  });
  $('btn-search').addEventListener('click', function () { els.panel.hidden ? openSearch() : closeSearch(); });
  $('sp-close').addEventListener('click', closeSearch);
  var searchTimer = 0;
  els.sInput.addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 180); });
  els.scopeSeg.addEventListener('click', function (e) {
    var b = e.target.closest('[data-scope]');
    if (b) { setScope(b.getAttribute('data-scope')); runSearch(); }
  });
  els.sResults.addEventListener('click', function (e) {
    if (e.target.closest('.more')) { appendHits(); return; }
    var h = e.target.closest('.hit');
    if (!h) return;
    openRoom(+h.getAttribute('data-room'), +h.getAttribute('data-msg'), { keepSidebar: true });
    if (window.matchMedia('(max-width: 900px)').matches) closeSearch();
  });
  $('btn-theme').addEventListener('click', function () {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  $('sb-open').addEventListener('click', openDrawer);
  $('sb-close').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === '/' && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); openSearch(); }
    else if (e.key === 'Escape') { if (!els.panel.hidden) closeSearch(); closeDrawer(); }
  });
  window.addEventListener('hashchange', function () { routeFromHash(); });

  /* ---------- boot ---------- */
  function routeFromHash() {
    var m = location.hash.match(/^#r=(\d+)(?:&m=(\d+))?$/);
    if (!m || !rooms[+m[1]]) return false;
    var msg = m[2] ? +m[2] : null;
    if (msg && (!byId[msg] || byId[msg].r !== +m[1])) msg = null;
    if (+m[1] === state.room && msg) { showMessage(msg); return true; }
    openRoom(+m[1], msg, { keepSidebar: true });
    return true;
  }

  (function init() {
    var theme = lsGet('cav-theme') ||
      (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(theme);
    var mode = lsGet('cav-mode');
    setMode(mode === 'orig' || mode === 'both' ? mode : 'en');
    setScope('room');
    els.footNote.textContent = D.meta.count.toLocaleString() + ' messages · ' + D.meta.translated.toLocaleString() +
      ' machine-translated RU→EN · times as exported';
    els.footNote.title = 'Translation: ' + (D.meta.model || 'unknown');

    // default room: the busiest one, unless the URL points somewhere
    var biggest = 0;
    rooms.forEach(function (r, i) { if (r.msgs.length > rooms[biggest].msgs.length) biggest = i; });
    state.ws = rooms[biggest].server;
    renderWorkspaces();
    renderRoomList();
    if (!routeFromHash()) openRoom(biggest, null, { keepSidebar: true });
  })();
})();
