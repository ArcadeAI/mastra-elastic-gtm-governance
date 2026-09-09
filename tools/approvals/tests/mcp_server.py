"""Real MCP server with only its outbound Slack network address redirected."""

import os
from urllib.parse import urlsplit

from approvals import create_app

slack_url = os.environ["TEST_SLACK_URL"]
if urlsplit(slack_url).hostname not in {"localhost", "127.0.0.1", "::1"}:
    raise ValueError("Transport tests require a local Slack stand-in.")
create_app(slack_api_base_url=slack_url).run()
