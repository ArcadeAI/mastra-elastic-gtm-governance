"""Boot the real `apps/lead-app` and a stand-in identity provider.

The toolkit is stateless, so tests drive every tool through the real API:
`bun apps/lead-app/src/index.ts`, configured with a fresh temporary
`leads.db`. The identity stand-in serves the same `/oauth2/userinfo` endpoint
that the API uses in production.
"""

import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from arcade_core.schema import ToolAuthorizationContext, ToolContext, ToolSecretItem

from lead import LEAD_APP_HOST_SECRET

REPO_ROOT = Path(__file__).resolve().parents[3]
LEAD_APP_ENTRYPOINT = REPO_ROOT / "apps" / "lead-app" / "src" / "index.ts"

DANA = "dana@example.test"
RILEY = "riley@example.test"
TOKENS = {"tok-dana": DANA, "tok-riley": RILEY}


def _free_port() -> int:
    with socket.socket() as socket_handle:
        socket_handle.bind(("127.0.0.1", 0))
        return socket_handle.getsockname()[1]


class _Userinfo(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        token = (
            (self.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        )
        email = TOKENS.get(token)
        if self.path != "/oauth2/userinfo" or email is None:
            self.send_response(401)
            self.end_headers()
            return

        body = json.dumps(
            {"sub": email, "email": email, "email_verified": True}
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_: object) -> None:
        pass


@pytest.fixture(scope="session")
def idp_port() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Userinfo)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server.server_port
    server.shutdown()


@pytest.fixture(scope="session")
def lead_app_host(idp_port: int) -> str:
    bun = shutil.which("bun")
    if bun is None:
        pytest.skip("bun is not installed; toolkit tests drive the real apps/lead-app")

    port = _free_port()
    tmp = Path(tempfile.mkdtemp(prefix="cg-lead-toolkit-"))
    env = {
        **os.environ,
        "PORT": str(port),
        "LEADS_DB_PATH": str(tmp / "leads.db"),
        "IDP_PUBLIC_HOST": f"localhost:{idp_port}",
    }
    child = subprocess.Popen(
        [bun, str(LEAD_APP_ENTRYPOINT)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    host = f"localhost:{port}"
    deadline = time.time() + 20
    last_error: Exception | None = None
    while True:
        try:
            with urllib.request.urlopen(f"http://{host}/health", timeout=1) as response:
                if response.status == 200:
                    break
        except (TimeoutError, urllib.error.URLError) as exc:
            last_error = exc
        if child.poll() is not None:
            raise RuntimeError(f"lead-app exited: {child.stderr.read().decode()}")
        if time.time() > deadline:
            child.kill()
            raise RuntimeError(f"lead-app did not come up: {last_error}")
        time.sleep(0.05)

    yield host

    child.kill()
    child.wait()
    shutil.rmtree(tmp, ignore_errors=True)


def make_context(lead_app_host: str, token: str) -> ToolContext:
    """Build the token-and-secret context Arcade hands to a tool."""
    return ToolContext(
        authorization=ToolAuthorizationContext(token=token),
        secrets=[ToolSecretItem(key=LEAD_APP_HOST_SECRET, value=lead_app_host)],
        user_id=TOKENS.get(token),
    )


@pytest.fixture
def as_dana(lead_app_host: str) -> ToolContext:
    return make_context(lead_app_host, "tok-dana")


@pytest.fixture
def as_riley(lead_app_host: str) -> ToolContext:
    return make_context(lead_app_host, "tok-riley")


@pytest.fixture
def as_nobody(lead_app_host: str) -> ToolContext:
    return make_context(lead_app_host, "tok-forged")
