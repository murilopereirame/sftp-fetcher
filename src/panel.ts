/**
 * The web panel.
 *
 * One page, no framework. The rule of this project is one dependency, so the
 * page is a plain string with its own CSS and its own script. The script asks
 * the "/api" endpoints every few seconds and draws the result.
 *
 * The panel has five tabs, like Sonarr and Radarr:
 *   Activity   the running download and the queue
 *   Files      the files that this program put on the local disk
 *   History    every event: grabbed, downloaded, failed
 *   Events     the last log lines
 *   Settings   the chown/chmod, cleanup, and log-level preferences
 *
 * The look follows Material 3: the color roles (surface, primary, the
 * "container" tone for each status), the pill-shaped filled and tonal
 * buttons, and the shape/elevation scale. It ships as plain CSS custom
 * properties, not a framework: a light and a dark token set live on
 * :root/[data-theme], so the page follows the browser's preference by
 * default, with a manual toggle (top right) that overrides it and is
 * remembered in localStorage.
 *
 * The client script uses "+" to build strings, never a backtick and never a
 * dollar-brace. Those would break this template literal at build time. Any
 * symbol (an emoji, an em dash) is written as an HTML numeric entity in
 * markup, or a "\\u" escape inside a JS string, for the same reason: this
 * whole file is itself one template literal, so a stray backtick anywhere in
 * it — even in a CSS value or a comment — would end the file early.
 */
export const panelHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sftp-fetcher</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#128225;</text></svg>">
<style>
  /* Material 3 baseline color roles, light theme (the default). */
  :root {
    --bg: #fffbfe;
    --panel: #f3edf7;
    --panel2: #ece6f0;
    --line: #cac4d0;
    --outline: #79747e;
    --text: #1d1b20;
    --muted: #49454f;
    --accent: #6750a4;
    --on-accent: #ffffff;
    --accent-container: #eaddff;
    --on-accent-container: #21005d;
    --tertiary: #7d5260;
    --tertiary-container: #ffd8e4;
    --green: #2e7d32;
    --green-container: #c8e6c9;
    --red: #b3261e;
    --red-container: #f9dedc;
    --amber: #7a5900;
    --amber-container: #ffdea6;
    --ring: rgba(103, 80, 164, .18);
    --shadow: 0 1px 2px rgba(0, 0, 0, .12), 0 1px 3px rgba(0, 0, 0, .1);
  }
  /* The dark set, by system preference... */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #141218;
      --panel: #211f26;
      --panel2: #2b2930;
      --line: #49454f;
      --outline: #938f99;
      --text: #e6e0e9;
      --muted: #cac4d0;
      --accent: #d0bcff;
      --on-accent: #381e72;
      --accent-container: #4f378b;
      --on-accent-container: #eaddff;
      --tertiary: #efb8c8;
      --tertiary-container: #633b48;
      --green: #a5d6a7;
      --green-container: #1b5e20;
      --red: #f2b8b5;
      --red-container: #8c1d18;
      --amber: #ffd599;
      --amber-container: #5c4200;
      --ring: rgba(208, 188, 255, .22);
      --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 1px 3px rgba(0, 0, 0, .4);
    }
  }
  /* ...or by the header toggle, which always wins over the system setting. */
  :root[data-theme="dark"] {
    --bg: #141218;
    --panel: #211f26;
    --panel2: #2b2930;
    --line: #49454f;
    --outline: #938f99;
    --text: #e6e0e9;
    --muted: #cac4d0;
    --accent: #d0bcff;
    --on-accent: #381e72;
    --accent-container: #4f378b;
    --on-accent-container: #eaddff;
    --tertiary: #efb8c8;
    --tertiary-container: #633b48;
    --green: #a5d6a7;
    --green-container: #1b5e20;
    --red: #f2b8b5;
    --red-container: #8c1d18;
    --amber: #ffd599;
    --amber-container: #5c4200;
    --ring: rgba(208, 188, 255, .22);
    --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 1px 3px rgba(0, 0, 0, .4);
  }
  * { box-sizing: border-box; }
  * { scrollbar-color: var(--line) transparent; scrollbar-width: thin; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 8px; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    box-shadow: var(--shadow);
    position: sticky;
    top: 0;
    z-index: 5;
  }
  header .logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; letter-spacing: .1px; }
  header .logo-mark { font-size: 18px; line-height: 1; }
  header .sub { color: var(--muted); font-size: 12px; }
  .icon-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 16px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background .15s ease;
  }
  .icon-btn:hover { background: var(--panel2); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .dot.live { background: var(--green); animation: pulse 1.8s ease-in-out infinite; }
  .dot.idle { background: var(--muted); }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 var(--ring); }
    50% { box-shadow: 0 0 0 5px var(--ring); }
  }
  .spacer { flex: 1; }
  nav {
    display: flex;
    gap: 4px;
    padding: 0 12px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    position: sticky;
    top: 63px;
    z-index: 4;
  }
  nav button {
    background: none;
    border: none;
    color: var(--muted);
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    border-radius: 8px 8px 0 0;
    border-bottom: 3px solid transparent;
    transition: background .15s ease, color .15s ease;
  }
  nav button:hover { color: var(--text); background: var(--panel2); }
  nav button.on { color: var(--accent); background: var(--panel2); border-bottom-color: var(--accent); }
  nav .count {
    display: inline-block;
    min-width: 18px;
    padding: 0 5px;
    margin-left: 6px;
    border-radius: 9px;
    background: var(--panel2);
    color: var(--muted);
    font-size: 11px;
    text-align: center;
  }
  nav button.on .count { background: var(--accent-container); color: var(--on-accent-container); }
  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  .tab { display: none; }
  .tab.on { display: block; }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 16px;
    box-shadow: var(--shadow);
  }
  .card h2 { margin: 0 0 12px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }
  .bar { height: 8px; border-radius: 999px; background: var(--panel2); overflow: hidden; }
  .bar > span { display: block; height: 100%; border-radius: 999px; background: var(--accent); transition: width .3s ease; }
  .dl-title { font-weight: 600; margin-bottom: 2px; }
  .dl-name { color: var(--muted); font-size: 12px; margin-bottom: 12px; word-break: break-all; }
  .dl-meta { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 12px; font-size: 13px; }
  .dl-meta b { display: block; color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 11px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
  th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  tr:last-child td { border-bottom: none; }
  tbody tr { transition: background .1s ease; }
  tbody tr:hover { background: var(--panel2); }
  td.num { text-align: right; white-space: nowrap; color: var(--muted); }
  .table-wrap { overflow-x: auto; }
  .path { word-break: break-all; }
  .tag {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    text-transform: capitalize;
  }
  .tag.grabbed { background: var(--accent-container); color: var(--on-accent-container); }
  .tag.downloaded { background: var(--green-container); color: var(--green); }
  .tag.failed { background: var(--red-container); color: var(--red); }
  .tag.expired { background: var(--amber-container); color: var(--amber); }
  .tag.removed { background: var(--panel2); color: var(--muted); }
  .tag.imported { background: var(--tertiary-container); color: var(--tertiary); }
  button.rm {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--muted);
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background .15s ease, color .15s ease, border-color .15s ease;
  }
  button.rm:hover { background: var(--red-container); color: var(--red); border-color: transparent; }
  button.rm.redl:hover { background: var(--green-container); color: var(--green); border-color: transparent; }
  .hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; max-width: 640px; }
  .form { display: flex; flex-direction: column; gap: 14px; max-width: 420px; }
  .form label { color: var(--text); font-size: 13px; }
  .form > label:not(.check) { display: flex; flex-direction: column; gap: 6px; }
  .form .check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .form .pair { display: flex; gap: 12px; }
  .form .pair label { flex: 1; display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 12px; }
  input[type=checkbox] { accent-color: var(--accent); width: 16px; height: 16px; }
  .form input[type=text], .form select {
    background: var(--panel2);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 14px;
  }
  .form input[type=text]:focus, .form select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--ring);
  }
  .form .actions { display: flex; align-items: center; gap: 12px; }
  button.save {
    background: var(--accent);
    border: none;
    color: var(--on-accent);
    padding: 10px 24px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: var(--shadow);
    transition: filter .15s ease, transform .05s ease;
  }
  button.save:hover { filter: brightness(1.08); }
  button.save:active { transform: scale(.98); }
  .form .msg { font-size: 13px; }
  .form .msg.ok { color: var(--green); }
  .form .msg.err { color: var(--red); }
  .empty { color: var(--muted); padding: 44px 16px; text-align: center; font-size: 13px; }
  .empty .icon { display: block; font-size: 30px; margin-bottom: 10px; opacity: .55; }
  .events { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  .events .row { display: flex; gap: 12px; padding: 6px 4px; border-radius: 6px; border-bottom: 1px solid var(--line); }
  .events .row:hover { background: var(--panel2); }
  .events .row:last-child { border-bottom: none; }
  .events .ts { color: var(--muted); white-space: nowrap; }
  .events .msg { word-break: break-word; }
  @media (max-width: 640px) {
    header { padding: 10px 14px; gap: 8px; }
    header .sub { display: none; }
    main { padding: 12px; }
    nav { top: 59px; }
    nav button { padding: 10px 12px; }
  }
</style>
</head>
<body>
<header>
  <span class="logo"><span class="logo-mark">&#128225;</span>sftp-fetcher</span>
  <span class="sub">seedbox &rarr; Radarr</span>
  <span id="mode" class="sub"></span>
  <span class="spacer"></span>
  <button id="theme-toggle" class="icon-btn" type="button" aria-label="Toggle theme">&#9728;</button>
  <span id="dot" class="dot idle"></span>
  <span id="state" class="sub">idle</span>
</header>
<nav>
  <button data-tab="activity" class="on">Activity<span class="count" id="c-queue">0</span></button>
  <button data-tab="files">Files<span class="count" id="c-files">0</span></button>
  <button data-tab="history">History<span class="count" id="c-history">0</span></button>
  <button data-tab="events">Events</button>
  <button data-tab="settings">Settings</button>
</nav>
<main>
  <section id="tab-activity" class="tab on">
    <div id="download">
      <div class="card"><h2>Downloading</h2><div class="empty"><span class="icon">&#128164;</span>Loading&#8230;</div></div>
    </div>
    <div class="card">
      <h2>Queue</h2>
      <div id="queue"><div class="empty"><span class="icon">&#128237;</span>Loading&#8230;</div></div>
    </div>
  </section>
  <section id="tab-files" class="tab">
    <div class="card">
      <h2>Available files</h2>
      <div id="files"><div class="empty"><span class="icon">&#128193;</span>Loading&#8230;</div></div>
    </div>
  </section>
  <section id="tab-history" class="tab">
    <div class="card">
      <h2>History</h2>
      <div id="history"><div class="empty"><span class="icon">&#128220;</span>Loading&#8230;</div></div>
    </div>
  </section>
  <section id="tab-events" class="tab">
    <div class="card">
      <h2>Events</h2>
      <div id="events" class="events"><div class="empty"><span class="icon">&#128221;</span>Loading&#8230;</div></div>
    </div>
  </section>
  <section id="tab-settings" class="tab">
    <div class="card">
      <h2>Permissions after a download</h2>
      <p class="hint">Radarr imports a film by moving it, as its own user. Set
      the owner or the mode here so the import has no permission error. Both are
      off by default. A chown needs this container to run as root.</p>
      <div class="form">
        <label class="check"><input type="checkbox" id="set-chown"> Change the owner (chown)</label>
        <div class="pair">
          <label>UID<input type="text" id="set-uid" inputmode="numeric" placeholder="e.g. 1000"></label>
          <label>GID<input type="text" id="set-gid" inputmode="numeric" placeholder="e.g. 1000"></label>
        </div>
        <label class="check"><input type="checkbox" id="set-chmod"> Change the mode (chmod)</label>
        <div class="pair">
          <label>File mode<input type="text" id="set-filemode" inputmode="numeric" placeholder="e.g. 664"></label>
          <label>Folder mode<input type="text" id="set-dirmode" inputmode="numeric" placeholder="e.g. 775"></label>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Cleanup after an import</h2>
      <p class="hint">When Radarr or Sonarr reports an import, the staged copy
      it just imported is deleted. These settings control the rest of the
      cleanup around it.</p>
      <div class="form">
        <label>Also delete these file types<input type="text" id="set-extensions" placeholder="e.g. .nfo, .txt, .srt, .jpg"></label>
        <p class="hint">Removed alongside the imported file itself, which is
        always deleted.</p>
        <label class="check"><input type="checkbox" id="set-emptydirs"> Delete a season-pack folder once every episode in it is imported</label>
      </div>
    </div>
    <div class="card">
      <h2>Logging</h2>
      <div class="form">
        <label>Log level
          <select id="set-loglevel">
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </label>
        <p class="hint">Debug also logs the raw Radarr and Sonarr webhook
        body, as it is received. Useful when a webhook does not behave as
        expected.</p>
        <div class="actions">
          <button id="set-save" class="save">Save</button>
          <span id="set-msg" class="msg"></span>
        </div>
      </div>
    </div>
  </section>
</main>
<script>
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmtBytes(n) {
    if (n === null || n === undefined || isNaN(n)) return "\\u2014";
    var u = ["B", "KiB", "MiB", "GiB", "TiB"], i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
    return v.toFixed(i === 0 ? 0 : 1) + " " + u[i];
  }
  function fmtDur(sec) {
    if (sec === null || sec === undefined || !isFinite(sec)) return "\\u2014";
    var s = Math.round(sec);
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
    return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  }
  function rel(ms) {
    var d = Math.round((Date.now() - ms) / 1000);
    if (d < 5) return "just now";
    if (d < 60) return d + "s ago";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    return Math.floor(d / 86400) + "d ago";
  }
  function clock(ms) {
    var d = new Date(ms);
    return d.toLocaleString();
  }
  function getJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    });
  }

  // The theme toggle. It follows the browser's preference by default; the
  // button overrides that and the choice is remembered per browser. The CSS
  // reacts to the "data-theme" attribute on <html> (see :root[data-theme]).
  var root = document.documentElement;
  var themeBtn = document.getElementById("theme-toggle");
  function systemIsDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function isDarkNow() {
    var mode = root.getAttribute("data-theme");
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return systemIsDark();
  }
  function paintThemeIcon() {
    var dark = isDarkNow();
    // Sun when dark is active (press it to go light), moon when light is
    // active (press it to go dark): the icon shown is the mode a click gives.
    themeBtn.innerHTML = dark ? "&#9728;" : "&#9790;";
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }
  try {
    var savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light" || savedTheme === "dark") root.setAttribute("data-theme", savedTheme);
  } catch (e) {}
  paintThemeIcon();
  themeBtn.addEventListener("click", function () {
    var next = isDarkNow() ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    paintThemeIcon();
  });

  var current = "activity";
  var buttons = document.querySelectorAll("nav button");
  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      current = b.getAttribute("data-tab");
      buttons.forEach(function (x) { x.classList.toggle("on", x === b); });
      document.querySelectorAll(".tab").forEach(function (t) {
        t.classList.toggle("on", t.id === "tab-" + current);
      });
      // Load the settings once, on open. The tick must not reload them, or it
      // would wipe out what the user is typing.
      if (current === "settings") loadSettings();
      refreshTab();
    });
  });

  function renderStatus(s) {
    document.getElementById("c-queue").textContent = s.counts.queue;
    document.getElementById("c-history").textContent = s.counts.history;

    if (s.mode) {
      document.getElementById("mode").textContent = "via " + s.mode.toUpperCase();
    }

    var dot = document.getElementById("dot");
    var state = document.getElementById("state");
    var box = document.getElementById("download");

    if (s.download) {
      var d = s.download;
      dot.className = "dot live";
      state.textContent = "downloading " + d.percent.toFixed(1) + "%";
      box.innerHTML =
        '<div class="card">' +
        '<h2>Downloading</h2>' +
        '<div class="dl-title">' + esc(d.title) + '</div>' +
        '<div class="dl-name">' + esc(d.name) + '</div>' +
        '<div class="bar"><span style="width:' + d.percent + '%"></span></div>' +
        '<div class="dl-meta">' +
        '<div><b>Progress</b>' + d.percent.toFixed(1) + '%</div>' +
        '<div><b>Done</b>' + fmtBytes(d.bytesDone) + ' / ' + fmtBytes(d.bytesTotal) + '</div>' +
        '<div><b>Speed</b>' + fmtBytes(d.speed) + '/s</div>' +
        '<div><b>Time left</b>' + fmtDur(d.eta) + '</div>' +
        '<div><b>Files</b>' + d.filesDone + ' of ' + d.filesTotal + '</div>' +
        '<div><b>Running for</b>' + fmtDur(d.runningFor) + '</div>' +
        '</div></div>';
    } else {
      dot.className = "dot idle";
      state.textContent = "idle";
      box.innerHTML = '<div class="card"><h2>Downloading</h2><div class="empty"><span class="icon">&#128164;</span>Nothing is downloading right now.</div></div>';
    }

    var q = document.getElementById("queue");
    if (!s.queue.length) {
      q.innerHTML = '<div class="empty"><span class="icon">&#128237;</span>The queue is empty.</div>';
      return;
    }
    var rows = s.queue.map(function (j) {
      return '<tr><td>' + esc(j.title) + '</td>' +
        '<td class="num">' + esc(j.hash.slice(0, 8)) + '</td>' +
        '<td class="num">' + rel(Date.parse(j.waitingSince)) + '</td>' +
        '<td class="num"><button class="rm" data-hash="' + esc(j.hash) + '">Remove</button></td></tr>';
    }).join("");
    q.innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>Title</th><th>Hash</th><th>Waiting</th><th></th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
    q.querySelectorAll("button.rm").forEach(function (b) {
      b.addEventListener("click", function () {
        removeJob(b.getAttribute("data-hash"));
      });
    });
  }

  function removeJob(hash) {
    if (!hash) return;
    if (!confirm("Remove this torrent from the queue?")) return;
    fetch("api/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: hash })
    }).then(function () { tick(); }).catch(function () {});
  }

  function renderFiles(data) {
    document.getElementById("c-files").textContent = data.files.length;
    var el = document.getElementById("files");
    if (!data.files.length) {
      el.innerHTML = '<div class="empty"><span class="icon">&#128193;</span>No files on the local disk yet.</div>';
      return;
    }
    var rows = data.files.map(function (f) {
      return '<tr><td class="path">' + esc(f.path) + '</td>' +
        '<td class="num">' + fmtBytes(f.bytes) + '</td>' +
        '<td class="num">' + rel(f.modifiedAt) + '</td>' +
        '<td class="num"><button class="rm" data-path="' + esc(f.path) + '">Delete</button></td></tr>';
    }).join("");
    el.innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>Path (' + esc(data.root) +
      ')</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>' + rows +
      '</tbody></table></div>';
    el.querySelectorAll("button.rm").forEach(function (b) {
      b.addEventListener("click", function () {
        deleteFile(b.getAttribute("data-path"));
      });
    });
  }

  function deleteFile(path) {
    if (!path) return;
    if (!confirm("Delete '" + path + "' from the local disk? This cannot be undone.")) return;
    fetch("api/files/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: path })
    }).then(function () { refreshTab(); }).catch(function () {});
  }

  // The events that a torrent can be re-downloaded from. A "grabbed" event is
  // still in the queue, so it gets no button.
  var canRedownload = { downloaded: 1, imported: 1, failed: 1, expired: 1, removed: 1 };

  function renderHistory(list) {
    document.getElementById("c-history").textContent = list.length;
    var el = document.getElementById("history");
    if (!list.length) {
      el.innerHTML = '<div class="empty"><span class="icon">&#128220;</span>No history yet.</div>';
      return;
    }
    var rows = list.map(function (h) {
      var size = h.bytes ? fmtBytes(h.bytes) : "\\u2014";
      var name = h.path ? h.path : h.title;
      var action = canRedownload[h.status] && h.hash
        ? '<button class="rm redl" data-hash="' + esc(h.hash) + '">Redownload</button>'
        : '';
      return '<tr>' +
        '<td><span class="tag ' + h.status + '">' + h.status + '</span></td>' +
        '<td class="path">' + esc(name) + '</td>' +
        '<td class="num">' + size + '</td>' +
        '<td class="num" title="' + esc(clock(h.at)) + '">' + rel(h.at) + '</td>' +
        '<td class="num">' + action + '</td></tr>';
    }).join("");
    el.innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>Event</th><th>Title</th><th>Size</th><th>When</th><th></th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
    el.querySelectorAll("button.redl").forEach(function (b) {
      b.addEventListener("click", function () {
        redownload(b.getAttribute("data-hash"));
      });
    });
  }

  function redownload(hash) {
    if (!hash) return;
    if (!confirm("Re-download this torrent? Any local copy is replaced.")) return;
    fetch("api/redownload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: hash })
    }).then(function () { tick(); }).catch(function () {});
  }

  function renderEvents(list) {
    var el = document.getElementById("events");
    if (!list.length) {
      el.innerHTML = '<div class="empty"><span class="icon">&#128221;</span>No log lines yet.</div>';
      return;
    }
    el.innerHTML = list.map(function (e) {
      var t = new Date(e.at).toLocaleTimeString();
      return '<div class="row"><span class="ts">' + esc(t) + '</span><span class="msg">' + esc(e.message) + '</span></div>';
    }).join("");
  }

  function fillSettings(s) {
    document.getElementById("set-chown").checked = !!s.chown;
    document.getElementById("set-uid").value = s.uid === null || s.uid === undefined ? "" : s.uid;
    document.getElementById("set-gid").value = s.gid === null || s.gid === undefined ? "" : s.gid;
    document.getElementById("set-chmod").checked = !!s.chmod;
    document.getElementById("set-filemode").value = s.fileMode === null || s.fileMode === undefined ? "" : s.fileMode;
    document.getElementById("set-dirmode").value = s.dirMode === null || s.dirMode === undefined ? "" : s.dirMode;
    document.getElementById("set-extensions").value = s.cleanupExtensions || "";
    document.getElementById("set-emptydirs").checked = !!s.removeEmptyFolders;
    document.getElementById("set-loglevel").value = s.logLevel === "debug" ? "debug" : "info";
  }

  function loadSettings() {
    getJson("api/settings").then(fillSettings).catch(function () {});
  }

  function setMsg(text, kind) {
    var el = document.getElementById("set-msg");
    el.textContent = text;
    el.className = "msg" + (kind ? " " + kind : "");
  }

  function saveSettings() {
    var body = {
      chown: document.getElementById("set-chown").checked,
      uid: document.getElementById("set-uid").value.trim(),
      gid: document.getElementById("set-gid").value.trim(),
      chmod: document.getElementById("set-chmod").checked,
      fileMode: document.getElementById("set-filemode").value.trim(),
      dirMode: document.getElementById("set-dirmode").value.trim(),
      cleanupExtensions: document.getElementById("set-extensions").value.trim(),
      removeEmptyFolders: document.getElementById("set-emptydirs").checked,
      logLevel: document.getElementById("set-loglevel").value
    };
    setMsg("Saving\\u2026", "");
    fetch("api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (res) {
      if (res.ok && res.data.ok) {
        fillSettings(res.data.settings);
        setMsg("Saved.", "ok");
      } else {
        setMsg(res.data && res.data.reason ? res.data.reason : "Could not save.", "err");
      }
    }).catch(function () { setMsg("Could not save.", "err"); });
  }

  document.getElementById("set-save").addEventListener("click", saveSettings);

  function refreshTab() {
    if (current === "files") getJson("api/files").then(renderFiles).catch(function () {});
    else if (current === "history") getJson("api/history").then(renderHistory).catch(function () {});
    else if (current === "events") getJson("api/activity").then(renderEvents).catch(function () {});
  }

  function tick() {
    getJson("api/status").then(renderStatus).catch(function () {
      document.getElementById("dot").className = "dot idle";
      document.getElementById("state").textContent = "offline";
    });
    refreshTab();
  }

  tick();
  setInterval(tick, 2000);
</script>
</body>
</html>`;
