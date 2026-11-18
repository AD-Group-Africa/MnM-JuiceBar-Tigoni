/**
 * Verification endpoints.
 * GET  /verify/:code — public read-only status (used by QR codes; rate-limited);
 *                      returns what a street-checker needs without revealing PII.
 * POST /staff/scan   — scanner-role staff endpoint that REDEEMS tickets (audited).
 */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppConfig } from "../config.ts";
import { SESSION_COOKIE, getSessionUser, roleAllows, stateChangeOriginAllowed } from "../auth.ts";
import { verifyTicket, redeemTicket } from "../tickets.ts";
import { queryAll } from "../db.ts";
import { Page, StaffPage } from "../views/layout.tsx";

const verifyHits = new Map<string, { n: number; resetAt: number }>();
function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const e = verifyHits.get(key);
  if (!e || e.resetAt < now) { verifyHits.set(key, { n: 1, resetAt: now + windowMs }); return false; }
  e.n++;
  return e.n > max;
}

export function verifyScanRoutes(_config: AppConfig): Hono {
  const app = new Hono();

  // Public, read-only check (what the QR links to). No redemption here.
  app.get("/verify/:code", (c) => {
    const code = c.req.param("code").toUpperCase();
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (rateLimit(ip, 30, 60_000)) return c.json({ error: "Too many checks; slow down.", code: "rate_limited" }, 429);
    const v = verifyTicket(code);
    return c.json({
      valid: v.ok,
      outcome: v.outcome,
      message: v.detail,
      event: v.event ? { title: v.event.title, starts_at: v.event.starts_at, venue: v.event.venue_name } : null,
    }, v.httpStatus as ContentfulStatusCode);
  });

  // HTML fallback page for anyone who opens a QR link in a normal browser.
  app.get("/verify/:code/view", (c) => {
    const v = verifyTicket(c.req.param("code").toUpperCase());
    return c.html(
      <Page title="Ticket check">
        <div class="narrow scan-result">
          <div class={`panel scan-verdict ${v.ok ? "is-ok" : "is-bad"}`}>
            <div class={`big-status ${v.ok ? "ok" : "bad"}`}>{v.ok ? "VALID TICKET" : "DO NOT ADMIT"}</div>
            <p>{v.detail}</p>
            {v.event && <dl class="kv"><dt>Event</dt><dd>{v.event.title}</dd><dt>Starts</dt><dd>{new Date(v.event.starts_at).toLocaleString("en-KE")}</dd></dl>}
            <p class="hint">Redemption happens in the staff scanning console only. This page is informational.</p>
          </div>
        </div>
      </Page>,
    );
  });

  return app;
}

// ---------- staff scanning console ----------

const scanScript = `
(function () {
  'use strict';
  var video = document.getElementById('scan-video');
  var startBtn = document.getElementById('start-camera');
  var stopBtn = document.getElementById('stop-camera');
  var statusEl = document.getElementById('camera-status');
  if (!video || !startBtn) return;
  var stream = null, timer = null, detector = null;

  function say(msg) { if (statusEl) statusEl.textContent = msg; }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (video) video.srcObject = null;
  }

  startBtn.addEventListener('click', async function () {
    if (!('BarcodeDetector' in window)) {
      say('This browser has no built-in QR decoder. Type the ticket code below instead.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      video.srcObject = stream;
      await video.play();
      detector = new BarcodeDetector({ formats: ['qr_code'] });
      say('Point the camera at the QR code.');
      timer = setInterval(async function () {
        try {
          var found = await detector.detect(video);
          if (!found.length) return;
          var raw = found[0].rawValue || '';
          var match = raw.match(/\\/verify\\/([A-Za-z0-9-]+)/);
          var code = (match ? match[1] : raw).toUpperCase().trim();
          if (/^[A-Z0-9-]{6,}$/.test(code)) {
            stop();
            var input = document.getElementById('code');
            if (!input) return;
            input.value = code;
            if (input.form.requestSubmit) input.form.requestSubmit();
            else input.form.submit();
          }
        } catch (e) { /* keep scanning */ }
      }, 400);
    } catch (e) {
      say('Camera unavailable (' + (e && e.message ? e.message : 'permission refused') + '). Type the code below instead.');
    }
  });

  if (stopBtn) stopBtn.addEventListener('click', function () { stop(); say('Camera stopped.'); });
  window.addEventListener('pagehide', stop);
})();
`;

export function scanRoutes(config: AppConfig): Hono {
  const app = new Hono();

  app.get("/staff/scan", (c) => {
    const user = getSessionUser(getCookie(c, SESSION_COOKIE));
    if (!user || !roleAllows(user.role, "scan")) return c.redirect("/staff/login?next=/staff/scan");
    return c.html(
      <StaffPage title="Scan tickets" active="/staff/scan">
        <div class="page-head">
          <p class="kicker">Gate · {user.fullName}</p>
          <h1>Scan a ticket</h1>
          <p class="lead">Use the camera, or type the code printed under the QR. Every scan is recorded.</p>
        </div>

        <div class="contact-grid">
          <div class="panel">
            <h2>Camera scan</h2>
            <div class="camera-panel">
              <video id="scan-video" playsinline muted aria-label="Camera preview"></video>
              <div class="actions-row">
                <button class="btn btn-primary" type="button" id="start-camera">Start camera</button>
                <button class="btn btn-ghost" type="button" id="stop-camera">Stop</button>
              </div>
              <p class="camera-hint" id="camera-status">
                Decoding happens on this device — nothing is uploaded. If the camera is unavailable, enter the code below.
              </p>
            </div>

            <h2 style="margin-top:26px">Enter a code</h2>
            <form method="post" action="/staff/scan">
              <div class="field">
                <label for="code">Ticket code</label>
                <input id="code" name="code" required autocomplete="off" placeholder="e.g. 8K3F92-QW1XCD" style="text-transform:uppercase;font-family:var(--font-mono);letter-spacing:.08em" />
              </div>
              <button class="btn btn-primary btn-block btn-lg" type="submit">Verify &amp; redeem</button>
            </form>
          </div>

          <div class="panel">
            <h3>Your recent scans</h3>
            {scanTable(recentScans(user.id))}
          </div>
        </div>

        <script dangerouslySetInnerHTML={{ __html: scanScript }} />
      </StaffPage>,
    );
  });

  app.post("/staff/scan", async (c) => {
    if (!stateChangeOriginAllowed(c, config.publicOrigins)) return c.text("Invalid origin", 403);
    const user = getSessionUser(getCookie(c, SESSION_COOKIE));
    if (!user || !roleAllows(user.role, "scan")) return c.text("Forbidden", 403);
    const body = await c.req.parseBody();
    const raw = String(body.code ?? "").trim().toUpperCase();
    const r = redeemTicket(raw, user.id);
    return c.html(
      <StaffPage title="Scan result" active="/staff/scan">
        <div class="narrow scan-result">
          <div class={`scan-verdict ${r.result.ok ? "is-ok" : "is-bad"}`}>
            <div class={`big-status ${r.result.ok ? "ok" : "bad"}`}>{r.result.ok ? "ADMIT" : "DO NOT ADMIT"}</div>
            <p style="text-align:center;font-weight:600">{r.result.detail}</p>
            {r.result.event && (
              <dl class="kv" style="margin-top:18px">
                <dt>Event</dt><dd>{r.result.event.title}</dd>
                <dt>Venue</dt><dd>{r.result.event.venue_name}</dd>
                <dt>Starts</dt><dd>{new Date(r.result.event.starts_at).toLocaleString("en-KE")}</dd>
                <dt>Ticket</dt><dd><span class="badge-mono">{raw || "—"}</span></dd>
              </dl>
            )}
            <p class="hint" style="text-align:center;margin-top:14px">Scan #{r.scanId} recorded in the audit log.</p>
          </div>
          <div class="actions-row" style="justify-content:center">
            <a class="btn btn-primary" href="/staff/scan">Scan next ticket</a>
            <a class="btn btn-ghost" href="/staff/juice">Dashboard</a>
          </div>
        </div>
      </StaffPage>,
    );
  });

  return app;
}

function recentScans(scannerId: number): Record<string, unknown>[] {
  return queryAll(
    "SELECT ticket_code, result, reason, created_at FROM scan_log WHERE scanner_id=? ORDER BY id DESC LIMIT 10",
    [scannerId],
  );
}

function scanTable(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return <p class="hint">No scans yet.</p>;
  return (
    <div class="table-wrap">
      <table>
        <thead><tr><th>Code</th><th>Result</th><th>Reason</th><th>Time</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td><span class="badge-mono">{String(r.ticket_code)}</span></td>
              <td>{r.result === "accepted" ? <span class="tag ok">admitted</span> : <span class="tag danger">refused</span>}</td>
              <td class="small">{r.reason ? String(r.reason).replace(/_/g, " ") : "—"}</td>
              <td class="small">{new Date(String(r.created_at)).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
