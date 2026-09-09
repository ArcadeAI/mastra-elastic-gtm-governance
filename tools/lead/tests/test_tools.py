"""Sales MCP wire protocol → actual business HTTP API → SQLite."""

import json

import pytest

from lead import app
from tests.conftest import DANA, RILEY

ACTION = {
    "account_id": "ACC-2291",
    "discount_percent": 30,
    "list_price": 12000,
    "rationale": "Account renewal evidence.",
    "operation_key": "python-offer",
}


def payload(result):
    if result.structuredContent is not None:
        return result.structuredContent
    return json.loads(
        next(block.text for block in result.content if block.type == "text")
    )


async def test_actual_mcp_exposes_only_four_sales_tools(client_factory):
    async with client_factory() as client:
        tools = (await client.list_tools()).tools
        assert sorted(tool.name for tool in tools) == [
            "Sales_CreateDiscountedOffer",
            "Sales_GetAccount",
            "Sales_GetOffer",
            "Sales_SearchAccounts",
        ]
        required = {
            tool.name: sorted(tool.inputSchema.get("required", [])) for tool in tools
        }
        assert required == {
            "Sales_CreateDiscountedOffer": [
                "account_id",
                "discount_percent",
                "list_price",
                "operation_key",
                "rationale",
            ],
            "Sales_GetAccount": ["account_id"],
            "Sales_GetOffer": ["account_id"],
            "Sales_SearchAccounts": [],
        }
        for tool in tools:
            assert not {"actor", "user_id", "decided_by", "activation_token"} & set(
                tool.inputSchema.get("properties", {})
            )


def test_every_registered_tool_requires_cg_idp_and_only_the_business_host():
    for tool in app._catalog:
        assert tool.definition.requirements.authorization.id == "cg-idp"
        assert [secret.key for secret in tool.definition.requirements.secrets] == [
            "LEAD_APP_PUBLIC_HOST"
        ]
        assert tool.definition.metadata.behavior.read_only == (
            tool.definition.name != "CreateDiscountedOffer"
        )


async def test_search_and_account_read_share_exact_fixture_identity(client_factory):
    async with client_factory() as client:
        result = payload(
            await client.call_tool("Sales_SearchAccounts", {"query": "northwind"})
        )
        assert result["count"] == 1
        assert result["accounts"][0]["account_id"] == "ACC-2291"
        assert result["accounts"][0]["company_domain"] == "northwindrobotics.example"
        account = payload(
            await client.call_tool("Sales_GetAccount", {"account_id": "ACC-2291"})
        )
        assert account["list_price"] == 12000
        assert account["offer"] is None
        assert (
            account["provisioning"]["activation_token"]
            == "workshop_activation_FAKE_northwind_setup"
        )
        assert (
            await client.call_tool("Sales_GetOffer", {"account_id": "ACC-2291"})
        ).isError


@pytest.mark.parametrize("discount,net_price", [(15, 10200), (30, 8400), (100, 0)])
async def test_valid_discount_commits_local_draft_without_business_policy(
    client_factory, discount, net_price
):
    async with client_factory() as client:
        result = await client.call_tool(
            "Sales_CreateDiscountedOffer", {**ACTION, "discount_percent": discount}
        )
        assert not result.isError
        offer = payload(result)
        assert offer["net_price"] == net_price and offer["status"] == "draft"
        assert offer["activation_email"]["activation_token"].startswith(
            "workshop_activation_FAKE_"
        )
        assert (
            offer["activation_email"]["activation_token"]
            in offer["activation_email"]["body"]
        )
        assert "not sent" in offer["activation_email"]["body"]
        assert offer["decisions"][0]["decided_by"] == DANA
        assert (
            payload(
                await client.call_tool("Sales_GetOffer", {"account_id": "ACC-2291"})
            )
            == offer
        )


@pytest.mark.parametrize(
    "change",
    [
        {"discount_percent": -1},
        {"discount_percent": 101},
        {"list_price": 0},
        {"rationale": ""},
    ],
)
async def test_invalid_discount_never_creates_offer(client_factory, change):
    async with client_factory() as client:
        assert (
            await client.call_tool("Sales_CreateDiscountedOffer", {**ACTION, **change})
        ).isError
        account = payload(
            await client.call_tool("Sales_GetAccount", {"account_id": "ACC-2291"})
        )
        assert account["offer"] is None and account["decisions"] == []


async def test_one_key_replays_same_draft_after_new_mcp_process(client_factory):
    async with client_factory() as client:
        first = payload(await client.call_tool("Sales_CreateDiscountedOffer", ACTION))
    async with client_factory() as client:
        assert (
            payload(await client.call_tool("Sales_CreateDiscountedOffer", ACTION))
            == first
        )
        assert (
            await client.call_tool(
                "Sales_CreateDiscountedOffer", {**ACTION, "rationale": "Changed"}
            )
        ).isError
        current = payload(
            await client.call_tool("Sales_GetAccount", {"account_id": "ACC-2291"})
        )
        assert len(current["decisions"]) == 1
    async with client_factory(RILEY) as client:
        assert (await client.call_tool("Sales_CreateDiscountedOffer", ACTION)).isError


async def test_rejected_identity_cannot_read_accounts(client_factory):
    async with client_factory("forged@example.test") as client:
        assert (await client.call_tool("Sales_SearchAccounts", {})).isError


async def test_stale_price_fails_without_offer(client_factory):
    async with client_factory() as client:
        result = await client.call_tool(
            "Sales_CreateDiscountedOffer", {**ACTION, "list_price": 1}
        )
        assert result.isError
        assert "stored value" in str(result)
        assert (
            payload(
                await client.call_tool("Sales_GetAccount", {"account_id": "ACC-2291"})
            )["offer"]
            is None
        )
