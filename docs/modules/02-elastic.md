# Module 2: Elastic, prepare the account evidence

**Owner:** Elastic presenter. **Budget:** 55 minutes, including signup and provisioning.

**Guide status:** the fixture now describes an at-risk renewal; record a current seed/read
result for this revision. Rehearse the fresh-account Elastic
setup and native MCP call against the current service before event delivery; record the
observed tool names and response in [Testing](../TESTING.md).

## Your result

Your own Elastic project contains the account evidence missing from the starter's answer.
Investigate the same question in Elastic: **“What puts Northwind's renewal at risk, and what should we verify before offering the requested 30% discount?”** Save the source event IDs and native answer. In the Arcade section,
your Mastra agent will retrieve those same events through Arcade. All runtime retrieval
uses the gateway so the same hooks can inspect the returned evidence.

## Build together

Follow the [Elastic setup and retrieval guide](../../elastic/README.md):

1. Sign up and start provisioning your Elasticsearch Serverless project. While it starts,
   explore the sample data with the presenter.
2. Create a narrowly scoped setup key, configure the local fixture loader, and run
   `bun run workshop seed --variant clean` from the repo root.
3. Find Northwind's four evidence events through native Elastic retrieval. Use the saved
   question from Module 1 and inspect the source IDs. Seats fell 220→140 and monthly
   sign-ins 85,000→42,000. The SCIM deprovisioning case is open; its relationship to the
   usage drop and resolution date are unverified. Distinguish those signals from renewal
   timing, the competitor quote and the buyer's stated budget. None grants a discount.
   Save the answer and at least two supporting event IDs for the integration comparison.
4. Run the native aggregation with the explicit fixture date window. The checked-in data
   is dated August 2026; a relative window on the event date would exclude it.
5. Create a separate read-only MCP credential and copy the Kibana MCP URL. Keep the setup
   write key available for the capstone's re-seed/reset exercise, then revoke it afterwards.

## Checkpoint and handoff

Verify eight fixture events across five accounts, successful native retrieval, and successful
native MCP inventory using the scoped credential. Your saved answer includes at
least two Northwind source event IDs for the same question asked in Module 1. Use the
[native MCP check](../../elastic/README.md#check-the-native-mcp-connection) and retain its
actual names for the next section; inventory alone does not prove a search call.

Keep the URL and key in your own configuration. Hand them to your own project in
[Module 3 — Arcade](03-arcade.md). That presenter owns storing the key in Arcade, registering
the remote server, selecting tools, and connecting the gateway to Mastra.

The Elastic section uses Elastic's native interface. Your Mastra agent does not connect
directly to Elasticsearch at this stage.

Use the clean synthetic baseline for this section and the first connection. The later
Arcade exercises introduce privacy and adversarial variants only after output filters are
active, then restore the baseline.

## If provisioning fails

A TA can provide the declared shared read-only fixture endpoint for the later integration.
This is a degraded path: you can retrieve and govern that data, but cannot re-seed it.
Record the limitation at capstone instead of counting the mutation exercise as passed.
