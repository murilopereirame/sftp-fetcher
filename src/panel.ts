/**
 * The web panel.
 *
 * One page, no framework. The rule of this project is one dependency, so the
 * page is a plain string with its own CSS and its own script. The script asks
 * the "/api" endpoints every few seconds and draws the result.
 *
 * The panel has four tabs, like Sonarr and Radarr:
 *   Activity   the running download and the queue
 *   Files      the files that this program put on the local disk
 *   History    every event: grabbed, downloaded, failed
 *   Events     the last log lines
 *
 * The client script uses "+" to build strings, never a backtick and never a
 * dollar-brace. Those would break this template literal at build time.
 */
export const panelHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sftp-fetcher</title>
<style>
  :root {
    --bg: #14161b;
    --panel: #1c1f26;
    --panel2: #232833;
    --line: #2c313c;
    --text: #e6e9ef;
    --muted: #9aa3b2;
    --accent: #3b82f6;
    --green: #22c55e;
    --red: #ef4444;
    --amber: #f59e0b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    z-index: 5;
  }
  header .logo { font-weight: 700; font-size: 16px; letter-spacing: .2px; }
  header .sub { color: var(--muted); font-size: 12px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .dot.live { background: var(--green); box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
  .dot.idle { background: var(--muted); }
  .spacer { flex: 1; }
  nav {
    display: flex;
    gap: 4px;
    padding: 0 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 51px;
    z-index: 4;
  }
  nav button {
    background: none;
    border: none;
    color: var(--muted);
    padding: 12px 16px;
    font-size: 14px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  nav button:hover { color: var(--text); }
  nav button.on { color: var(--text); border-bottom-color: var(--accent); }
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
  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  .tab { display: none; }
  .tab.on { display: block; }
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .card h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }
  .bar { height: 10px; border-radius: 6px; background: var(--panel2); overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--accent); transition: width .3s ease; }
  .dl-title { font-weight: 600; margin-bottom: 2px; }
  .dl-name { color: var(--muted); font-size: 12px; margin-bottom: 12px; word-break: break-all; }
  .dl-meta { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 12px; font-size: 13px; }
  .dl-meta b { display: block; color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
  th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  tr:last-child td { border-bottom: none; }
  td.num { text-align: right; white-space: nowrap; color: var(--muted); }
  .table-wrap { overflow-x: auto; }
  .path { word-break: break-all; }
  .tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    text-transform: capitalize;
  }
  .tag.grabbed { background: rgba(59,130,246,.16); color: #93c5fd; }
  .tag.downloaded { background: rgba(34,197,94,.16); color: #86efac; }
  .tag.failed { background: rgba(239,68,68,.16); color: #fca5a5; }
  .tag.expired { background: rgba(245,158,11,.16); color: #fcd34d; }
  .tag.removed { background: rgba(154,163,178,.16); color: #cbd5e1; }
  .tag.imported { background: rgba(139,92,246,.16); color: #c4b5fd; }
  button.rm {
    background: var(--panel2);
    border: 1px solid var(--line);
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  button.rm:hover { color: var(--red); border-color: var(--red); }
  button.rm.redl:hover { color: var(--green); border-color: var(--green); }
  .hint { color: var(--muted); font-size: 13px; margin: 0 0 16px; max-width: 640px; }
  .form { display: flex; flex-direction: column; gap: 14px; max-width: 420px; }
  .form label { color: var(--text); font-size: 13px; }
  .form .check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .form .pair { display: flex; gap: 12px; }
  .form .pair label { flex: 1; display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 12px; }
  .form input[type=text] {
    background: var(--panel2);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 14px;
  }
  .form input[type=text]:focus { outline: none; border-color: var(--accent); }
  .form .actions { display: flex; align-items: center; gap: 12px; }
  button.save {
    background: var(--accent);
    border: none;
    color: #fff;
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
  }
  button.save:hover { filter: brightness(1.1); }
  .form .msg { font-size: 13px; }
  .form .msg.ok { color: var(--green); }
  .form .msg.err { color: var(--red); }
  .empty { color: var(--muted); padding: 24px 4px; text-align: center; }
  .events { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  .events .row { display: flex; gap: 12px; padding: 5px 2px; border-bottom: 1px solid var(--line); }
  .events .row:last-child { border-bottom: none; }
  .events .ts { color: var(--muted); white-space: nowrap; }
  .events .msg { word-break: break-word; }
</style>
</head>
<body>
<header>
  <span class="logo">sftp-fetcher</span>
  <span class="sub">seedbox &rarr; Radarr</span>
  <span id="mode" class="sub"></span>
  <span class="spacer"></span>
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
    <div id="download"></div>
    <div class="card">
      <h2>Queue</h2>
      <div id="queue"></div>
    </div>
  </section>
  <section id="tab-files" class="tab">
    <div class="card">
      <h2>Available files</h2>
      <div id="files"></div>
    </div>
  </section>
  <section id="tab-history" class="tab">
    <div class="card">
      <h2>History</h2>
      <div id="history"></div>
    </div>
  </section>
  <section id="tab-events" class="tab">
    <div class="card">
      <h2>Events</h2>
      <div id="events" class="events"></div>
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
      box.innerHTML = '<div class="card"><h2>Downloading</h2><div class="empty">Nothing is downloading right now.</div></div>';
    }

    var q = document.getElementById("queue");
    if (!s.queue.length) {
      q.innerHTML = '<div class="empty">The queue is empty.</div>';
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
      el.innerHTML = '<div class="empty">No files on the local disk yet.</div>';
      return;
    }
    var rows = data.files.map(function (f) {
      return '<tr><td class="path">' + esc(f.path) + '</td>' +
        '<td class="num">' + fmtBytes(f.bytes) + '</td>' +
        '<td class="num">' + rel(f.modifiedAt) + '</td></tr>';
    }).join("");
    el.innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>Path (' + esc(data.root) +
      ')</th><th>Size</th><th>Modified</th></tr></thead><tbody>' + rows +
      '</tbody></table></div>';
  }

  // The events that a torrent can be re-downloaded from. A "grabbed" event is
  // still in the queue, so it gets no button.
  var canRedownload = { downloaded: 1, imported: 1, failed: 1, expired: 1, removed: 1 };

  function renderHistory(list) {
    document.getElementById("c-history").textContent = list.length;
    var el = document.getElementById("history");
    if (!list.length) {
      el.innerHTML = '<div class="empty">No history yet.</div>';
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
      el.innerHTML = '<div class="empty">No log lines yet.</div>';
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
      dirMode: document.getElementById("set-dirmode").value.trim()
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
