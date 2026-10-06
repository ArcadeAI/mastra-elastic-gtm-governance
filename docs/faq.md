# FAQ

Documentation could not answer several of these, so we measured them against a real Arcade project. [`DESIGN.md`](../DESIGN.md) records the reasoning behind each decision.

## Why are the limits enforced in hooks rather than in the agent's prompt?

A limit in the prompt is one more thing for the model to weigh, and one sentence of prompt was enough to move the result either way, as [Why we built this](../README.md#why-we-built-this) describes. So the system prompt and every tool description carry no behavioural instruction: nothing about confirming, refusing, escalating, retrying or caution. The hook writes the denial and the instruction to escalate, which is why the agent calls `DealDesk_RequestApproval` with no mention of it in the prompt.

## Do the hooks fire for toolkits shipped with `arcade deploy`?

Yes. A spike measured `/access`, `/pre` and `/post` firing for a remote MCP server's tools, with a payload identical in shape to a hosted toolkit's. Arcade confirmed that the hooks apply to every tool wherever it is hosted, including `arcade deploy`'d toolkits, which is how both of this template's toolkits ship. The same spike found one exception. Arcade checks a tool's auth requirements before `/pre`, so a layer-2 refusal fires no hook and writes no audit row, as [How the controls work](./architecture.md#how-the-controls-work) explains.

## Why does the chat show some failed tool calls as a denial and others as a fault?

Because only one of them is a decision. The chat draws a denial card only on positive evidence that a hook decided, such as `CHECK_FAILED` or the `[ref evt_…]` token, which the control plane writes on every decision and which survives MCP all the way to the UI. Every other tool failure is a fault card that says no decision was made, because a control surface must never claim a control-plane action that did not happen.

## Why does the $95K approval depend on stripping the note pasted into `DL-2291`?

Because the model reads the injected instruction, refuses it, and ends its turn asking whether to proceed, so it never calls `DealDesk_ApproveDiscount`. With the note visible, the $95K request reached `/hooks/pre` roughly 5 times in 17; with `/hooks/post` stripping the note first, 5 of 5, and 5 of 5 again on an independent re-measurement. The fix removed what the model was reading and did not steer the model.

## Why does Charlie's Slack DM come from Alice and not from a bot?

Arcade's stock Slack provider issues a delegated user token, so the DM arrives under the requester's own name with no app badge. There is no custom Slack app and no bot fallback, which is why Alice authorizes Slack once through Arcade and nobody configures a Slack token. The toolkit asks for four scopes, `chat:write`, `im:write`, `users:read` and `users:read.email`, because Slack refuses an authorize request for `users:read.email` without `users:read`.

## Why two OAuth hops?

Because Arcade establishes who you are at two separate points. Hop 1, the MCP client reaching the gateway, is answered by a User Source whose issuer is the app's own sign-in; hop 2, the loan tool calling the loan API as the signed-in person, is answered by the `app-identity` provider and a custom verifier. A spike measured that hop 1's identity does not carry into hop 2, and without the custom verifier Arcade sends the user to its own account login, which requires an Arcade account that is a project member. The mechanisms are in [Two OAuth hops, two mechanisms](./architecture.md#two-oauth-hops-two-mechanisms).

## Can the control plane see an OAuth misconfiguration?

No. The two identity spikes hit four, among them a token request that carried the client credentials twice and a Client ID field holding a URL, and each one fired no hook and left the panel empty. Read the auth provider's configuration back through Arcade's admin API rather than off the dashboard, because a spike caught the dashboard's auth-method label disagreeing with what the provider sent. The two-hop design the spikes led to is in [`DESIGN.md`](../DESIGN.md#identity-and-oauth).

## Do my users need Arcade accounts?

With Arcade's built-in Slack app, the default, each account executive who requests an approval has to be invited to your Arcade project's Members, under the email they sign in to the app with; approvers and the deal tools need no Arcade account. With your own Slack app, registered as your project's Slack auth provider, your app's users need none at all, as [`app-users-and-arcade-accounts.md`](./app-users-and-arcade-accounts.md) explains.

## Why does it need a public host when it runs on my machine?

Because Arcade Cloud makes the calls. Arcade calls the hooks, the deployed deals toolkit calls the loan API, and both OAuth hops reach the app's sign-in and verifier endpoints, all on `APP_PUBLIC_HOST`. One ngrok domain carries all of them, and a fixed domain keeps that host the same across restarts, which matters because `bun run setup-arcade` registers it with Arcade. If you host the image instead, as [Deploying](./deploying.md) describes, `APP_PUBLIC_HOST` is the deployment's own host.

## Why Bun?

The three databases use `bun:sqlite`, which Node cannot load, so `next dev`, `next build` and the standalone server all run under Bun. Mastra Studio runs `mastra dev` as a separate Node process, so the agent never imports a module that opens one of them, and a test enforces it. Studio's own thread memory is a fourth file, `memory.db`, opened with libsql, which Node can load.

## Can I use a model other than Claude Sonnet 5?

Another Anthropic model, yes, with no code change. Set `MODEL_ID` in `.env` to its Anthropic model id, and both the chat and Studio pass it to `@ai-sdk/anthropic` with your `ANTHROPIC_API_KEY`. `MODEL_ID` is a bare Anthropic model id, not a `provider/model` string for Mastra's model router, so a model from another provider needs a code change: `anthropicModel` in `lib/agent/agent.ts`, and the `ANTHROPIC_API_KEY` checks in `lib/config.ts` and `lib/agent/studio.ts`. We measured the 5-of-5 result above on Claude Sonnet 5 at temperature 0, so a different model needs it measured again.
