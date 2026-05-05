export const renderAdminDashboard = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>HeySnap Admin</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f7f7f8;
        --panel: #ffffff;
        --panel-muted: #f0f1f3;
        --text: #18181b;
        --muted: #71717a;
        --border: #d9d9de;
        --accent: #2563eb;
        --danger: #dc2626;
        --ok: #15803d;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #18181b;
          --panel: #202124;
          --panel-muted: #27282c;
          --text: #f4f4f5;
          --muted: #a1a1aa;
          --border: #33343a;
          --accent: #60a5fa;
          --danger: #f87171;
          --ok: #4ade80;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 22px 28px;
        border-bottom: 1px solid var(--border);
        background: var(--panel);
      }
      h1, h2, h3, p { margin: 0; }
      h1 { font-size: 24px; letter-spacing: 0; }
      h2 { font-size: 17px; margin-bottom: 14px; }
      h3 { font-size: 14px; }
      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 24px;
      }
      button, input {
        font: inherit;
      }
      button {
        border: 1px solid var(--border);
        background: var(--panel);
        color: var(--text);
        border-radius: 8px;
        padding: 9px 12px;
        cursor: pointer;
      }
      button.primary {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
      }
      button.danger {
        border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
        color: var(--danger);
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      input {
        width: 100%;
        border: 1px solid var(--border);
        background: var(--panel);
        color: var(--text);
        border-radius: 8px;
        padding: 10px 11px;
      }
      label {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 13px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .auth {
        display: grid;
        grid-template-columns: minmax(240px, 1fr) auto auto;
        gap: 10px;
        width: min(720px, 100%);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 20px;
      }
      .panel, .stat {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      .stat {
        padding: 16px;
      }
      .stat strong {
        display: block;
        font-size: 26px;
        margin-top: 4px;
      }
      .stack {
        display: grid;
        gap: 18px;
      }
      .panel {
        padding: 18px;
      }
      form {
        display: grid;
        grid-template-columns: minmax(200px, 1fr) minmax(160px, 260px) auto;
        gap: 10px;
        align-items: end;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border-top: 1px solid var(--border);
        padding: 11px 8px;
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }
      th {
        color: var(--muted);
        font-weight: 600;
      }
      .muted {
        color: var(--muted);
      }
      .pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 3px 8px;
        background: var(--panel-muted);
        font-size: 12px;
        font-weight: 600;
      }
      .pill.ok { color: var(--ok); }
      .pill.danger { color: var(--danger); }
      .message {
        min-height: 20px;
        margin: 14px 0;
        color: var(--muted);
      }
      .message.error { color: var(--danger); }
      .scroll {
        overflow-x: auto;
      }
      .hidden { display: none; }
      @media (max-width: 900px) {
        header, .auth, form {
          display: grid;
          grid-template-columns: 1fr;
          align-items: stretch;
        }
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>HeySnap Admin</h1>
        <p class="muted">Users, machines, and release inventory</p>
      </div>
      <div class="auth">
        <input id="token" type="password" placeholder="Admin token">
        <button id="save-token" class="primary">Save token</button>
        <button id="clear-token">Clear</button>
      </div>
    </header>
    <main>
      <p id="message" class="message"></p>
      <section class="grid" id="stats"></section>
      <div class="stack">
        <section class="panel">
          <h2>Create User</h2>
          <form id="create-user-form">
            <label>Email <input id="new-email" type="email" autocomplete="off" required></label>
            <label>Password <input id="new-password" type="password" required></label>
            <button class="primary" type="submit">Create user</button>
          </form>
        </section>
        <section class="panel">
          <div class="row" style="justify-content: space-between; margin-bottom: 10px;">
            <h2>Users</h2>
            <button id="refresh">Refresh</button>
          </div>
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>User ID</th>
                  <th>Machines</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody id="users"></tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <h2>Computers</h2>
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Owner</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Last heartbeat</th>
                  <th>Provider</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="computers"></tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <h2>Releases</h2>
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Channel</th>
                  <th>Platform</th>
                  <th>Version</th>
                  <th>Artifact</th>
                  <th>Released</th>
                </tr>
              </thead>
              <tbody id="releases"></tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
    <script>
      const tokenInput = document.getElementById("token");
      const message = document.getElementById("message");
      const storageKey = "heysnap:admin-token";

      tokenInput.value = localStorage.getItem(storageKey) || "";

      document.getElementById("save-token").addEventListener("click", () => {
        localStorage.setItem(storageKey, tokenInput.value.trim());
        loadDashboard();
      });

      document.getElementById("clear-token").addEventListener("click", () => {
        localStorage.removeItem(storageKey);
        tokenInput.value = "";
        renderEmpty();
        setMessage("Admin token cleared.");
      });

      document.getElementById("refresh").addEventListener("click", () => {
        loadDashboard();
      });

      document.getElementById("create-user-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = document.getElementById("new-email").value.trim();
        const password = document.getElementById("new-password").value;
        await api("/admin/users", {
          method: "POST",
          body: JSON.stringify({ email, password }),
          headers: { "content-type": "application/json" },
        });
        document.getElementById("new-email").value = "";
        document.getElementById("new-password").value = "";
        setMessage("User created.");
        await loadDashboard();
      });

      async function loadDashboard() {
        try {
          const data = await api("/admin/overview");
          renderDashboard(data);
          setMessage("Loaded " + new Date().toLocaleString() + ".");
        } catch (error) {
          renderEmpty();
          setMessage(error.message || "Failed to load dashboard.", true);
        }
      }

      async function api(path, options) {
        const token = tokenInput.value.trim() || localStorage.getItem(storageKey) || "";
        if (!token) {
          throw new Error("Enter the admin token.");
        }
        const response = await fetch(path, {
          ...(options || {}),
          headers: {
            ...(options && options.headers ? options.headers : {}),
            authorization: "Bearer " + token,
          },
        });
        const text = await response.text();
        const body = text ? JSON.parse(text) : {};
        if (!response.ok) {
          throw new Error(body && body.error && body.error.message ? body.error.message : "Request failed.");
        }
        return body;
      }

      function renderDashboard(data) {
        renderStats(data.stats || {});
        renderUsers(data.users || []);
        renderComputers(data.computers || []);
        renderReleases(data.releases || []);
      }

      function renderStats(stats) {
        const entries = [
          ["Users", stats.users || 0],
          ["Computers", stats.computers || 0],
          ["Cloud", stats.cloudComputers || 0],
          ["Active", stats.activeComputers || 0],
        ];
        document.getElementById("stats").innerHTML = entries.map((entry) =>
          '<div class="stat"><span class="muted">' + escapeHtml(entry[0]) + '</span><strong>' + String(entry[1]) + '</strong></div>'
        ).join("");
      }

      function renderUsers(users) {
        document.getElementById("users").innerHTML = users.map((user) =>
          "<tr>" +
          "<td>" + escapeHtml(user.email) + "</td>" +
          "<td class='muted'>" + escapeHtml(user.id) + "</td>" +
          "<td>" + String(user.computerCount || (user.computers ? user.computers.length : 0)) + "</td>" +
          "<td>" + formatDate(user.createdAt) + "</td>" +
          "</tr>"
        ).join("");
      }

      function renderComputers(computers) {
        document.getElementById("computers").innerHTML = computers.map((computer) => {
          const provider = readProvider(computer.providerMetadata);
          return "<tr>" +
            "<td><strong>" + escapeHtml(computer.name) + "</strong><br><span class='muted'>" + escapeHtml(computer.id) + "</span></td>" +
            "<td>" + escapeHtml(computer.ownerEmail || computer.ownerUserId) + "</td>" +
            "<td>" + escapeHtml(computer.kind) + "</td>" +
            "<td><span class='pill " + statusClass(computer.status) + "'>" + escapeHtml(computer.status) + "</span></td>" +
            "<td>" + escapeHtml(computer.machineServerVersion || "") + "</td>" +
            "<td>" + formatDate(computer.lastHeartbeatAt) + "</td>" +
            "<td>" + escapeHtml(provider) + "</td>" +
            "<td><button class='danger' data-delete-computer='" + escapeHtml(computer.id) + "'>Delete</button></td>" +
            "</tr>";
        }).join("");

        document.querySelectorAll("[data-delete-computer]").forEach((button) => {
          button.addEventListener("click", async () => {
            const computerId = button.getAttribute("data-delete-computer");
            if (!computerId || !confirm("Delete this computer? Cloud EC2 machines will be terminated.")) {
              return;
            }
            button.disabled = true;
            try {
              await api("/admin/computers/" + encodeURIComponent(computerId), { method: "DELETE" });
              setMessage("Computer deleted.");
              await loadDashboard();
            } catch (error) {
              setMessage(error.message || "Delete failed.", true);
              button.disabled = false;
            }
          });
        });
      }

      function renderReleases(releases) {
        document.getElementById("releases").innerHTML = releases.map((release) =>
          "<tr>" +
          "<td>" + escapeHtml(release.target) + "</td>" +
          "<td>" + escapeHtml(release.channel) + "</td>" +
          "<td>" + escapeHtml(release.platform) + "</td>" +
          "<td>" + escapeHtml(release.version) + "</td>" +
          "<td class='muted'>" + escapeHtml(release.dockerImage || release.downloadUrl || "") + "</td>" +
          "<td>" + formatDate(release.releasedAt) + "</td>" +
          "</tr>"
        ).join("");
      }

      function renderEmpty() {
        document.getElementById("stats").innerHTML = "";
        document.getElementById("users").innerHTML = "";
        document.getElementById("computers").innerHTML = "";
        document.getElementById("releases").innerHTML = "";
      }

      function setMessage(text, isError) {
        message.textContent = text;
        message.classList.toggle("error", Boolean(isError));
      }

      function formatDate(value) {
        return value ? new Date(value).toLocaleString() : "";
      }

      function readProvider(metadata) {
        if (!metadata || typeof metadata !== "object") {
          return "";
        }
        const provider = metadata.provider || "";
        const instanceId = metadata.instanceId ? " " + metadata.instanceId : "";
        return String(provider) + String(instanceId);
      }

      function statusClass(status) {
        if (status === "online" || status === "idle") return "ok";
        if (status === "failed" || status === "deleted") return "danger";
        return "";
      }

      function escapeHtml(value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      if (tokenInput.value.trim()) {
        loadDashboard();
      } else {
        setMessage("Enter the admin token to load the dashboard.");
      }
    </script>
  </body>
</html>`;
