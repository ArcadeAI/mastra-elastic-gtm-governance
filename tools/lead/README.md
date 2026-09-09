# tools/lead

The inbound Lead Agent toolkit provides four tools:

- `search_leads` discovers inbound submissions using optional status and
  estimated-ACV filters.
- `get_lead` inspects one complete record before any change is made.
- `route_lead` routes a qualified lead to a sales owner and records the
  stored estimate and rationale. The supplied estimate must match the current record.
- `classify_lead` records `follow_up`, `support`, or `not_sales_related` for a
  submission that should not be routed.

Each tool is a stateless client of
[`apps/lead-app`](../../apps/lead-app), the inbound system of record. The two
write tools commit changes immediately; they do not create drafts or
recommendations.

## Identity

Every tool requires OAuth against `apps/idp`, registered in Arcade as
`cg-idp`. The toolkit forwards the caller's token to the API as a bearer token,
and the API resolves the actor through `/oauth2/userinfo`. No tool accepts an
actor as an argument.

The toolkit remains stateless: authentication identifies the caller, the lead
API owns all business data, and surrounding hooks own governance.

## Configuration

Set `LEAD_APP_PUBLIC_HOST` to the HOST-form address of `apps/lead-app`, without
a scheme. Local hosts use HTTP; other hosts use HTTPS. `arcade deploy` uploads
the value as an Arcade secret.

## Run and test

```sh
uv sync --extra dev
uv run --extra dev python -m pytest
uv run server.py http
```

The test suite boots the real `apps/lead-app` under Bun with a temporary
`leads.db` and a stand-in `/oauth2/userinfo` endpoint. It exercises all four
tools through HTTP, including OAuth token forwarding and raw detail-field
preservation.

## Deploy

```sh
arcade deploy
```

`MCPApp(name="lead")` gives the deployed toolkit the normalized name `Lead`.
The four Arcade tool names are `SearchLeads`, `GetLead`, `RouteLead`, and
`ClassifyLead`.


## Write retries

Both `route_lead` and `classify_lead` require `operation_key`, an opaque string of
1–128 ASCII letters, digits, dots, underscores, colons, or hyphens. The agent host
creates it once for a proposed action and retains it across approval and retries.
The toolkit forwards it as the `Idempotency-Key` HTTP header.

The same key with the same actor, action, lead, and arguments returns the saved
original result without another decision. Changing any of those fields conflicts.
A distinct action needs a new key. `estimated_acv` asserts the stored amount;
it never changes the lead's estimate. The API rejects an inconsistent amount.

The service still returns complete raw Lead records, including successful write
results. The surrounding Arcade post-hook filters them before the model receives
them. Internal service credentials are not toolkit requirements.
