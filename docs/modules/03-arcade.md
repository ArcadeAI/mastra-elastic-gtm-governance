# Module 3: Arcade, connect and govern

**Owner:** Arcade presenter. **Budget:** 55 minutes, including signup and setup.

Keep the same Mastra agent and the Elastic evidence you prepared in Module 2. First
connect retrieval through Arcade. Then add Sales actions, protect them with hooks, and
complete the approval loop. [Operator setup](../OPERATOR.md) contains the exact deployment
sequence; [Testing](../TESTING.md) records the checkpoints and live rehearsal limits.

## Connect the evidence: 15 minutes

1. Sign up for Arcade and create your project. Keep its API key server-side.
2. Register Elastic's native Agent Builder endpoint as a Remote MCP server. Use the
   read-only MCP credential from Module 2 for an `Authorization: ApiKey ...` header stored
   as an Arcade secret. Keep the separate Elastic setup/write key out of this connection.
3. Create your gateway with the selected Elastic search tools. Set `ARCADE_API_KEY`,
   `ARCADE_GATEWAY_ID`, and `PERSONA_DANA_EMAIL` in `.env`. Dana's email is your real Arcade
   account email. Run:

   ```sh
   bun run discover
   bun run discover --elastic-tools '<exact-name>,<exact-name>' --output .workshop/discovery.json
   bun run doctor --stage elastic
   ```

   Copy `configuration.ARCADE_ELASTIC_TOOL_NAMES` from the discovery file into `.env` and
   restart the local web process so it reads the settings. Use names actually returned by
   the gateway. Hook identities are configured separately during the next step.
4. Select **Connect evidence** and **Run your agent** with the saved Northwind question.
   Compare at least two source IDs with your Module 2 notes and inspect the tool trace.

**Checkpoint:** the same agent cites real Elastic results through Arcade. If tools appear
in Arcade's server catalog but are absent from the gateway, inspect the access hook's
observed tools and `ARCADE_ELASTIC_HOOK_TOOLS` configuration. Unknown tools are hidden by
our policy. Configure only the observed read tools and redeploy hooks before retrying.
Never bypass the gateway to make this checkpoint pass. Keep the fixture clean until
the governed setup is verified. The Elastic presenter does not configure Arcade, and
you do not deploy an Elastic toolkit.

## Add one custom toolkit and its controls: 20 minutes

Follow [Operator setup](../OPERATOR.md) in order:

1. Fork the repository and provision the four supporting web, hooks, account, and IdP services
   in your Render account. Commit your Module 1 agent edits first. Record actual URLs,
   configure the web OAuth client, update the private operator `.env`, and open the hosted
   web URL for the remaining governed exercise.
2. Register the demo IdP and its authenticated custom verifier with Arcade.
3. Deploy **Sales** once from `tools/lead`. Python is needed for this toolkit. The app and
   hooks handle approvals; there is no second custom approval-toolkit deployment.
4. Add Sales to the same gateway under the staged policy. Configure the access, pre, and
   post hook URLs, their bearer secret, and fail-closed settings. Follow Operator setup's
   `hook-tools` sequence: observe actual access names, configure/redeploy hooks, perform a
   clean Elastic read, then record its argument keys and redeploy the completed mapping.
5. Follow the [verification identity setup](../OPERATOR.md#5-verify-governance-before-running-the-action),
   then run `bun run discover --identity verification`. Copy the observed CreateDiscountedOffer
   and GetOffer names into `ARCADE_DISCOUNT_TOOL_NAME` and `ARCADE_GET_OFFER_TOOL_NAME`
   locally and on their hosted owners, following Operator setup. Run
   `bun run workshop verify-governance --read-tool '<exact-observed-GetAccount-name>'`.
   After both checks pass, run `bun run workshop activate`, rediscover attendee tools, run
   `bun run doctor --stage governed`, and load `bun run workshop seed --variant governed`.
6. Join the workshop Slack workspace with your Slack account. The app prompts for delegated
   Slack consent during the approval exercise below and uses it to deliver your self-DM.
   Use the supplied demo login credentials for Dana and Riley when prompted.

**Checkpoint:** the discovered Sales tools and current policy match your configured gateway;
privacy and discount-permission probes have passed. `/health` alone does not establish this.

The one custom deployment is Sales. Elastic is a Remote MCP connection, Slack authorization
is provided through Arcade, and approvals belong to the workshop app and hooks. Supporting
Render services, Elastic, and model usage have their own hosting or usage requirements.

## Complete one approval: 15 minutes

**This step can send a real Slack self-DM.** Selecting **Run your agent** in the governed
stage permits the app to request approval automatically after a blocked action. The message
arrives before anyone clicks **Approve exact action**.

1. Select **Act with approval** and **Sign in as dana**. Use the default prompt to research
   `ACC-2291` and prepare the requested 30% renewal discount offer at the stored $12,000
   annual list price. Ask for a customer follow-up that acknowledges the usage decline and
   open SCIM case, identifies what needs checking, and makes no unconfirmed resolution
   promise. The agent supplies this as `customer_message`; the offer and email stay drafts.
2. Inspect the trace: cited Elastic evidence, the $12,000 account list price, and Arcade's
   denial because Dana's discount permission is 15%. Riley can approve up to 40%. No offer
   has been saved yet.
3. The app creates Riley's approval request and sends it to your authorized Slack self-DM.
   If consent is needed, remain signed in as Dana, open **Authorize with Arcade**, complete
   Slack consent, then return and select **Retry Slack notification**. Confirm the saved
   request shows `Slack: sent` before switching to Riley.
4. Open the request while signed in as Dana and observe that Dana cannot self-approve.
   Select **Sign in as riley**, authenticate, and review the exact discount, rationale and
   customer message. Editing that message would require a new action and approval.
5. Select **Approve exact action**. The authenticated page records Riley's decision with
   hooks. Dana's saved Mastra run resumes and retries the original action through Arcade.
   **Resume Dana's agent** retries that continuation if needed.

6. The agent calls **GetOffer** to check the saved result: 30% discount, $12,000 list price,
   $8,400 net price and `draft` status. Inspect the saved follow-up: its evidence-grounded
   text matches the approved message, with the API-owned recipient, canonical terms and
   draft label. The fake pasted API key and phone must not reach the model. No email is sent.
   Missing or mismatched read-back reports that the draft was saved but verification failed;
   it cannot count as a completed exercise and is not a reason to create another offer.

**Checkpoint:** one saved draft offer, the original requester and arguments, a successful
read-back, and at least two Elastic citations. Slack delivery and human approval are separate events;
receiving the link does not grant Riley's authority.

## Inspect and hand off: 5 minutes

Check the audit and model-facing output. The fake pasted API key, personal phone and seeded
instruction should be absent, while prices, renewal date and unresolved issue remain.
Switch to Sam and inspect tool discovery; CreateDiscountedOffer should be absent. Save the
run ID for the [capstone hook lab](04-capstone.md), where you add and verify removal of
`support.internal_owner_email` without changing the agent.

The four segments total **55 minutes**. Fresh-account setup and onsite/remote timing still
need measurement. Use a declared fallback if someone cannot finish provisioning; do not
report a watched presenter step as an attendee-owned completion.

References: [Arcade Remote MCP servers](https://docs.arcade.dev/en/operate/governance/remote-mcp-servers),
[authenticated user verification](https://docs.arcade.dev/en/build/user-facing-agents/secure-auth-production).
