"""
FastAPI web server for EmailBot.

Provides OAuth authentication endpoints and a management API
for running email classification from a deployed environment.
Includes a background polling thread that automatically classifies
new incoming emails on a configurable interval.

Deployed on Fly.io at https://emailbot.fly.dev
"""

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from src.config import settings

logger = logging.getLogger(__name__)

# Shared secret for API authentication (set via Fly.io secrets)
API_SECRET = os.environ.get("API_SECRET", "")
# Require secret in production, allow empty for local development
if not API_SECRET and os.path.exists("/data"):
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
    return {"status": "ok", "service": "EmailBot", "version": "1.0.0"}


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
        return HTMLResponse("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EmailBot — Authenticated</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9;
         display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; max-width: 500px; padding: 40px; }
  h1 { color: #3fb950; }
  a { color: #58a6ff; }
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
<style>
  :root { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; }
  body { max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 1.5rem; margin: 0 0 8px; }
  .subtitle { color: #8b949e; margin: 0 0 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .card h2 { margin: 0 0 12px; font-size: 1rem; color: #58a6ff; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .stat { flex: 1; min-width: 130px; }
  .stat .label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; }
  .stat .value { font-size: 1.5rem; font-weight: 700; }
  .green { color: #3fb950; }
  .yellow { color: #d29922; }
  .red { color: #f85149; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
  .badge-on { background: #1b3a2a; color: #3fb950; }
  .badge-off { background: #3a1b1b; color: #f85149; }
  button { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.875rem; margin: 4px; }
  button:hover { background: #30363d; }
  button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
  button.danger { color: #f85149; }
  input { background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem; width: 280px; }
  .secret-row { display: flex; align-items: center; gap: 8px; }
  #log { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 12px; max-height: 300px; overflow-y: auto; font-family: monospace; font-size: 0.8rem; white-space: pre-wrap; }
  .refresh { text-align: right; font-size: 0.75rem; color: #484f58; margin-top: 8px; }
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
  <small style="color:#8b949e">Stored in your browser's session only. Never sent to the server.</small>
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

<p class="refresh">Auto-refresh every 10s &middot; <a href="/" style="color:#58a6ff">API</a></p>

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
    document.getElementById('secret-status').style.color = '#3fb950';
    inp.value = '';
    load();
  }
}

// Pre-fill from session
if (SECRET) {
  document.getElementById('secret-input').placeholder = 'Secret is set (' + SECRET.substring(0, 8) + '...)';
  document.getElementById('secret-status').textContent = 'Stored in session';
  document.getElementById('secret-status').style.color = '#58a6ff';
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

  // Activity log
  const el = document.getElementById('log');
  const now = new Date().toLocaleTimeString();
  const today = document.getElementById('today').textContent;
  logs.unshift(now);
  if (logs.length > 50) logs.pop();
  el.innerHTML = logs.map(function(t) { return '<span class="time">' + t + '</span>  Dashboard refreshed (today: ' + today + ')'; }).join('\n');
}

async function action(cmd) {
  if (!SECRET) {
    document.getElementById('action-status').textContent = 'Set your API secret first';
    document.getElementById('action-status').style.color = '#f85149';
    return;
  }
  var status = document.getElementById('action-status');
  status.textContent = 'Running...';
  status.style.color = '#d29922';
  try {
    var r = await fetch('/dashboard/action/' + cmd, {
      method: 'POST',
      headers: {'X-Dashboard-Secret': SECRET}
    });
    var j = await r.json();
    var n = j.processed || j.deleted || 0;
    status.textContent = 'Done: ' + n + ' email(s)';
    status.style.color = '#3fb950';
    load();
  } catch(e) {
    status.textContent = 'Failed: ' + e.message;
    status.style.color = '#f85149';
  }
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
        from src.persistence.tracker import get_processed_count, get_last_poll_time
        return {
            "processed_today": get_processed_count(days=1),
            "processed_week": get_processed_count(days=7),
            "last_poll": get_last_poll_time(),
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
            count = poll_once()
            return {"status": "ok", "processed": count}
        elif cmd == "cleanup":
            from src.scheduler.cleanupper import run_cleanup
            total = run_cleanup()
            return {"status": "ok", "processed": total}
        elif cmd == "spam-delete":
            from src.scheduler.spam_deleter import run_spam_delete
            total = run_spam_delete()
            return {"status": "ok", "deleted": total}
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {cmd}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


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
        count = poll_once()
        return {"status": "ok", "processed": count}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


@app.post("/api/cleanup")
async def api_cleanup(request: Request):
    """Batch process all historical unlabeled emails."""
    _verify_secret(request)
    try:
        from src.scheduler.cleanupper import run_cleanup
        total = run_cleanup()
        return {"status": "ok", "processed": total}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=_safe_error(exc))


@app.post("/api/spam-delete")
async def api_spam_delete(request: Request):
    """Delete spam emails older than configured threshold."""
    _verify_secret(request)
    try:
        from src.scheduler.spam_deleter import run_spam_delete
        total = run_spam_delete()
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
