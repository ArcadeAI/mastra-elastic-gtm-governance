"""One `arcade deploy`, one toolkit, every tool.

See `app.py` for the server and the name, and one file per tool family:
`deals.py`, `approvals.py` (with `approvals_message.py`, `approvals_routing.py`,
`approvals_slack.py`, `approvals_store.py`), `elasticsearch.py`. Importing this
package imports them, which is what registers their `@app.tool` functions.
"""

from __future__ import annotations

from deal_desk.app import app
from deal_desk import approvals as approvals  # noqa: F401  (registers its tools)
from deal_desk import deals as deals  # noqa: F401
from deal_desk import elasticsearch as elasticsearch  # noqa: F401

__all__ = ["app", "approvals", "deals", "elasticsearch"]
