"""Stateless approval tools; hooks owns identities, exact actions, grants and claims."""

import asyncio
import json
from enum import Enum
from typing import Annotated, Any, Literal
from urllib.parse import quote, urlsplit

import httpx
from arcade_core.errors import ToolExecutionError
from arcade_mcp_server import Context, MCPApp
from arcade_mcp_server.auth import OAuth2, Slack
from arcade_mcp_server.metadata import Behavior, Operation, ToolMetadata
from pydantic import BaseModel, ConfigDict, Field, ValidationError

__version__ = "1.0.0"
HOOKS_HOST_SECRET = "HOOKS_PUBLIC_HOST"
SERVICE_TOKEN_SECRET = "APPROVALS_SERVICE_TOKEN"
SLACK_SCOPES = ["chat:write", "im:write", "users:read", "users:read.email"]
IDP_PROVIDER_ID = "cg-idp"


class ApprovalDecision(str, Enum):
    APPROVE = "approve"
    DENY = "deny"


class PublicRequest(BaseModel):
    """Only the server's filtered display copy may reach Slack or the model."""

    model_config = ConfigDict(extra="ignore", strict=True)
    request_id: str = Field(min_length=1)
    requester_id: str = Field(min_length=1)
    approver_id: str = Field(min_length=1)
    requester_name: str
    approver_name: str
    operation_key: str = Field(min_length=1)
    tool_name: str
    inputs: dict[str, Any]
    resource_id: str | None
    required_clearance: float
    status: Literal["pending", "approved", "denied", "expired"]
    notification_status: Literal["pending", "sending", "sent", "failed", "uncertain"]
    approval_url: str


class DeliveryClaim(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)
    claim_id: str | None
    notification_status: Literal["pending", "sending", "sent", "failed", "uncertain"]


class SlackFailure(Exception):
    def __init__(self, code: str, outcome: Literal["failed", "uncertain"]):
        super().__init__(code)
        self.code = code
        self.outcome = outcome


# Only errors known to reject before sending permit another claim. Slack's
# internal_error/fatal_error explicitly allow partial success, despite ok:false.
NO_SEND_ERRORS = {
    "invalid_auth",
    "not_authed",
    "token_expired",
    "token_revoked",
    "account_inactive",
    "missing_scope",
    "no_permission",
    "channel_not_found",
    "not_in_channel",
    "is_archived",
    "restricted_action",
    "invalid_blocks",
    "invalid_blocks_format",
    "msg_blocks_too_long",
    "no_text",
    "rate_limited",
    "ratelimited",
}


def _credentials(context: Context) -> tuple[str, str, str]:
    actor = context.user_id
    if not isinstance(actor, str) or not actor.strip():
        raise ToolExecutionError("The tool requires an authenticated Arcade user.")
    token = context.get_auth_token_or_empty()
    if not token:
        raise ToolExecutionError("The tool requires its user's OAuth authorization.")
    try:
        host = context.get_secret(HOOKS_HOST_SECRET).strip()
        service_token = context.get_secret(SERVICE_TOKEN_SECRET).strip()
    except ValueError as exc:
        raise ToolExecutionError(
            "The approvals service secrets are not configured."
        ) from exc
    parsed = urlsplit("https://" + host)
    if (
        not host
        or parsed.netloc != host
        or parsed.username
        or parsed.password
        or not parsed.hostname
    ):
        raise ToolExecutionError(
            "HOOKS_PUBLIC_HOST must be a host, without a URL path."
        )
    if not service_token:
        raise ToolExecutionError("The approvals service credential is not configured.")
    scheme = "http" if parsed.hostname in ("localhost", "127.0.0.1", "::1") else "https"
    return actor, token, f"{scheme}://{host}"


async def _service(
    client: httpx.AsyncClient,
    context: Context,
    base: str,
    path: str,
    body: dict[str, Any],
    *,
    actor_token: str | None = None,
    acknowledge: bool = False,
) -> dict[str, Any]:
    headers = {"Authorization": "Bearer " + context.get_secret(SERVICE_TOKEN_SECRET)}
    if actor_token is not None:
        headers["X-Actor-Token"] = actor_token
    attempts = 3 if acknowledge else 1
    for attempt in range(attempts):
        try:
            response = await client.post(base + path, json=body, headers=headers)
        except httpx.HTTPError as exc:
            if attempt + 1 < attempts:
                await asyncio.sleep(0.1 * (attempt + 1))
                continue
            message = "The approvals service could not be reached."
            if acknowledge:
                message += " Delivery acknowledgement is unresolved; do not resend the Slack message."
            raise ToolExecutionError(message) from exc
        if response.status_code >= 500 and attempt + 1 < attempts:
            await asyncio.sleep(0.1 * (attempt + 1))
            continue
        if not response.is_success:
            message = f"The approvals service rejected the request (HTTP {response.status_code})."
            if response.status_code == 409:
                try:
                    failure = response.json()
                except ValueError:
                    failure = None
                if (
                    isinstance(failure, dict)
                    and failure.get("error")
                    == "Request already has a different or expired decision."
                ):
                    # Only this known reason selects a fixed message. Never echo
                    # arbitrary response fields, even beside a recognized error.
                    message = "This approval request has expired or was already decided differently (HTTP 409). Open the request to review its current status."
            if acknowledge:
                message += " Delivery acknowledgement is unresolved; do not resend the Slack message."
            raise ToolExecutionError(message)
        try:
            result = response.json()
        except ValueError as exc:
            raise ToolExecutionError(
                "The approvals service returned an invalid response."
            ) from exc
        if not isinstance(result, dict):
            raise ToolExecutionError(
                "The approvals service returned an invalid response."
            )
        return result
    raise AssertionError("Unreachable acknowledgement loop")


def _request_view(value: dict[str, Any]) -> PublicRequest:
    try:
        return PublicRequest.model_validate(value)
    except ValidationError as exc:
        raise ToolExecutionError(
            "The approvals service returned an invalid approval record."
        ) from exc


async def _slack(
    client: httpx.AsyncClient, base: str, token: str, method: str, body: dict[str, Any]
) -> dict[str, Any]:
    try:
        response = await client.post(
            f"{base.rstrip('/')}/{method}",
            json=body,
            headers={"Authorization": "Bearer " + token},
        )
    except httpx.HTTPError as exc:
        raise SlackFailure("transport_error", "uncertain") from exc
    if response.status_code == 429:
        raise SlackFailure("rate_limited", "failed")
    if not response.is_success:
        raise SlackFailure(f"http_{response.status_code}", "uncertain")
    try:
        result = response.json()
    except ValueError as exc:
        raise SlackFailure("invalid_response", "uncertain") from exc
    if not isinstance(result, dict):
        raise SlackFailure("invalid_response", "uncertain")
    if result.get("ok") is not True:
        code = result.get("error")
        # Do not relay arbitrary upstream strings, which could contain credentials.
        if not isinstance(code, str) or not code.replace("_", "").isalnum():
            code = "invalid_response"
        raise SlackFailure(code, "failed" if code in NO_SEND_ERRORS else "uncertain")
    return result


def _text(value: str) -> dict[str, str]:
    return {"type": "plain_text", "text": value[:1900]}


def _message(view: PublicRequest, channel: str) -> dict[str, Any]:
    parsed = urlsplit(view.approval_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username:
        raise ToolExecutionError(
            "The approvals service returned an invalid approval URL."
        )
    inputs = json.dumps(view.inputs, ensure_ascii=False, sort_keys=True)
    return {
        "channel": channel,
        "text": f"Workshop approval {view.request_id}: {view.requester_name} requests {view.approver_name}'s review.",
        "unfurl_links": False,
        "unfurl_media": False,
        "mrkdwn": False,
        "blocks": [
            {"type": "header", "text": _text("Workshop approval request")},
            {
                "type": "section",
                "fields": [
                    _text(f"Requester: {view.requester_name}"),
                    _text(f"Assigned approver: {view.approver_name}"),
                    _text(f"Action: {view.tool_name}"),
                    _text(f"Resource: {view.resource_id or 'None'}"),
                    _text(f"Required authority: ${view.required_clearance:,.0f}"),
                    _text(f"Operation: {view.operation_key}"),
                ],
            },
            {
                "type": "section",
                "text": _text(f"Requested action details (display copy):\n{inputs}"),
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": _text("Review request"),
                        "url": view.approval_url,
                    }
                ],
            },
            {
                "type": "context",
                "elements": [
                    _text(
                        "Solo workshop: this self-DM is delivery only. Sign in as the assigned demo approver to decide."
                    )
                ],
            },
        ],
    }


def create_app(*, slack_api_base_url: str = "https://slack.com/api") -> MCPApp:
    """The injectable URL is a network boundary for local integration tests."""
    app = MCPApp(name="approvals", version=__version__)
    secrets = [HOOKS_HOST_SECRET, SERVICE_TOKEN_SECRET]

    @app.tool(
        name="RequestApproval",
        requires_auth=Slack(scopes=SLACK_SCOPES),
        requires_secrets=secrets,
        metadata=ToolMetadata(
            behavior=Behavior(
                operations=[Operation.CREATE],
                read_only=False,
                destructive=False,
                idempotent=False,
                open_world=True,
            )
        ),
    )
    async def request_approval(
        context: Context,
        denial_id: Annotated[
            str, "The opaque denial ID supplied by the governance hook."
        ],
        justification: Annotated[
            str, "Why the exact blocked action should be approved."
        ],
    ) -> Annotated[
        dict[str, Any],
        "Approval status and Slack delivery state; this does not execute the blocked action.",
    ]:
        """Request review of a server-recorded denial. Posts to the requester's authorized Slack self-DM only when the workshop enables solo delivery. Reusing a denial returns its request; sending/sent/uncertain delivery never reposts. The assigned demo approver must authenticate and decide; this tool grants no permission."""
        actor, token, base = _credentials(context)
        async with httpx.AsyncClient(timeout=10.0) as client:
            view = _request_view(
                await _service(
                    client,
                    context,
                    base,
                    "/internal/approvals/request",
                    {
                        "denial_id": denial_id,
                        "justification": justification,
                        "requester_id": actor,
                    },
                )
            )
            if view.requester_id != actor:
                raise ToolExecutionError(
                    "The approval does not belong to the requesting identity."
                )
            if view.status != "pending" or view.notification_status in (
                "sending",
                "sent",
                "uncertain",
            ):
                return view.model_dump()
            try:
                identity = await _slack(
                    client, slack_api_base_url, token, "auth.test", {}
                )
                user_id, team_id = identity.get("user_id"), identity.get("team_id")
                if (
                    not isinstance(user_id, str)
                    or not user_id
                    or not isinstance(team_id, str)
                    or not team_id
                ):
                    raise SlackFailure("invalid_identity", "failed")
                opened = await _slack(
                    client,
                    slack_api_base_url,
                    token,
                    "conversations.open",
                    {"users": user_id},
                )
                channel = (
                    opened.get("channel", {}).get("id")
                    if isinstance(opened.get("channel"), dict)
                    else None
                )
                if not isinstance(channel, str) or not channel.startswith("D"):
                    raise SlackFailure("invalid_channel", "failed")
            except SlackFailure as exc:
                raise ToolExecutionError(
                    f"Slack delivery could not be prepared ({exc.code}); no message was sent."
                ) from exc
            message = _message(view, channel)
            path = "/internal/approvals/" + quote(view.request_id, safe="")
            try:
                claim = DeliveryClaim.model_validate(
                    await _service(
                        client,
                        context,
                        base,
                        path + "/notification/claim",
                        {
                            "requester_id": actor,
                            "slack_user_id": user_id,
                            "slack_team_id": team_id,
                        },
                    )
                )
            except ValidationError as exc:
                raise ToolExecutionError(
                    "The approvals service returned an invalid delivery claim."
                ) from exc
            if claim.claim_id is None:
                if claim.notification_status not in ("sending", "sent", "uncertain"):
                    raise ToolExecutionError(
                        "The approvals service returned an invalid delivery claim."
                    )
                return {
                    **view.model_dump(),
                    "notification_status": claim.notification_status,
                }
            if not claim.claim_id or claim.notification_status != "sending":
                raise ToolExecutionError(
                    "The approvals service returned an invalid delivery claim."
                )
            receipt: dict[str, Any] = {
                "requester_id": actor,
                "claim_id": claim.claim_id,
            }
            try:
                sent = await _slack(
                    client, slack_api_base_url, token, "chat.postMessage", message
                )
                if (
                    sent.get("channel") != channel
                    or not isinstance(sent.get("ts"), str)
                    or not sent["ts"]
                ):
                    raise SlackFailure("invalid_acknowledgement", "uncertain")
                receipt.update(outcome="sent", channel=channel, ts=sent["ts"])
            except SlackFailure as exc:
                receipt.update(outcome=exc.outcome, error=exc.code)
            return _request_view(
                await _service(
                    client,
                    context,
                    base,
                    path + "/notification/result",
                    receipt,
                    acknowledge=True,
                )
            ).model_dump()

    @app.tool(
        name="Decide",
        requires_auth=OAuth2(id=IDP_PROVIDER_ID, scopes=["openid", "email"]),
        requires_secrets=secrets,
        metadata=ToolMetadata(
            behavior=Behavior(
                operations=[Operation.UPDATE],
                read_only=False,
                destructive=False,
                idempotent=True,
                open_world=False,
            )
        ),
    )
    async def decide(
        context: Context,
        request_id: Annotated[str, "The approval request ID shown on the review page."],
        decision: Annotated[
            ApprovalDecision, "Approve or deny the exact recorded action."
        ],
        note: Annotated[
            str | None, "Optional explanation recorded with the decision."
        ] = None,
    ) -> Annotated[dict[str, Any], "The committed approval status and operation key."]:
        """Commit the authenticated assigned approver's decision through the governance service. The requester cannot self-approve; possession of a request ID provides no authority. Repeated identical decisions are idempotent and conflicting decisions fail. This does not execute the business action."""
        actor, token, base = _credentials(context)
        body: dict[str, Any] = {"actor_id": actor, "decision": decision.value}
        if note is not None:
            body["note"] = note
        async with httpx.AsyncClient(timeout=10.0) as client:
            return await _service(
                client,
                context,
                base,
                "/internal/approvals/" + quote(request_id, safe="") + "/decision",
                body,
                actor_token=token,
            )

    return app


app = create_app()
