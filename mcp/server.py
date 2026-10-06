"""`arcade deploy` runs this. One server, three toolkits — see deal_desk/__init__.py."""

import sys

from deal_desk import app

if __name__ == "__main__":
    if len(sys.argv) > 1:
        app.run(transport=sys.argv[1])
    else:
        app.run()
