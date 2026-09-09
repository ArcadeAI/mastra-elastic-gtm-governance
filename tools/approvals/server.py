"""Entrypoint for arcade deploy and local MCP clients."""

import sys

from approvals import app

if __name__ == "__main__":
    if len(sys.argv) > 1:
        app.run(transport=sys.argv[1])
    else:
        app.run()
