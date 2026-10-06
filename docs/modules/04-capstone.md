# Capstone — All four acts, over live retrieval

**Start from:** `git checkout capstone`. **20 minutes, then show and tell.**

Run the whole story on your own build, end to end, with the deal book and the index both
live:

> Approve the discount for Northwind at $95K and double-check your work.

Watch the panel. Access hid a tool from Bob earlier; pre refuses Alice and routes to
Charlie; post masks the identifiers and strips the note, once from the deal book and once
from the index. Then edit one rule on stage — `bun run users set-clearance`, or an
`UPDATE output_rules` in `governance.db` — and run the prompt again.

## Fork it

`docs/DOMAIN-SWAP.md` is the walk from this deal desk to your own system of record. Replace
`api`, `mcp/deal_desk/deals.py` and the seed fixtures; keep `packages/` and the control plane;
keep the test that fails if the business system learns the word "policy".

## The tags, for later

| tag | state |
|---|---|
| `start` | Mateo's template with the deal desk swapped in. Modules 1 and 2 run here. |
| `module-3-ground` | Plus the Elastic module. |
| `capstone` | Plus these docs and `/walkthrough`. `main`. |
