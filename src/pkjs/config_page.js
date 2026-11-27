// Builds the settings page shown in the Pebble phone app. The page is a
// self-contained data: URL; it returns its result through pebblejs://close.
//
// Result actions:
//   { action: 'save', settings }        save favorites, defaults and API details
//   { action: 'disconnect', settings }  save, then disconnect Strava
// Connecting navigates to Strava; the hosted callback page
// (docs/strava-callback.html) closes the page with { action: 'oauth', code, state, ... }.

var PAGE_SCRIPT = function () {
  var data = window.CONFIG;
  var sports = data.sports;
  var names = {};
  sports.forEach(function (s) { names[s.id] = s.name; });
  var favorites = data.settings.favorites.filter(function (id) { return names[id]; });
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderFavorites() {
    var list = $('favorites');
    list.innerHTML = '';
    if (!favorites.length) {
      list.appendChild(el('li', { 'class': 'empty' }, 'No favorites yet. The watch will show all types.'));
    }
    favorites.forEach(function (id, i) {
      var li = el('li');
      li.appendChild(el('span', { 'class': 'name' }, names[id]));
      [['↑', -1, i === 0], ['↓', 1, i === favorites.length - 1]].forEach(function (b) {
        var btn = el('button', { type: 'button', 'class': 'icon', 'aria-label': b[1] < 0 ? 'Move up' : 'Move down' }, b[0]);
        btn.disabled = b[2];
        btn.onclick = function () {
          var j = i + b[1];
          favorites[i] = favorites[j];
          favorites[j] = id;
          renderFavorites();
        };
        li.appendChild(btn);
      });
      var remove = el('button', { type: 'button', 'class': 'icon', 'aria-label': 'Remove' }, '×');
      remove.onclick = function () {
        favorites.splice(i, 1);
        renderFavorites();
        renderAvailable();
      };
      li.appendChild(remove);
      list.appendChild(li);
    });
  }

  function renderAvailable() {
    var query = $('search').value.trim().toLowerCase();
    var list = $('available');
    list.innerHTML = '';
    sports.forEach(function (s) {
      if (favorites.indexOf(s.id) >= 0) return;
      if (query && s.name.toLowerCase().indexOf(query) < 0 && s.id.toLowerCase().indexOf(query) < 0) return;
      var li = el('li');
      li.appendChild(el('span', { 'class': 'name' }, s.name));
      var add = el('button', { type: 'button', 'class': 'icon add', 'aria-label': 'Add ' + s.name }, '+');
      add.onclick = function () {
        favorites.push(s.id);
        renderFavorites();
        renderAvailable();
      };
      li.appendChild(add);
      list.appendChild(li);
    });
  }

  function fillSelect(select, value) {
    sports.forEach(function (s) {
      var opt = el('option', { value: s.id }, s.name);
      if (s.id === value) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function collect() {
    var settings = {
      favorites: favorites.slice(),
      defaults: { run: $('def-run').value, walk: $('def-walk').value, workout: $('def-workout').value },
      clientId: $('client-id').value.trim(),
      callbackUrl: $('callback-url').value.trim()
    };
    var secret = $('client-secret').value.trim();
    if (secret) settings.clientSecret = secret;
    return settings;
  }

  function close(result) {
    document.location = 'pebblejs://close#' + encodeURIComponent(JSON.stringify(result));
  }

  function credentialsDirty() {
    return $('client-id').value.trim() !== data.settings.clientId ||
      $('callback-url').value.trim() !== data.settings.callbackUrl ||
      $('client-secret').value.trim() !== '';
  }

  function updateConnect() {
    var btn = $('connect');
    if (!btn) return;
    var ready = data.settings.clientId && data.hasSecret && data.settings.callbackUrl && !credentialsDirty();
    btn.disabled = !ready;
    $('connect-hint').textContent = ready ? ''
      : credentialsDirty() ? 'Save your Strava API details first, then reopen settings to connect.'
      : 'Enter your Strava API details below and save them first.';
  }

  fillSelect($('def-run'), data.settings.defaults.run);
  fillSelect($('def-walk'), data.settings.defaults.walk);
  fillSelect($('def-workout'), data.settings.defaults.workout);
  $('client-id').value = data.settings.clientId;
  $('callback-url').value = data.settings.callbackUrl;
  if (data.hasSecret) $('client-secret').placeholder = 'Saved (leave empty to keep)';
  $('callback-domain').textContent = (function () {
    var m = /^https?:\/\/([^\/:]+)/.exec(data.settings.callbackUrl);
    return m ? m[1] : '';
  })();
  $('api').open = !(data.settings.clientId && data.hasSecret);
  $('search').oninput = renderAvailable;
  ['client-id', 'client-secret', 'callback-url'].forEach(function (id) { $(id).oninput = updateConnect; });

  renderFavorites();
  renderAvailable();
  updateConnect();

  $('save').onclick = function () { close({ action: 'save', settings: collect() }); };

  if ($('disconnect')) {
    $('disconnect').onclick = function () { close({ action: 'disconnect', settings: collect() }); };
  }
  if ($('connect')) {
    $('connect').onclick = function () {
      // Favorites and defaults travel through Strava in `state` so they are
      // not lost; API details are already saved, so no secret leaves the phone.
      var s = collect();
      var state = JSON.stringify({ n: data.nonce, f: s.favorites, d: s.defaults });
      var params = {
        client_id: data.settings.clientId,
        redirect_uri: data.settings.callbackUrl,
        response_type: 'code',
        approval_prompt: 'auto',
        scope: data.scope,
        state: state
      };
      document.location = 'https://www.strava.com/oauth/authorize?' + Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
    };
  }
};

var STYLE = [
  ':root{--bg:#f4f4f5;--card:#fff;--text:#18181b;--muted:#71717a;--line:#e4e4e7;--accent:#fc4c02;--accent-text:#fff}',
  '@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--text:#fafafa;--muted:#a1a1aa;--line:#27272a}}',
  '*{box-sizing:border-box}',
  'body{margin:0;padding:16px;background:var(--bg);color:var(--text);font:16px/1.4 -apple-system,system-ui,sans-serif}',
  'h1{font-size:22px;margin:4px 0 16px}',
  'h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 8px}',
  'section,details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}',
  'summary{font-weight:600;cursor:pointer}',
  'p{margin:6px 0}.muted{color:var(--muted);font-size:14px}',
  'ul{list-style:none;margin:0;padding:0}',
  'li{display:flex;align-items:center;gap:6px;padding:8px 0;border-bottom:1px solid var(--line)}',
  'li:last-child{border-bottom:0}li .name{flex:1}li.empty{color:var(--muted)}',
  '#available{max-height:260px;overflow-y:auto}',
  'button{font:inherit;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);padding:10px 14px}',
  'button:disabled{opacity:.4}',
  'button.icon{width:38px;height:38px;padding:0;font-size:18px}',
  'button.add{color:var(--accent);border-color:var(--accent)}',
  'button.primary{width:100%;background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}',
  'label{display:block;margin:10px 0 4px;font-size:14px;color:var(--muted)}',
  'input,select{width:100%;font:inherit;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text)}',
  'ol{padding-left:20px;margin:8px 0}ol li{display:list-item;border:0;padding:2px 0}',
  'code{font-size:13px;word-break:break-all}'
].join('\n');

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function build(options) {
  var account = options.connected
    ? '<p>Connected' + (options.athlete ? ' as <b>' + escapeHtml(options.athlete) + '</b>' : '') + '.</p>' +
      '<button type="button" id="disconnect">Disconnect Strava</button>'
    : '<p>Not connected.</p>' +
      '<button type="button" class="primary" id="connect">Connect with Strava</button>' +
      '<p class="muted" id="connect-hint"></p>' +
      '<p class="muted">Use email and password to sign in; Google and Apple sign-in may not work inside this page.</p>';

  var config = {
    sports: options.sports,
    settings: options.settings,
    hasSecret: options.hasSecret,
    nonce: options.nonce,
    scope: options.scope
  };

  var html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Workout to Strava</title><style>' + STYLE + '</style></head><body>' +
    '<h1>Workout to Strava</h1>' +
    '<section><h2>Strava account</h2>' + account + '</section>' +
    '<section><h2>Favorite sport types</h2>' +
    '<p class="muted">Shown on the watch in this order.</p><ul id="favorites"></ul></section>' +
    '<section><h2>Add sport types</h2><input id="search" type="search" placeholder="Search">' +
    '<ul id="available"></ul></section>' +
    '<section><h2>Defaults</h2><p class="muted">Pre-selected on the watch for each Pebble workout type.</p>' +
    '<label for="def-run">Pebble Run</label><select id="def-run"></select>' +
    '<label for="def-walk">Pebble Walk</label><select id="def-walk"></select>' +
    '<label for="def-workout">Pebble Open Workout</label><select id="def-workout"></select></section>' +
    '<details id="api"><summary>Strava API app</summary>' +
    '<ol class="muted"><li>Open <code>strava.com/settings/api</code> and create an app.</li>' +
    '<li>Set <b>Authorization Callback Domain</b> to <code id="callback-domain"></code>.</li>' +
    '<li>Copy the Client ID and Client Secret here and save.</li></ol>' +
    '<label for="client-id">Client ID</label><input id="client-id" inputmode="numeric" autocomplete="off">' +
    '<label for="client-secret">Client Secret</label><input id="client-secret" type="password" autocomplete="off">' +
    '<label for="callback-url">Callback page URL</label><input id="callback-url" type="url" autocomplete="off">' +
    '</details>' +
    '<button type="button" class="primary" id="save">Save</button>' +
    '<script>window.CONFIG=' + JSON.stringify(config).replace(/</g, '\\u003c') + ';(' +
    PAGE_SCRIPT.toString() + ')();</script>' +
    '</body></html>';

  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = { build: build };
