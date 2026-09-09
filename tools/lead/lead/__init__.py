"""The Lead Agent toolkit: four stateless clients of `apps/lead-app`.

The tools implement the inbound workflow Drew Bredvick describes: discover
new submissions, inspect a lead before changing it, route qualified
opportunities to an owner, and classify submissions that should not be routed.

Every call forwards the caller's OAuth token to the lead API. The API resolves
the actor from that token; no tool accepts an actor as input. The toolkit holds
no business state and does not make decisions on the API's behalf.
"""

import re
from enum import Enum
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
    "LeadDisposition",
    "LeadStatus",
    "app",
    "classify_lead",
    "get_lead",
    "route_lead",
    "search_leads",
]

app = MCPApp(
    name="lead",
    version="1.0.0",
    instructions=(
        "Inbound Lead Agent workflow based on Drew Bredvick's flow. Lead records use IDs "
        "like LD-0000. Discover submissions with search_leads, inspect a selected record "
        "with get_lead, route qualified opportunities with route_lead, and classify "
        "non-qualified submissions with classify_lead."
    ),
)

# The Arcade auth provider for `apps/idp`. These scopes let the API identify
# the caller through `/oauth2/userinfo`; the token is forwarded unchanged.
IDP_PROVIDER_ID = "cg-idp"
IDP_SCOPES = ["openid", "email"]

# HOST-form, consistent with the other service addresses in this repository.
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
    ),
)
_write = ToolMetadata(
    behavior=Behavior(
        operations=[Operation.UPDATE],
        read_only=False,
        destructive=False,
        idempotent=True,
        open_world=False,
    ),
)


class LeadStatus(str, Enum):
    NEW = "new"
    QUALIFIED = "qualified"
    FOLLOW_UP = "follow_up"
    SUPPORT = "support"
    NOT_SALES_RELATED = "not_sales_related"


class LeadDisposition(str, Enum):
    FOLLOW_UP = "follow_up"
    SUPPORT = "support"
    NOT_SALES_RELATED = "not_sales_related"


def _base_url(host: str) -> str:
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
    """Call the lead API on behalf of the user represented by the token."""
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
                "The inbound lead system could not be reached.",
                developer_message=f"{method} {url}: {exc!r}",
            ) from exc

    if response.is_success:
        try:
            payload = response.json()
        except ValueError as exc:
            raise ToolExecutionError(
                "The inbound lead system returned an invalid response.",
                developer_message=f"{method} {url} returned non-JSON: {response.text}",
            ) from exc
        if not isinstance(payload, dict):
            raise ToolExecutionError(
                "The inbound lead system returned an invalid response.",
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


LeadId = Annotated[
    str,
    "The inbound lead ID in the form LD-0000 — for example LD-2291.",
]


def _lead_path(lead_id: str) -> str:
    return f"/leads/{quote(lead_id, safe='')}"


@app.tool(  # type: ignore[arg-type]  # arcade-mcp-server's decorator resolves its callable to Never
    requires_auth=_requires_auth,
    requires_secrets=_requires_secrets,
    metadata=_read,
)
async def search_leads(
    context: Context,
    status: Annotated[
        LeadStatus | None,
        "Return only leads in this state. Use 'new' to discover unprocessed inbound "
        "submissions.",
    ] = None,
    min_estimated_acv: Annotated[
        float | None,
        "Return only leads whose estimated annual contract value is at least this many "
        "US dollars.",
    ] = None,
    max_estimated_acv: Annotated[
        float | None,
        "Return only leads whose estimated annual contract value is at most this many "
        "US dollars.",
    ] = None,
) -> Annotated[dict[str, Any], "The matching count and lead summary records."]:
    """Discover inbound leads, newest submission first. This is the first step in Drew Bredvick's Lead Agent flow when no lead ID is already known. All filters are optional and combine. Each result includes only the summary fields: lead ID, company, contact, estimated ACV, status, source, and submission time. Select a result and call get_lead before deciding whether to route or classify it."""
    params: dict[str, Any] = {}
    if status is not None:
        params["status"] = status.value
    if min_estimated_acv is not None:
        params["min_estimated_acv"] = min_estimated_acv
    if max_estimated_acv is not None:
        params["max_estimated_acv"] = max_estimated_acv
    return await _call(context, "GET", "/leads", params=params)


@app.tool(  # type: ignore[arg-type]  # arcade-mcp-server's decorator resolves its callable to Never
    requires_auth=_requires_auth,
    requires_secrets=_requires_secrets,
    metadata=_read,
)
async def get_lead(
    context: Context,
    lead_id: LeadId,
) -> Annotated[dict[str, Any], "The complete inbound lead record."]:
    """Inspect one inbound lead in full by ID. Returns contact and company details, the submitted phone and form message, estimated ACV, current status and owner, and every prior routing or classification decision. In the Lead Agent flow, always inspect the complete record before calling route_lead or classify_lead."""
    return await _call(context, "GET", _lead_path(lead_id))


@app.tool(  # type: ignore[arg-type]  # arcade-mcp-server's decorator resolves its callable to Never
    requires_auth=_requires_auth,
    requires_secrets=_requires_secrets,
    metadata=_write,
)
async def route_lead(
    context: Context,
    lead_id: LeadId,
    operation_key: Annotated[
        str,
        "The stable operation key for this write. Reuse it unchanged for retries; "
        "a different action needs a new key. 1–128 ASCII letters, digits, dots, "
        "underscores, colons, or hyphens.",
    ],
    estimated_acv: Annotated[
        float,
        "The current stored annual contract value in US dollars, copied exactly from get_lead. This asserts the value; it cannot update it.",
    ],
    owner_email: Annotated[
        str,
        "The email address of the sales owner who should receive the qualified lead.",
    ],
    rationale: Annotated[
        str,
        "Why the lead is qualified and routed to this owner. Stored verbatim in decision "
        "history, so write it for a human reader.",
    ],
) -> Annotated[dict[str, Any], "The lead after the route is committed."]:
    """Route a qualified inbound lead to a sales owner. This commits a system-of-record write: it verifies the asserted ACV matches the stored value, sets status to 'qualified', assigns the owner, and appends the rationale and caller identity to decision history. It is not a draft or recommendation. Repeating the same operation_key and arguments returns the original result without another decision; changed arguments conflict. Use it only after inspecting the lead with get_lead."""
    return await _call(
        context,
        "POST",
        f"{_lead_path(lead_id)}/route",
        operation_key=operation_key,
        json={
            "estimated_acv": estimated_acv,
            "owner_email": owner_email,
            "rationale": rationale,
        },
    )


@app.tool(  # type: ignore[arg-type]  # arcade-mcp-server's decorator resolves its callable to Never
    requires_auth=_requires_auth,
    requires_secrets=_requires_secrets,
    metadata=_write,
)
async def classify_lead(
    context: Context,
    lead_id: LeadId,
    operation_key: Annotated[
        str,
        "The stable operation key for this write. Reuse it unchanged for retries; "
        "a different action needs a new key. 1–128 ASCII letters, digits, dots, "
        "underscores, colons, or hyphens.",
    ],
    disposition: Annotated[
        LeadDisposition,
        "How to handle a lead that is not being routed: 'follow_up', 'support', or "
        "'not_sales_related'.",
    ],
    rationale: Annotated[
        str,
        "Why this disposition fits the submission. Stored verbatim in decision history, "
        "so write it for a human reader.",
    ],
) -> Annotated[dict[str, Any], "The lead after the classification is committed."]:
    """Classify an inbound submission that should not be routed now. This commits a system-of-record write: it sets status to the selected disposition and appends the rationale and caller identity to decision history. It is not a draft or recommendation. Repeating the same operation_key and arguments returns the original result without another decision; changed arguments conflict. Use it only after inspecting the lead with get_lead."""
    return await _call(
        context,
        "POST",
        f"{_lead_path(lead_id)}/classify",
        operation_key=operation_key,
        json={"disposition": disposition.value, "rationale": rationale},
    )
