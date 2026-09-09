"""Exercise registered tools over stdio and actual HTTP process boundaries."""

import json
import os
import sys
import threading
from contextlib import asynccontextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

DANA = "attendee@example.test"
RILEY = "riley@example.test"
SERVICE_TOKEN = "approvals-test-service-token"
TOOL_ROOT = Path(__file__).resolve().parents[1]


class Boundary:
    """HTTP contract stand-ins; no toolkit function or HTTP client is mocked."""

    def __init__(self):
        self.lock = threading.Lock()
        self.request = None
        self.claim = None
        self.posts = []
        self.received = []
        self.post_result = {"ok": True, "channel": "DSELF", "ts": "100.001"}
        self.post_http_status = 200
        self.drop_post_response = False
        self.ack_failures = 0
        self.solo_enabled = True
        self.auth_token = "slack-user-token"
        self.reject_slack_authorization = False
        self.idp_token = None
        self.request_changes = {}
        self.raw_claim = None
        self.decision_error = None

    def handle(self, path, body, headers):
        with self.lock:
            self.received.append((path, body, dict(headers)))
            if path == "/oauth2/userinfo":
                token = headers.get("Authorization", "")
                if token in {"Bearer idp-" + DANA, "Bearer idp-" + RILEY}:
                    return 200, {"email": token.removeprefix("Bearer idp-")}
                return 401, {"error": "Invalid actor token"}
            if path.startswith("/internal/operations/"):
                return 404, {"error": "No completed operation"}
            if path == "/internal/leads/LD-2291/value":
                if headers.get("Authorization") != "Bearer lead-internal":
                    return 401, {"error": "Invalid Lead service credential"}
                return 200, {"lead_id": "LD-2291", "estimated_acv": 95000}
            if path.startswith("/v1/") and path.endswith("/auth/authorize"):
                provider = body["auth_requirement"]
                if (
                    provider.get("provider_id") == "slack"
                    and self.reject_slack_authorization
                ):
                    return 403, {
                        "error": "The requester rejected delegated Slack authorization"
                    }
                token = (
                    self.auth_token
                    if provider.get("provider_id") == "slack"
                    else (self.idp_token or "idp-" + body["user_id"])
                )
                return 200, {
                    "id": "auth-test",
                    "status": "completed",
                    "context": {"token": token},
                }
            if path.startswith("/slack/"):
                if headers.get("Authorization") != "Bearer " + self.auth_token:
                    return 200, {"ok": False, "error": "invalid_auth"}
                if path == "/slack/auth.test":
                    return 200, {
                        "ok": True,
                        "user_id": "UATTENDEE",
                        "team_id": "TWORKSHOP",
                    }
                if path == "/slack/conversations.open":
                    # Slack's wire schema is comma-separated text, not an array.
                    if body["users"] != "UATTENDEE":
                        return 200, {"ok": False, "error": "invalid_array_arg"}
                    return 200, {"ok": True, "channel": {"id": "DSELF"}}
                if path == "/slack/chat.postMessage":
                    self.posts.append(body)
                    return self.post_http_status, self.post_result
            if headers.get("Authorization") != "Bearer " + SERVICE_TOKEN:
                return 401, {"error": "Invalid approvals service credential"}
            if path == "/internal/approvals/request":
                if body["requester_id"] != DANA or body["denial_id"] != "denial-1":
                    return 403, {"error": "Denial is not owned by requester"}
                if self.request is None:
                    self.request = {
                        "request_id": "request-1",
                        "requester_id": DANA,
                        "approver_id": RILEY,
                        "requester_name": "Dana Okafor",
                        "approver_name": "Riley Chen",
                        "operation_key": "operation-1",
                        "tool_name": "Lead.RouteLead",
                        "inputs": {
                            "lead_id": "LD-2291",
                            "estimated_acv": 95000,
                            "owner_email": "sales@example.test",
                            "rationale": "Enterprise interest",
                        },
                        "resource_id": "LD-2291",
                        "required_clearance": 95000,
                        "status": "pending",
                        "notification_status": "pending",
                        "approval_url": "https://workshop.example/approvals/request-1",
                    }
                return 200, {**self.request, **self.request_changes}
            if path.endswith("/notification/claim"):
                if self.raw_claim is not None:
                    return 200, self.raw_claim
                if (
                    not self.solo_enabled
                    or body["slack_team_id"] != "TWORKSHOP"
                    or body["slack_user_id"] != "UATTENDEE"
                ):
                    return 403, {"error": "Solo Slack delivery is not configured"}
                if self.request["notification_status"] in (
                    "sending",
                    "sent",
                    "uncertain",
                ):
                    return 200, {
                        "claim_id": None,
                        "notification_status": self.request["notification_status"],
                    }
                self.claim = "claim-1"
                self.request["notification_status"] = "sending"
                return 200, {"claim_id": self.claim, "notification_status": "sending"}
            if path.endswith("/notification/result"):
                if self.ack_failures:
                    self.ack_failures -= 1
                    return 503, {"error": "Temporary acknowledgement failure"}
                if body["claim_id"] != self.claim:
                    return 409, {"error": "Invalid delivery claim"}
                self.request["notification_status"] = body["outcome"]
                return 200, dict(self.request)
            if path.endswith("/decision"):
                actor = body["actor_id"]
                if headers.get("X-Actor-Token") != "idp-" + actor or actor != RILEY:
                    return 403, {
                        "error": "Only the authenticated assigned approver may decide"
                    }
                if self.decision_error is not None:
                    return self.decision_error
                self.request["status"] = (
                    "approved" if body["decision"] == "approve" else "denied"
                )
                return 200, dict(self.request)
            return 404, {"error": "Unknown test endpoint"}


@pytest.fixture
def boundary():
    state = Boundary()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            code, result = state.handle(urlsplit(self.path).path, {}, self.headers)
            self.respond(code, result)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            code, result = state.handle(urlsplit(self.path).path, body, self.headers)
            if self.path == "/slack/chat.postMessage" and state.drop_post_response:
                self.close_connection = True
                return
            self.respond(code, result)

        def respond(self, code, result):
            payload = (
                result if isinstance(result, bytes) else json.dumps(result).encode()
            )
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    state.host = f"127.0.0.1:{server.server_port}"
    yield state
    server.shutdown()
    server.server_close()


@pytest.fixture
def client_factory(boundary, tmp_path):
    @asynccontextmanager
    async def connect(actor=DANA, service_token=SERVICE_TOKEN, hooks_host=None):
        env = {
            **os.environ,
            "PYTHONPATH": str(TOOL_ROOT),
            "ARCADE_API_KEY": "test-arcade-key",
            "ARCADE_API_URL": f"http://{boundary.host}",
            "ARCADE_USER_ID": actor,
            "HOOKS_PUBLIC_HOST": hooks_host or boundary.host,
            "APPROVALS_SERVICE_TOKEN": service_token,
            "TEST_SLACK_URL": f"http://{boundary.host}/slack",
            "ARCADE_ENVIRONMENT": "test",
            "ARCADE_WORK_DIR": str(tmp_path),
            "ARCADE_TELEMETRY_DISABLED": "true",
        }
        args = StdioServerParameters(
            command=sys.executable,
            args=[str(TOOL_ROOT / "tests/mcp_server.py")],
            env=env,
            cwd=str(TOOL_ROOT),
        )
        async with stdio_client(args) as streams, ClientSession(*streams) as client:
            await client.initialize()
            yield client

    return connect


def payload(result):
    assert not result.isError, result
    if result.structuredContent is not None:
        return result.structuredContent
    return json.loads(result.content[0].text)


async def request(client, **changes):
    return await client.call_tool(
        "Approvals_RequestApproval",
        {
            "denial_id": "denial-1",
            "justification": "Enterprise qualification",
            **changes,
        },
    )
