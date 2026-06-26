"""
FastAPI web server for EmailBot.

Provides OAuth authentication endpoints and a management API
for running email classification from a deployed environment.
Includes a background polling thread that automatically classifies
new incoming emails on a configurable interval.

Deployed on Fly.io at https://emailbot.fly.dev
"""

import asyncio
import logging
import os
import threading
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from src.config import settings

logger = logging.getLogger(__name__)

# Shared secret for API authentication (set via Fly.io secrets)
API_SECRET = os.environ.get("API_SECRET", "")
# Require secret in production, allow empty for local development
if not API_SECRET and os.environ.get("FLY_APP_NAME"):
    raise RuntimeError(
        "API_SECRET environment variable is required in production. Set it via: "
        "fly secrets set API_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
    )
if not API_SECRET:
    logger.warning("API_SECRET not set — API endpoints are unprotected (development mode)")

REDIRECT_URI = os.environ.get("EMAILBOT_REDIRECT_URI", "http://localhost:8080/callback")
POLL_INTERVAL = int(os.environ.get("EMAILBOT_POLL_INTERVAL", "60"))  # seconds between polls


# ─────────────────────────────────────────────
# Error helper
# ─────────────────────────────────────────────

def _safe_error(exc: Exception) -> str:
    """Return a safe error message — never expose internal details."""
    logger.error("Request failed: %s", exc, exc_info=True)
    return "An internal error occurred. Check server logs for details."


# ─────────────────────────────────────────────
# Background poller — auto-classifies incoming email
# ─────────────────────────────────────────────

def _background_poller() -> None:
    """Run classification poll loop in a background daemon thread."""
    import time
    from src.scheduler.poller import poll_once

    logger.info("Background poller started (every %ds)", POLL_INTERVAL)
    while True:
        try:
            count = poll_once()
            if count:
                logger.info("Auto-poll: %d email(s) classified", count)
        except Exception as exc:
            logger.error("Auto-poll error: %s", exc)
        time.sleep(POLL_INTERVAL)


_poller_thread: threading.Thread | None = None

# ─────────────────────────────────────────────
# Cleanup progress tracking (shared state for dashboard polling)
# ─────────────────────────────────────────────

_cleanup_lock = threading.Lock()
_cleanup_status = {
    "running": False,
    "batch": 0,
    "batch_processed": 0,
    "batch_total": 0,
    "total_processed": 0,
    "log_messages": [],
    "finished": False,
    "error": None,
}


def _make_cleanup_callback():
    """Return a callback that updates _cleanup_status with batch progress."""
    def cb(event: dict):
        with _cleanup_lock:
            if event["event"] == "batch_start":
                _cleanup_status["batch"] = event["batch"]
                _cleanup_status["batch_processed"] = 0
                _cleanup_status["batch_total"] = event.get("total_in_batch", 0)
                msg = f"Starting batch {event['batch']} ({_cleanup_status['batch_total']} unlabeled emails)..."
                _cleanup_status["log_messages"].append(msg)
                logger.info(msg)
            elif event["event"] == "batch_done":
                _cleanup_status["batch_processed"] = event["processed"]
                _cleanup_status["batch_total"] = event["total_in_batch"]
                _cleanup_status["total_processed"] = event["running_total"]
                skipped = event["total_in_batch"] - event["processed"]
                msg = f"Batch {event['batch']} complete: {event['processed']}/{event['total_in_batch']} emails processed (skipped {skipped}). Running total: {event['running_total']}"
                _cleanup_status["log_messages"].append(msg)
                logger.info(msg)
            elif event["event"] == "error":
                _cleanup_status["log_messages"].append(f"ERROR: {event['message']}")
            elif event["event"] == "finished":
                _cleanup_status["running"] = False
                _cleanup_status["finished"] = True
                _cleanup_status["total_processed"] = event["total"]
                msg = f"Cleanup finished: {event['total']} emails classified"
                _cleanup_status["log_messages"].append(msg)
                logger.info(msg)
    return cb


def start_poller() -> None:
    """Start the background poller if enabled and not already running."""
    global _poller_thread
    enable = os.environ.get("EMAILBOT_AUTO_POLL", "true").lower()
    if enable not in ("true", "1", "yes"):
        logger.info("Auto-poll disabled (EMAILBOT_AUTO_POLL=%s)", enable)
        return
    if _poller_thread is not None:
        return
    _poller_thread = threading.Thread(target=_background_poller, daemon=True)
    _poller_thread.start()
    logger.info("Auto-poll enabled (interval=%ds)", POLL_INTERVAL)


# ─────────────────────────────────────────────
# Lifespan
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: verify configuration, ensure data directory exists, start poller."""
    os.makedirs("/data", exist_ok=True)
    logger.info("EmailBot web server starting (redirect_uri=%s)", REDIRECT_URI)

    # Auto-create any missing Gmail labels (idempotent — skips existing ones)
    from src.gmail.labels import ensure_labels_exist
    try:
        labels = ensure_labels_exist()
        logger.info("Gmail labels verified: %d labels ready", len(labels))
    except Exception as exc:
        logger.warning("Could not verify Gmail labels on startup: %s", exc)

    start_poller()
    yield
    logger.info("EmailBot web server shutting down")


app = FastAPI(
    title="EmailBot",
    description="Gmail AI classifier — classify, clean up, and manage your inbox with AI.",
    version="1.0.0",
    lifespan=lifespan,
)


# ─────────────────────────────────────────────
# Auth helper
# ─────────────────────────────────────────────

def _verify_secret(request: Request) -> None:
    """Verify the shared secret header for API authentication."""
    provided = request.headers.get("X-API-Secret", "")
    if provided != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid API secret")


def _get_redirect_uri(request: Request) -> str:
    """Determine the redirect URI from the request or environment."""
    env_uri = os.environ.get("EMAILBOT_REDIRECT_URI", "")
    if env_uri:
        return env_uri
    host = request.headers.get("host", "localhost:8080")
    scheme = "https" if "fly.dev" in host else "http"
    return f"{scheme}://{host}/callback"


# ─────────────────────────────────────────────
# Public routes (no authentication)
# ─────────────────────────────────────────────

@app.get("/")
async def root():
    """Health check."""
    return {
        "status": "ok",
        "service": "EmailBot",
        "version": "1.0.0",
        "auto_poll": os.environ.get("EMAILBOT_AUTO_POLL", "true"),
    }


@app.get("/auth-status")
async def auth_status():
    """Check if Gmail authentication has been completed."""
    from src.auth_web import token_exists
    return {"authenticated": token_exists()}


@app.get("/login")
async def login(request: Request):
    """Redirect the user to Google OAuth consent screen."""
    from src.auth_web import get_authorization_url

    redirect_uri = _get_redirect_uri(request)
    try:
        auth_url, oauth_state = get_authorization_url(redirect_uri)
        logger.info("Redirecting to Google OAuth (state=%s)...", oauth_state)
        return RedirectResponse(url=auth_url)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="OAuth client secret not configured")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


@app.get("/callback")
async def callback(request: Request, code: str = Query(...), state: str = Query(...)):
    """Handle Google OAuth callback — exchange code for credentials."""
    from src.auth_web import exchange_code

    redirect_uri = _get_redirect_uri(request)
    try:
        exchange_code(code, oauth_state=state, redirect_uri=redirect_uri)
        # Create AI/* labels now that we have valid credentials
        from src.gmail.labels import ensure_labels_exist
        try:
            labels = ensure_labels_exist()
            logger.info("Labels verified post-auth: %d labels ready", len(labels))
        except Exception as exc:
            logger.warning("Could not verify labels post-auth: %s", exc)
        return HTMLResponse("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EmailBot — Authenticated</title>
<link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzc4NTFBOSIvPjx0ZXh0IHg9IjE2IiB5PSIyMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSIyMCIgZmlsbD0id2hpdGUiPuKciTwvdGV4dD48L3N2Zz4=">
<style>
  body { font-family: system-ui, sans-serif; background: #FFF8F0; color: #2D2D2D;
         display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; max-width: 500px; padding: 40px; }
  h1 { color: #2E7D32; }
  a { color: #7851A9; }
</style>
</head>
<body>
<div class="box">
  <h1>Authentication Successful</h1>
  <p>Your Gmail token has been saved. You can now close this window.</p>
  <p><a href="/dashboard">Go to Dashboard</a></p>
</div>
</body>
</html>""")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="OAuth client secret not configured")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


# ─────────────────────────────────────────────
# Dashboard (public read-only view)
# ─────────────────────────────────────────────

DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EmailBot — Dashboard</title>
<link rel="icon" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNiIgZmlsbD0iIzc4NTFBOSIvPjx0ZXh0IHg9IjE2IiB5PSIyMyIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1zaXplPSIyMCIgZmlsbD0id2hpdGUiPuKciTwvdGV4dD48L3N2Zz4=">
<style>
  :root { font-family: system-ui, sans-serif; background: #FFF8F0; color: #2D2D2D; }
  body { max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.5rem; margin: 0 0 8px; }
  .subtitle { color: #8D7B6B; margin: 0 0 24px; }
  .card { background: #FFFFFF; border: 1px solid #E0D8D0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .card h2 { margin: 0 0 12px; font-size: 1rem; color: #7851A9; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .stat { flex: 1; min-width: 130px; }
  .stat .label { font-size: 0.75rem; color: #8D7B6B; text-transform: uppercase; }
  .stat .value { font-size: 1.5rem; font-weight: 700; }
  .green { color: #2E7D32; }
  .yellow { color: #E67E00; }
  .red { color: #C62828; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
  .badge-on { background: #EDE7F6; color: #7851A9; }
  .badge-off { background: #FFEBEE; color: #C62828; }
  button { background: #F0EAE0; color: #2D2D2D; border: 1px solid #D0C8C0; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.875rem; margin: 4px; }
  button:hover { background: #E0D8D0; }
  button.primary { background: #7851A9; border-color: #7851A9; color: #FFFFFF; }
  button.primary:hover { background: #6B3FA0; }
  button.danger { color: #C62828; }
  input { background: #FFFFFF; color: #2D2D2D; border: 1px solid #D0C8C0; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem; width: 280px; }
  .secret-row { display: flex; align-items: center; gap: 8px; }
  #log { background: #FFF8F0; border: 1px solid #E0D8D0; border-radius: 6px; padding: 12px; max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; color: #2D2D2D; }
  .refresh { text-align: right; font-size: 0.75rem; color: #B8A898; margin-top: 8px; }
</style>
</head>
<body>
<h1>EmailBot</h1>
<p class="subtitle">Gmail AI Classifier &mdash; <span id="auto-badge" class="badge">...</span></p>

<div class="card">
  <h2>API Secret</h2>
  <div class="secret-row">
    <input type="password" id="secret-input" placeholder="Paste your API secret here...">
    <button onclick="setSecret()">Set</button>
    <span id="secret-status" style="font-size:0.8rem"></span>
  </div>
  <small style="color:#8D7B6B">Stored in your browser's session only. Never sent to the server.</small>
</div>

<div class="row">
  <div class="card stat"><div class="label">Classified Today</div><div class="value" id="today">...</div></div>
  <div class="card stat"><div class="label">This Week</div><div class="value" id="week">...</div></div>
  <div class="card stat"><div class="label">Last Poll</div><div class="value" style="font-size:1rem" id="last">...</div></div>
  <div class="card stat"><div class="label">Auth</div><div class="value" id="auth" style="font-size:1rem">...</div></div>
</div>

<div class="card">
  <h2>Actions</h2>
  <button class="primary" onclick="action('poll')">Poll Now</button>
  <button onclick="action('cleanup')">Full Cleanup</button>
  <button class="danger" onclick="action('spam-delete')">Delete Spam</button>
  <span id="action-status" style="margin-left:8px;font-size:0.85rem"></span>
</div>

<div class="card">
  <h2>Activity Log</h2>
  <div id="log">Loading...</div>
</div>

<p class="refresh">Auto-refresh every 10s &middot; <a href="/" style="color:#7851A9">API</a></p>

<script>
// Secret is stored in sessionStorage (client-side only, never embedded in HTML)
let SECRET = sessionStorage.getItem('emailbot_secret') || '';

function setSecret() {
  const inp = document.getElementById('secret-input');
  const s = inp.value.trim();
  if (s) {
    SECRET = s;
    sessionStorage.setItem('emailbot_secret', s);
    document.getElementById('secret-status').textContent = 'Saved';
    document.getElementById('secret-status').style.color = '#2E7D32';
    inp.value = '';
    load();
  }
}

// Pre-fill from session
if (SECRET) {
  document.getElementById('secret-input').placeholder = 'Secret is set (' + SECRET.substring(0, 8) + '...)';
  document.getElementById('secret-status').textContent = 'Stored in session';
  document.getElementById('secret-status').style.color = '#7851A9';
}

function fmt(iso) { if(!iso) return 'never'; return new Date(iso).toLocaleTimeString(); }

var logs = [];

async function load() {
  // Stats (read-only, no auth needed)
  try {
    const r = await fetch('/dashboard/stats');
    const s = await r.json();
    document.getElementById('today').textContent = s.processed_today;
    document.getElementById('week').textContent = s.processed_week;
    document.getElementById('last').textContent = fmt(s.last_poll);
    document.getElementById('last').className = 'value ' + (s.processed_today > 0 ? 'green' : 'yellow');
  } catch(e) { console.error(e); }

  // Auth status
  try {
    const r = await fetch('/auth-status');
    const a = await r.json();
    const el = document.getElementById('auth');
    el.textContent = a.authenticated ? 'OK' : 'Missing';
    el.className = 'value ' + (a.authenticated ? 'green' : 'red');
  } catch(e) {}

  // Auto-poll status
  try {
    const r = await fetch('/');
    const h = await r.json();
    const badge = document.getElementById('auto-badge');
    // Read auto_poll from optional field
    const active = h.auto_poll !== 'false';
    badge.textContent = active ? 'Auto-Poll ON' : 'Auto-Poll OFF';
    badge.className = 'badge ' + (active ? 'badge-on' : 'badge-off');
  } catch(e) {}

  // Activity log — show cleanup progress if running, otherwise show refresh
  var el = document.getElementById('log');
  var now = new Date().toLocaleTimeString();
  var today = document.getElementById('today').textContent;

  if (!_cleanupPollTimer) {
    // No cleanup running — show normal refresh entry
    logs.unshift(now);
    if (logs.length > 50) logs.pop();
    el.innerHTML = logs.map(function(t) { return '<span class="time">' + t + '</span>  Dashboard refreshed (today: ' + today + ')'; }).join('\n');
  }
  // If _cleanupPollTimer is active, pollCleanupStatus() manages the log — don't overwrite
}

async function action(cmd) {
  if (!SECRET) {
    document.getElementById('action-status').textContent = 'Set your API secret first';
    document.getElementById('action-status').style.color = '#C62828';
    return;
  }
  var status = document.getElementById('action-status');
  status.textContent = 'Starting...';
  status.style.color = '#E67E00';

  if (cmd === 'cleanup') {
    try {
      var r = await fetch('/dashboard/action/' + cmd, {
        method: 'POST',
        headers: {'X-Dashboard-Secret': SECRET}
      });
      var j = await r.json();
      if (j.status === 'started') {
        status.textContent = 'Cleanup running...';
        status.style.color = '#E67E00';
        pollCleanupStatus();
      } else if (j.status === 'error') {
        status.textContent = j.detail;
        status.style.color = '#C62828';
      }
    } catch(e) {
      status.textContent = 'Failed: ' + e.message;
      status.style.color = '#C62828';
    }
  } else {
    // poll and spam-delete are fast — keep synchronous
    try {
      var r = await fetch('/dashboard/action/' + cmd, {
        method: 'POST',
        headers: {'X-Dashboard-Secret': SECRET}
      });
      var j = await r.json();
      var n = j.processed || j.deleted || 0;
      status.textContent = 'Done: ' + n + ' email(s)';
      status.style.color = '#2E7D32';
      load();
    } catch(e) {
      status.textContent = 'Failed: ' + e.message;
      status.style.color = '#C62828';
    }
  }
}

var _cleanupPollTimer = null;

function pollCleanupStatus() {
  if (_cleanupPollTimer) clearTimeout(_cleanupPollTimer);
  fetch('/dashboard/cleanup-status')
    .then(function(r) { return r.json(); })
    .then(function(s) {
      // Activity log: single loading line while running, final result on finish
      var el = document.getElementById('log');
      var now = new Date().toLocaleTimeString();

      if (s.running) {
        // Single loading line that updates inline — doesn't flood
        var progressMsg = 'Cleanup running...';
        if (s.batch > 0) {
          progressMsg = 'Cleanup in progress — Batch ' + s.batch + ': ' + s.batch_processed + '/' + s.batch_total + ' (total: ' + s.total_processed + ')';
        }
        var loadingLine = '<span class="time">' + now + '</span>  ' + progressMsg;
        var keep = logs.length > 0 ? logs.slice(0, 49) : [];
        logs = [loadingLine].concat(keep).slice(0, 50);
        el.innerHTML = logs.join('\n');
      } else if (s.finished) {
        // Done — post one final result line
        var resultMsg;
        if (s.error) {
          // Show first line of error only (full traceback in server logs)
          var errFirstLine = s.error.split('\n')[0];
          resultMsg = 'Cleanup error: ' + errFirstLine.substring(0, 200);
        } else if (s.total_processed > 0) {
          resultMsg = 'Cleanup complete: ' + s.total_processed + ' emails classified';
        } else {
          resultMsg = 'Cleanup complete: no unlabeled emails found';
        }
        logs.unshift('<span class="time">' + now + '</span>  ' + resultMsg);
        if (logs.length > 50) logs.pop();
        el.innerHTML = logs.join('\n');
      }

      // Update status bar
      var status = document.getElementById('action-status');
      if (s.running) {
        if (s.batch > 0) {
          status.textContent = 'Batch ' + s.batch + ': ' + s.batch_processed + '/' + s.batch_total + ' (total: ' + s.total_processed + ')';
        } else {
          status.textContent = 'Scanning for unlabeled emails...';
        }
        status.style.color = '#E67E00';
        _cleanupPollTimer = setTimeout(pollCleanupStatus, 2000);
      } else if (s.finished) {
        if (s.total_processed > 0 || s.error) {
          status.textContent = 'Done: ' + s.total_processed + ' email(s)';
        } else {
          status.textContent = 'No unlabeled emails found';
        }
        status.style.color = s.error ? '#C62828' : '#2E7D32';
        // Don't call load() immediately — it would overwrite the cleanup log
        // with a generic refresh line. Let the user see results first.
        setTimeout(function() { load(); }, 1500);
        _cleanupPollTimer = null;
      } else {
        // Edge case: neither running nor finished — keep polling
        _cleanupPollTimer = setTimeout(pollCleanupStatus, 2000);
      }
    })
    .catch(function(e) {
      _cleanupPollTimer = setTimeout(pollCleanupStatus, 5000);
    });
}

load();
setInterval(load, 10000);
</script>
</body>
</html>"""


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    """Live dashboard — secret is entered client-side, never embedded in HTML."""
    return HTMLResponse(content=DASHBOARD_HTML)


@app.get("/dashboard/stats")
async def dashboard_stats():
    """Public read-only stats for the dashboard (no secret required)."""
    try:
        from src.persistence.tracker import get_processed_count, get_last_poll_time, get_correction_count, get_learned_domains
        return {
            "processed_today": get_processed_count(days=1),
            "processed_week": get_processed_count(days=7),
            "last_poll": get_last_poll_time(),
            "corrections_detected": get_correction_count(days=7),
            "learned_domains": len(get_learned_domains()),
        }
    except Exception as exc:
        logger.error("Dashboard stats failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load stats")


@app.post("/dashboard/action/{cmd}")
async def dashboard_action(cmd: str, request: Request):
    """Proxy dashboard actions — validates secret server-side."""
    # Validate secret from custom header (not the main X-API-Secret)
    provided = request.headers.get("X-Dashboard-Secret", "")
    if provided != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid secret")

    try:
        if cmd == "poll":
            from src.scheduler.poller import poll_once
            count = await asyncio.to_thread(poll_once)
            return {"status": "ok", "processed": count}
        elif cmd == "cleanup":
            with _cleanup_lock:
                if _cleanup_status["running"]:
                    return {"status": "error", "detail": "Cleanup already in progress"}
                _cleanup_status.update({
                    "running": True, "batch": 0, "batch_processed": 0,
                    "batch_total": 0, "total_processed": 0,
                    "log_messages": ["Cleanup started — scanning for unlabeled emails..."],
                    "finished": False, "error": None,
                })

            def _run_cleanup_bg():
                from src.scheduler.cleanupper import run_cleanup
                try:
                    run_cleanup(progress_callback=_make_cleanup_callback())
                except Exception as exc:
                    with _cleanup_lock:
                        _cleanup_status["running"] = False
                        _cleanup_status["finished"] = True
                        _cleanup_status["error"] = (
                            f"{type(exc).__name__}: {exc}\n"
                            f"{traceback.format_exc()}"
                        )
                        _cleanup_status["log_messages"].append(
                            f"FATAL: {type(exc).__name__}: {exc}"
                        )
                    logger.error("Cleanup thread crashed", exc_info=True)

            threading.Thread(target=_run_cleanup_bg, daemon=True).start()
            return {"status": "started"}
        elif cmd == "spam-delete":
            from src.scheduler.spam_deleter import run_spam_delete
            total = await asyncio.to_thread(run_spam_delete, older_than_days=0)
            return {"status": "ok", "deleted": total}
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {cmd}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


@app.get("/dashboard/cleanup-status")
async def cleanup_status():
    """Return current cleanup progress for the dashboard activity log."""
    with _cleanup_lock:
        return dict(_cleanup_status)


# ─────────────────────────────────────────────
# API Routes (protected by shared secret)
# ─────────────────────────────────────────────

@app.post("/api/setup")
async def api_setup(request: Request):
    """Create AI/* labels in Gmail."""
    _verify_secret(request)
    try:
        from src.gmail.labels import ensure_labels_exist
        labels = ensure_labels_exist()
        return {"status": "ok", "labels": {k: v for k, v in labels.items()}}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


@app.post("/api/poll")
async def api_poll(request: Request):
    """Run one classification batch (up to 10 unlabeled emails)."""
    _verify_secret(request)
    try:
        from src.scheduler.poller import poll_once
        count = await asyncio.to_thread(poll_once)
        return {"status": "ok", "processed": count}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


@app.post("/api/cleanup")
async def api_cleanup(request: Request):
    """Batch process all historical unlabeled emails."""
    _verify_secret(request)
    try:
        from src.scheduler.cleanupper import run_cleanup
        total = await asyncio.to_thread(run_cleanup)
        return {"status": "ok", "processed": total}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


@app.post("/api/spam-delete")
async def api_spam_delete(request: Request):
    """Delete spam emails older than configured threshold."""
    _verify_secret(request)
    try:
        from src.scheduler.spam_deleter import run_spam_delete
        total = await asyncio.to_thread(run_spam_delete, older_than_days=0)
        return {"status": "ok", "deleted": total}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


@app.get("/api/stats")
async def api_stats(request: Request):
    """Get processing statistics."""
    _verify_secret(request)
    try:
        from src.persistence.tracker import get_processed_count, get_last_poll_time
        return {
            "processed_today": get_processed_count(days=1),
            "processed_week": get_processed_count(days=7),
            "last_poll": get_last_poll_time(),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))
