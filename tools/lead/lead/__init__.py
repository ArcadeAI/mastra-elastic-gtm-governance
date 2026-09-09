"""Sales tools are stateless clients of the account and discounted-offer API.

The Python package and service-secret names stay stable for deployment. The
exposed MCP toolkit is Sales. Activation emails are local drafts, never sent.
"""

import re
from typing import Annotated, Any
from urllib.parse import quote

import httpx
from arcade_core.errors import ToolExecutionError
from arcade_mcp_server import Context, MCPApp
from arcade_mcp_server.auth import OAuth2
from arcade_mcp_server.metadata import Behavior, Operation, ToolMetadata

__all__ = [
    "IDP_PROVIDER_ID",
    "LEAD_APP_HOST_SECRET",
    "app",
    "create_discounted_offer",
    "get_account",
    "get_offer",
    "search_accounts",
]
app = MCPApp(
    name="sales",
    version="1.0.0",
    instructions="Inspect an account, create its discounted yearly offer and local activation-email draft, then double-check the saved offer. Account IDs look like ACC-2291. No email is sent.",
)
IDP_PROVIDER_ID = "cg-idp"
IDP_SCOPES = ["openid", "email"]
LEAD_APP_HOST_SECRET = "LEAD_APP_PUBLIC_HOST"
_requires_auth = OAuth2(id=IDP_PROVIDER_ID, scopes=IDP_SCOPES)
_requires_secrets = [LEAD_APP_HOST_SECRET]
_read = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.READ],
        read_only=True,
        destructive=False,
        idempotent=True,
        open_world=False,
    )
)
_write = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.UPDATE],
        read_only=False,
        destructive=False,
        idempotent=True,
        open_world=False,
    )
)


def _base_url(host: str) -> str:
    if host.startswith(("http://", "https://")):
        return host.rstrip("/")
    local = host.startswith(("localhost", "127.0.0.1"))
    return f"{'http' if local else 'https'}://{host}"


async def _call(
    context: Context,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json: dict[str, Any] | None = None,
    operation_key: str | None = None,
) -> dict[str, Any]:
    """Call the sales API on behalf of the user represented by the token."""
    url = _base_url(context.get_secret(LEAD_APP_HOST_SECRET)) + path
    headers = {"Authorization": f"Bearer {context.get_auth_token_or_empty()}"}
    if operation_key is not None:
        if re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", operation_key) is None:
            raise ToolExecutionError("A valid operation_key is required.")
        headers["Idempotency-Key"] = operation_key

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.request(
                method,
                url,
                params=params,
                json=json,
                headers=headers,
            )
        except httpx.HTTPError as exc:
            raise ToolExecutionError(
                "The sales system could not be reached.",
                developer_message=f"{method} {url}: {exc!r}",
            ) from exc

    if response.is_success:
        try:
            payload = response.json()
        except ValueError as exc:
            raise ToolExecutionError(
                "The sales system returned an invalid response.",
                developer_message=f"{method} {url} returned non-JSON: {response.text}",
            ) from exc
        if not isinstance(payload, dict):
            raise ToolExecutionError(
                "The sales system returned an invalid response.",
                developer_message=f"{method} {url} returned {type(payload).__name__}, not an object.",
            )
        return payload

    try:
        payload = response.json()
        message = (
            payload.get("error", response.text)
            if isinstance(payload, dict)
            else response.text
        )
    except ValueError:
        message = response.text
    raise ToolExecutionError(
        str(message),
        developer_message=f"{method} {url} -> {response.status_code}: {response.text}",
    )


AccountId = Annotated[
    str, "The account ID, for example ACC-2291 for Northwind Robotics."
]
OperationKey = Annotated[
    str,
    "Stable operation key for this exact write; reuse unchanged for retries. 1–128 ASCII letters, digits, dots, underscores, colons, or hyphens.",
]


def _account_path(account_id: str) -> str:
    return f"/accounts/{quote(account_id, safe='')}"


@app.tool(  # type: ignore[arg-type]
    requires_auth=_requires_auth,
    requires_secrets=_requires_secrets,
    metadata=_read,
)
async def search_accounts(
    context: Context,
    query: Annotated[
        str | None, "Optional account ID, company name, or domain substring."
    ] = None,
) -> Annotated[dict[str, Any], "Matching count and account summaries."]:
    """Find accounts buying B2B identity and access software. Results show company, account ID, yearly list price, and product. Inspect the selected account before preparing an offer."""
    return await _call(
        context, "GET", "/accounts", params={} if query is None else {"q": query}
    )


@app.tool(  # type: ignore[arg-type]
    requires_auth=_requires_auth,
    requires_secrets=_requires_secrets,
    metadata=_read,
)
async def get_account(
    context: Context, account_id: AccountId
) -> Annotated[
    dict[str, Any],
    "Account, billing contact, trial provisioning, current offer, and decision history.",
]:
    """Inspect the account's current yearly list price, billing contact, trial activation record, and any existing offer. Copy list_price exactly when creating an offer; it is an assertion, not a price update."""
    return await _call(context, "GET", _account_path(account_id))


@app.tool(  # type: ignore[arg-type]
    requires_auth=_requires_auth,
    requires_secrets=_requires_secrets,
    metadata=_write,
)
async def create_discounted_offer(
    context: Context,
    account_id: AccountId,
    operation_key: OperationKey,
    discount_percent: Annotated[
        float,
        "Requested percentage discount from 0 through 100, inclusive; for example 30.",
    ],
    list_price: Annotated[
        float,
        "Current yearly list price in US dollars, copied exactly from get_account. This does not update the stored list price.",
    ],
    rationale: Annotated[
        str,
        "Reason for the offer, with supporting account evidence. Stored verbatim for a human reader.",
    ],
) -> Annotated[
    dict[str, Any],
    "Saved discounted offer and local activation-email draft, including net price and decision history.",
]:
    """Commit a discounted yearly offer and activation-email draft in one system-of-record transaction. The offer status is draft and no email is sent. A stable operation_key with the identical actor and arguments returns the original saved result; changed arguments conflict. Inspect the account first, then double-check the saved offer with get_offer."""
    return await _call(
        context,
        "POST",
        f"{_account_path(account_id)}/offers",
        operation_key=operation_key,
        json={
            "discount_percent": discount_percent,
            "list_price": list_price,
            "rationale": rationale,
        },
    )


@app.tool(  # type: ignore[arg-type]
    requires_auth=_requires_auth,
    requires_secrets=_requires_secrets,
    metadata=_read,
)
async def get_offer(
    context: Context, account_id: AccountId
) -> Annotated[
    dict[str, Any], "The saved draft offer and activation email for the account."
]:
    """Double-check the most recently saved offer, its exact discount, yearly net price, local activation-email draft, and decision history. Returns an error if no offer has been saved. This is a read and never sends email."""
    return await _call(context, "GET", f"{_account_path(account_id)}/offer")
