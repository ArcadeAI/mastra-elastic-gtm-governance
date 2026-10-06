"""The one server, and the one toolkit.

`MCPApp(name="deal_desk")` is what `arcade deploy` reads off `initialize` and files the
deployment as, and `deal_desk` PascalCased — `DealDesk` — is the toolkit name Arcade
prefixes every tool with: `DealDesk_SearchDeals`, `DealDesk_RequestApproval`,
`DealDesk_SemanticSearch`. `ARCADE_TOOLKIT` in `.env` and the `$TOOLKIT` placeholder in
`governance.json` both mean this name, so a rule keyed on `DealDesk.ApproveDiscount`
matches the call the gateway makes.

The tools live one file each next to this one — `deals.py`, `approvals.py` and its
helpers, `elasticsearch.py` — and each does `from deal_desk.app import app` and
decorates with `@app.tool`. Importing `deal_desk` (`__init__.py`) imports them all, so
`server.py` has every tool registered before `app.run()`.

The name is underscores only, per MCPApp: a hyphen is rejected at construction, and a
hyphenated toolkit could not form a parseable Arcade tool name anyway (measured in spike #2).
"""

from __future__ import annotations

from arcade_mcp_server import MCPApp

app = MCPApp(
    name="deal_desk",
    version="1.0.0",
    instructions=(
        "Deal desk for a B2B software company. Discount requests are identified by IDs of "
        "the form DL-0000: search_deals finds requests, get_deal reads one in full, "
        "approve_discount and deny_discount record a decision on one. request_approval "
        "records a request for one person's approval of an action and notifies the "
        "approver it routes to; decide records that person's answer. The Elasticsearch "
        "tools list indices and read mappings; search by keyword, by meaning (semantic_text), "
        "by vector or both at once (hybrid); aggregate; count; fetch a document; run ES|QL; "
        "and write, update or delete documents and indices."
    ),
)

__all__ = ["app"]
