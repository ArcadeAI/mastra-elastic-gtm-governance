# Capstone: write and verify one output hook

**Owner:** Arcade with all partner TAs. **Budget:** 20 minutes.

Start with the completed Module 3 renewal run. Use 5 minutes to inspect it, 12 minutes
for the hook lab and gateway check, and 3 minutes to save evidence and reset. Earlier
workshop test counts do not certify this revision; record current results.

## Inspect the renewal journey

Northwind is `ACC-2291`; annual list price is $12,000, the requested discount is 30%, and
the approved draft is $8,400. Dana's ceiling is 15%; Riley's is 40%. Inspect:

- At least two Elastic source IDs covering declining usage and the unresolved SCIM issue.
  The agent must distinguish the open issue from an unverified cause of declining usage.
- Dana's denial, Riley's authenticated approval of the exact terms and `customer_message`,
  and continuation of Dana's original action with one operation receipt.
- `GetOffer` after creation, confirming the saved offer and exact follow-up email. The
  recipient comes from the account; the API appends canonical terms and the draft label.
- Absence of the fake pasted API key, synthetic personal phone and known fixture instruction
  from model-facing results. Legitimate prices and unresolved support details remain.

No customer email, signature request or real provisioning occurs. A delivered self-DM
alone does not establish approval or successful read-back.

## Write one output hook

The baseline already removes the pasted credential and personal phone. You will add a
rule that removes the internal support owner's email from **Sales.GetAccount** while
preserving the renewal date, issue and price. This changes output filtering, not the agent.

From the repository root:

```sh
bun run workshop hook-lab init --output .workshop/renewal-rule.json
bun run workshop hook-lab test --file .workshop/renewal-rule.json
```

Init writes an OutputRule with ID `renewal-contact-redaction`, scoped to Sales.GetAccount,
and an empty `fields` list. The first test should fail: the internal owner email remains.
Open the generated JSON in your editor. Retain its ID, match and other settings, and replace
the value of `fields` with:

```json
[{ "path": "support.internal_owner_email", "strategy": "remove" }]
```

Run the local test again:

```sh
bun run workshop hook-lab test --file .workshop/renewal-rule.json
```

**Local checkpoint:** the real filter removes the field and preserves the account, $12,000
list price, renewal date and unresolved support issue. A wrong path or lost context must
fail. This uses the local renewal fixture; it does not prove the deployed gateway uses
your rule and does not send a Slack message.

Apply the tested rule to your own hooks service:

```sh
bun run workshop hook-lab apply --file .workshop/renewal-rule.json
```

Apply uses `HOOKS_PUBLIC_HOST` and `WORKSHOP_OPERATOR_TOKEN`, validates the rule and updates
the current policy while preserving existing access, discount and privacy controls. A
failed test is not permission to apply. This is a policy change; it does not redeploy
services or create an approval request.
The rule affects subsequent GetAccount results. It does not rewrite the offer or follow-up
draft already saved in Module 3.

Verify the real connection using the exact GetAccount name from gateway discovery:

```sh
bun run workshop hook-lab verify --read-tool '<exact-observed-GetAccount-name>'
```

This calls the gateway as Dana using `PERSONA_DANA_EMAIL`. Complete Dana's Sales consent
if requested, then rerun. It is a read: no model, business write or Slack message.

**Gateway checkpoint:** the report identifies gateway-read proof, with the internal email
absent and the account's issue, renewal and commercial details intact. Save both the local
fixture and gateway reports. Neither a local pass nor an applied policy alone establishes
that this boundary worked. A configuration or consent failure stays incomplete.
Expect `status: "passed"`, `proof_scope: "gateway_read"`, and `connection_scope: "remote"`
for your hosted gateway. `live_proof: false` is intentional: this check proves the read,
not the complete approval workflow.

## Save evidence and reset

```sh
bun run capstone --run-id '<completed-run-id>' --output .workshop/evidence
```

This reads the existing renewal run. Keep the hook-lab reports alongside it. Missing or
independently unverified cloud evidence remains incomplete; `--live` does not turn service
records into independently verified cloud proof.

Close eligible failed, denied or expired waits first, then:

```sh
bun run reset --variant clean
```

Reset clears exercise offers, grants, native snapshots, lab policy and extra Elastic events,
while preserving both OAuth clients. Do not reset an executing worker. A partial reset is
incomplete. Reverify and activate before another governed exercise. Revoke the setup write
key after your optional exercises are complete.

## Optional extensions after the workshop

- In your own Kibana Dev Tools, add a ninth synthetic event that confirms the buyer's budget
  or changes the support update. Ask the saved question again in **Connect evidence** and
  compare the cited answer. That stage cannot change an offer. Use your setup key for the
  index write; the gateway key stays read-only. Reset removes the added event.
- Through the [operator policy API](../OPERATOR.md#inspect-edit-and-activate-policy), raise
  Dana's `clearance` to `30` for a fresh operation. Restore it to `15` and observe a fresh
  denial. A governed run can send another self-DM; a completed receipt is not evidence of
  a new permission decision.
- Check Sam's missing creation tool, rejected Dana self-approval, changed-message grant
  rejection and duplicate-operation replay. Preserve evidence before resetting.

Participants on shared read-only Elastic cannot claim the index-mutation exercise. Record
TA help, watched demonstrations and incomplete checks rather than counting them as solo
completion.
