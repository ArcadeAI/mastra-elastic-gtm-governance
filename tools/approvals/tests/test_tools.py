import asyncio

import pytest
from conftest import DANA, RILEY, payload, request


async def test_registered_request_posts_real_self_dm(boundary, client_factory):
    async with client_factory() as client:
        called = await request(client)
        assert not called.isError, (
            [path for path, _, _ in boundary.received],
            called.content,
        )
        result = payload(called)
    assert result["request_id"] == "request-1"
    assert result["notification_status"] == "sent"
    assert len(boundary.posts) == 1
    posted = boundary.posts[0]
    assert posted["channel"] == "DSELF"
    rendered = str(posted)
    assert "Dana Okafor" in rendered and "Riley Chen" in rendered
    assert "LD-2291" in rendered and "95000" in rendered.replace(",", "")
    assert "https://workshop.example/approvals/request-1" in rendered
    forwarded = next(
        body
        for path, body, _ in boundary.received
        if path == "/internal/approvals/request"
    )
    assert forwarded["requester_id"] == DANA


async def test_registered_surface_excludes_actor_and_approved_arguments(client_factory):
    async with client_factory() as client:
        tools = {tool.name: tool for tool in (await client.list_tools()).tools}
    assert set(tools) == {"Approvals_RequestApproval", "Approvals_Decide"}
    assert set(tools["Approvals_RequestApproval"].inputSchema["properties"]) == {
        "denial_id",
        "justification",
    }
    assert set(tools["Approvals_Decide"].inputSchema["properties"]) == {
        "request_id",
        "decision",
        "note",
    }


async def test_repeated_and_concurrent_requests_deliver_one_message(
    boundary, client_factory
):
    async with client_factory() as client:
        results = await asyncio.gather(*(request(client) for _ in range(4)))
        final = payload(await request(client))
    assert all(payload(result)["request_id"] == "request-1" for result in results)
    assert final["notification_status"] == "sent"
    assert len(boundary.posts) == 1


@pytest.mark.parametrize(
    "code", ["internal_error", "fatal_error", "unknown_provider_error"]
)
async def test_ambiguous_slack_error_never_reposts(code, boundary, client_factory):
    boundary.post_result = {"ok": False, "error": code}
    async with client_factory() as client:
        first = payload(await request(client))
        again = payload(await request(client))
    assert first["notification_status"] == again["notification_status"] == "uncertain"
    assert len(boundary.posts) == 1


async def test_lost_slack_response_never_reposts(boundary, client_factory):
    boundary.drop_post_response = True
    async with client_factory() as client:
        first = payload(await request(client))
        again = payload(await request(client))
    assert first["notification_status"] == again["notification_status"] == "uncertain"
    assert len(boundary.posts) == 1


async def test_known_no_send_rejection_allows_explicit_tool_retry(
    boundary, client_factory
):
    boundary.post_result = {"ok": False, "error": "missing_scope"}
    async with client_factory() as client:
        first = payload(await request(client))
        assert first["notification_status"] == "failed"
        boundary.post_result = {"ok": True, "channel": "DSELF", "ts": "100.002"}
        second = payload(await request(client))
    assert second["notification_status"] == "sent"
    assert len(boundary.posts) == 2


async def test_lost_service_acknowledgement_retries_only_ack(boundary, client_factory):
    boundary.ack_failures = 2
    async with client_factory() as client:
        final = payload(await request(client))
    assert final["notification_status"] == "sent"
    assert len(boundary.posts) == 1
    acknowledgements = [
        body
        for path, body, _ in boundary.received
        if path.endswith("/notification/result")
    ]
    assert len(acknowledgements) == 3
    assert acknowledgements[0] == acknowledgements[1] == acknowledgements[2]


async def test_exhausted_ack_does_not_send_again(boundary, client_factory):
    boundary.ack_failures = 10
    async with client_factory() as client:
        first = await request(client)
        again = payload(await request(client))
    assert first.isError
    assert "do not resend" in str(first.content)
    assert again["notification_status"] == "sending"
    assert len(boundary.posts) == 1


@pytest.mark.parametrize("token", ["", "wrong-token"])
async def test_service_credential_failure_never_posts(token, boundary, client_factory):
    async with client_factory(service_token=token) as client:
        result = await request(client)
    assert result.isError
    assert boundary.posts == []


async def test_denial_ownership_rejection_never_posts(boundary, client_factory):
    async with client_factory(actor=RILEY) as client:
        result = await request(client)
    assert result.isError
    assert boundary.posts == []


async def test_solo_delivery_must_be_enabled(boundary, client_factory):
    boundary.solo_enabled = False
    async with client_factory() as client:
        result = await request(client)
    assert result.isError
    assert boundary.posts == []


async def test_authenticated_decision_forwards_idp_token(boundary, client_factory):
    async with client_factory() as dana:
        await request(dana)
    async with client_factory(actor=RILEY) as riley:
        result = payload(
            await riley.call_tool(
                "Approvals_Decide",
                {"request_id": "request-1", "decision": "approve", "note": "Reviewed"},
            )
        )
    assert result["status"] == "approved"
    _, body, headers = next(
        row for row in boundary.received if row[0].endswith("/decision")
    )
    assert body == {"actor_id": RILEY, "decision": "approve", "note": "Reviewed"}
    assert headers["X-Actor-Token"] == "idp-" + RILEY


async def test_requester_cannot_decide(boundary, client_factory):
    async with client_factory() as dana:
        await request(dana)
        result = await dana.call_tool(
            "Approvals_Decide", {"request_id": "request-1", "decision": "approve"}
        )
    assert result.isError
    assert boundary.request["status"] == "pending"


async def test_mismatched_idp_token_cannot_decide(boundary, client_factory):
    async with client_factory() as dana:
        await request(dana)
    boundary.idp_token = "idp-" + DANA
    async with client_factory(actor=RILEY) as riley:
        result = await riley.call_tool(
            "Approvals_Decide", {"request_id": "request-1", "decision": "approve"}
        )
    assert result.isError
    assert boundary.request["status"] == "pending"


async def test_malformed_claim_without_sending_state_is_rejected(
    boundary, client_factory
):
    boundary.raw_claim = {"claim_id": None, "notification_status": "pending"}
    async with client_factory() as client:
        result = await request(client)
    assert result.isError
    assert boundary.posts == []


async def test_rejected_delegated_slack_authorization_is_visible_without_delivery(
    boundary, client_factory
):
    boundary.reject_slack_authorization = True
    async with client_factory(actor=DANA) as dana:
        result = await request(dana)
    assert result.isError
    assert "rejected delegated Slack authorization" in str(result.content)
    authorizations = [
        body for path, body, _ in boundary.received if path.endswith("/auth/authorize")
    ]
    assert authorizations[0]["user_id"] == DANA
    assert authorizations[0]["auth_requirement"]["provider_id"] == "slack"
    assert boundary.request is None
    assert boundary.posts == []
    assert not any(path.startswith("/slack/") for path, _, _ in boundary.received)
    assert (
        result.structuredContent is None
        or result.structuredContent.get("notification_status") != "sent"
    )


@pytest.mark.parametrize(
    "status,body,known_expiry",
    [
        (
            409,
            {
                "error": "Request already has a different or expired decision.",
                "detail": "private-service-token",
            },
            True,
        ),
        (409, {"error": "private-service-token"}, False),
        (409, ["private-service-token"], False),
        (409, b'{"error":"private-service-token', False),
        (
            403,
            {
                "error": "Request already has a different or expired decision.",
                "detail": "private-service-token",
            },
            False,
        ),
    ],
    ids=[
        "known-expiry",
        "untrusted-message",
        "wrong-shape",
        "malformed-json",
        "wrong-status",
    ],
)
async def test_decision_errors_explain_only_the_known_safe_expiry(
    status, body, known_expiry, boundary, client_factory
):
    async with client_factory() as dana:
        await request(dana)
    boundary.decision_error = (status, body)
    async with client_factory(actor=RILEY) as riley:
        result = await riley.call_tool(
            "Approvals_Decide", {"request_id": "request-1", "decision": "approve"}
        )
    assert result.isError
    shown = str(result.content)
    assert f"HTTP {status}" in shown
    assert "private-service-token" not in shown
    assert ("expired" in shown) is known_expiry
    assert boundary.request["status"] == "pending"
