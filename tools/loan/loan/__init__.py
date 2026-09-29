"""The deals toolkit: four tools, each a stateless client of the app's loan module.

Nothing here holds state and nothing here decides anything. Every tool takes
the caller's OAuth token, hands it to the deal desk's API, and returns what the API
returns. The API derives who is acting from that token; the tools never say.

Whether a caller *may* do what they are asking is not this toolkit's question
either — that is decided by the control plane's hooks, on a path these tools
cannot see. The auth requirement on each tool carries identity, not authority.

The tool descriptions were written to be picked by a model without prompt
coaching and reviewed on that basis. They came across from the previous MCP
surface verbatim; change the wording only for a reason that survives review.
"""

from enum import Enum
from typing import Annotated, Any

import httpx
from arcade_core.errors import ToolExecutionError
from arcade_mcp_server import Context, MCPApp
from arcade_mcp_server.auth import OAuth2
from arcade_mcp_server.metadata import Behavior, Operation, ToolMetadata

__all__ = [
    "API_BASE_PATH",
    "APP_HOST_SECRET",
    "IDP_PROVIDER_ID",
    "app",
    "approve_discount",
    "deny_discount",
    "get_deal",
    "search_deals",
]

# The name here is what `arcade deploy` reads off `initialize` and becomes the
# server name Arcade files these tools under. Whether Arcade keeps it verbatim
# as the toolkit name or normalises it is measured on #35; the observed value
# is pinned in `.env.example` as ARCADE_LOAN_TOOLKIT. Alphanumerics and
# underscores only, per MCPApp — a hyphen is rejected at construction, and a
# hyphenated toolkit could not form a parseable Arcade tool name anyway
# (measured in spike #2).
app = MCPApp(
    name="deals",
    version="1.0.0",
    instructions=(
        "Deal desk for a B2B software company. Discount requests are identified "
        "by IDs of the form DL-0000. Use search_deals to find requests, get_deal to "
        "read one in full, and approve_discount or deny_discount to record a decision on one."
    ),
)

# The Arcade auth provider id the app's identity module is registered under
# (hop 2). Fixed, not configurable: `OAuth2(id=...)` is read at import, so the
# README tells a developer to register the provider under exactly this id
# (DESIGN.md → Toolkit configuration). It was `cg-idp`, the demo's service
# name, until #6. Renaming it is this one line and the README's instruction.
# The scopes are the least that make `/oauth2/userinfo` return an email, which
# is how the API attributes the call. They are not a gate: a scope refusal
# happens before any hook fires and would be invisible to the control plane.
IDP_PROVIDER_ID = "app-identity"
IDP_SCOPES = ["openid", "email"]

# HOST-form, like every service address in this repo (see `.env.example`).
# Delivered to the deployed toolkit as an Arcade secret, because that is the
# one configuration channel a deployed toolkit has. The app's own host since
# #6: the loan API is a module of the app, and one secret names the app for
# both toolkits.
APP_HOST_SECRET = "APP_PUBLIC_HOST"

# Where the loan API sits on that host. Since #5 the loan API is a module of
# the app (`lib/loans/`), served under `/bank` because the app's board page is
# `/loans`: GET /bank/loans, GET /bank/loans/{id}, POST /bank/loans/{id}/approve
# and POST /bank/loans/{id}/deny. The secret still names the host alone.
API_BASE_PATH = "/bank"

_requires_auth = OAuth2(id=IDP_PROVIDER_ID, scopes=IDP_SCOPES)
_requires_secrets = [APP_HOST_SECRET]

# The previous MCP surface carried `readOnlyHint`, `destructiveHint`,
# `idempotentHint` and `openWorldHint` on each tool. `arcade-mcp`'s
# `Behavior` is the equivalent, so they come across too: reads are read-only
# and closed-world; writes are neither destructive (nothing is deleted or
# overwritten — a decision is appended) nor idempotent (approving twice is two
# rows, on purpose). MCP `title` has no equivalent and is dropped. No
# `Classification`: its service domains describe third-party SaaS, and the
# bank's own deal book is not one (`arcade-mcp` rejects a domain on a
# closed-world tool). Note that spike #2 measured this metadata does not reach
# hook payloads; it is for clients, not for policy.
_read = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.READ], read_only=True, destructive=False, idempotent=True,
        open_world=False,
    ),
)
_write = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.CREATE], read_only=False, destructive=False, idempotent=False,
        open_world=False,
    ),
)


class DealStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"


def _base_url(host: str) -> str:
    local = host.startswith("localhost") or host.startswith("127.0.0.1")
    return f"{'http' if local else 'https'}://{host}"


async def _call(
    context: Context,
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json: dict[str, Any] | None = None,
) -> Any:
    """One request to the API, on behalf of whoever holds the token."""
    url = _base_url(context.get_secret(APP_HOST_SECRET)) + API_BASE_PATH + path
    headers = {"Authorization": f"Bearer {context.get_auth_token_or_empty()}"}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.request(method, url, params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            raise ToolExecutionError(
                "The deal desk could not be reached.",
                developer_message=f"{method} {url}: {exc!r}",
            ) from exc

    if response.is_success:
        return response.json()

    try:
        message = response.json().get("error", response.text)
    except ValueError:
        message = response.text
    raise ToolExecutionError(
        str(message),
        developer_message=f"{method} {url} -> {response.status_code}: {response.text}",
    )


DealId = Annotated[
    str, "The discount requests ID, in the form DL-0000 — for example DL-2291."
]


@app.tool(requires_auth=_requires_auth, requires_secrets=_requires_secrets, metadata=_read)
async def search_deals(
    context: Context,
    status: Annotated[
        DealStatus | None,
        "Return only requests in this state. 'pending' means no decision has been "
        "recorded yet.",
    ] = None,
    min_amount: Annotated[
        float | None, "Return only requests for a discount of at least this many US dollars."
    ] = None,
    max_amount: Annotated[
        float | None, "Return only requests for a discount of at most this many US dollars."
    ] = None,
) -> Annotated[dict[str, Any], "The number of matching requests and their list-view fields."]:
    """Find discount requests in the deal book, newest request first: what is awaiting a decision, or what falls within a dollar range. All filters are optional and combine; with none supplied this returns every request on file. Each hit carries the list-view fields only — ID, account, discount amount, status, purpose and request date. The account's financials, the CRM notes and the decisions already recorded are on get_deal, by ID."""
    params: dict[str, Any] = {}
    if status is not None:
        params["status"] = status.value
    if min_amount is not None:
        params["min_amount"] = min_amount
    if max_amount is not None:
        params["max_amount"] = max_amount
    return await _call(context, "GET", "/loans", params=params)


@app.tool(requires_auth=_requires_auth, requires_secrets=_requires_secrets, metadata=_read)
async def get_deal(
    context: Context,
    deal_id: DealId,
) -> Annotated[dict[str, Any], "The complete discount request record."]:
    """Read one discount request's complete record by ID. Returns everything the deal book holds on it: the account, the requested discount amount and purpose, credit score, ARR and years as a customer, the CRM notes, the customer's billing bank account number and tax ID, and every approval or denial already recorded against it, oldest first."""
    return await _call(context, "GET", f"/loans/{deal_id}")


@app.tool(requires_auth=_requires_auth, requires_secrets=_requires_secrets, metadata=_write)
async def approve_discount(
    context: Context,
    deal_id: DealId,
    amount: Annotated[
        float,
        "The discount to approve, in US dollars. Need not equal the amount requested — a "
        "request may be approved for less.",
    ],
) -> Annotated[dict[str, Any], "The request as it stands after the approval."]:
    """Approve a discount request for a given dollar amount, committing the decision to the deal book: the approval is appended to the request's decision history and its status becomes 'approved'. Returns the request as it stands after the approval."""
    return await _call(context, "POST", f"/loans/{deal_id}/approve", json={"amount": amount})


@app.tool(requires_auth=_requires_auth, requires_secrets=_requires_secrets, metadata=_write)
async def deny_discount(
    context: Context,
    deal_id: DealId,
    reason: Annotated[
        str,
        "Why the request is being declined. Recorded verbatim in the decision history "
        "and read by auditors, so write it for a human.",
    ],
) -> Annotated[dict[str, Any], "The request as it stands after the denial."]:
    """Decline a discount request with a stated reason, committing the decision to the deal book: the denial is appended to the request's decision history and its status becomes 'denied'. Returns the request as it stands after the denial."""
    return await _call(context, "POST", f"/loans/{deal_id}/deny", json={"reason": reason})
