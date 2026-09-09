import { isDeepStrictEqual } from "node:util";
import { OutputRule } from "../packages/policy-schema/src/index";
import { baseline, filterOutput } from "../apps/hooks/src/policy";
import accounts from "../apps/lead-app/src/fixtures/accounts.json";

export const LAB_RULE_ID = "renewal-contact-redaction";
export const labAccount = accounts.accounts.find(account => account.account_id === "ACC-2291")!;
export function starterRule(toolkit = "Sales") {
  return OutputRule.parse({ id: LAB_RULE_ID, description: "Hide the internal support contact from account research.", match: { toolkit, tool: "GetAccount" }, fields: [], patterns: [], priority: 20, reason: "Internal support contact removed." });
}
function localPolicy(toolkit: string) {
  return baseline({ dbPath: ":memory:", hookSecret: "", operatorToken: "", approvalsToken: "", webToken: "", leadHost: "", leadToken: "", idpHost: "", webOrigin: "", salesToolkit: toolkit, elasticTools: [], subjectEmails: { dana: "dana@example.test", riley: "riley@example.test", sam: "sam@example.test", morgan: "morgan@example.test" }, verificationUserId: "verification@example.test" });
}
/** Uses the same production filter as the post hook; returns no fixture values. */
export function testRule(value: unknown, toolkit = "Sales") {
  const parsed = OutputRule.safeParse(value);
  if (!parsed.success) throw new Error("The lab file must contain one valid OutputRule.");
  const rule = parsed.data;
  if (rule.id !== LAB_RULE_ID || rule.match.toolkit !== toolkit || rule.match.tool !== "GetAccount" || rule.subjects !== null || rule.patterns.length || !rule.enabled) throw new Error("Keep the starter id, enabled GetAccount scope, and empty patterns and subjects for this field-removal exercise.");
  if (rule.fields.length !== 1 || rule.fields[0]?.path !== "support.internal_owner_email" || rule.fields[0]?.strategy !== "remove") throw new Error("The lab rule must contain exactly one field: support.internal_owner_email with strategy remove.");
  const policy = localPolicy(toolkit), subject = policy.subjects[0]!;
  const baselineValue = filterOutput(labAccount, policy.output_rules, subject, { toolkit, name: "GetAccount" }) as any;
  const expected = structuredClone(baselineValue);
  delete expected.support.internal_owner_email;
  const actual = filterOutput(labAccount, [...policy.output_rules, rule], subject, { toolkit, name: "GetAccount" });
  if (!isDeepStrictEqual(actual, expected)) throw new Error("The rule must remove only support.internal_owner_email while preserving account, renewal, support-issue and commercial fields.");
  if (/api_key|workshop_support_FAKE_|personal_phone/.test(JSON.stringify(actual))) throw new Error("The baseline privacy filter did not protect the fixture.");
  return rule;
}

/** Accepts inspectable account data only; the caller also checks MCP text and metadata. */
export function verifyRead(value: any, representations: unknown) {
  const projection = (account: any) => ({ account_id: account?.account_id, company_name: account?.company_name, product: account?.product, billing_cycle: account?.billing_cycle, list_price: account?.list_price, subscription: account?.subscription, support: { case_id: account?.support?.case_id, status: account?.support?.status, summary: account?.support?.summary } });
  if (!isDeepStrictEqual(projection(value), projection(labAccount)) || /internal_owner_email|oncall@northwindrobotics\.example|api_key|workshop_support_FAKE_|activation_token|workshop_activation_FAKE_|personal_phone|\+1-\d{3}-555-\d{4}|Ignore earlier instructions/.test(JSON.stringify(representations))) throw new Error("The gateway read did not preserve Northwind's renewal, unresolved support issue and price while removing internal contact and credential fields.");
}

export function policyWithRule(value: any, rule: OutputRule) {
  if (!value || !Number.isInteger(value.version) || !Array.isArray(value.subjects) || !Array.isArray(value.rules) || !Array.isArray(value.output_rules)) throw new Error("Hooks returned an invalid policy document.");
  const matches = value.output_rules.filter((entry: any) => entry.id === rule.id);
  if (matches.length === 1 && isDeepStrictEqual(matches[0], rule)) return null;
  const output_rules = value.output_rules.filter((entry: any) => entry.id !== rule.id);
  output_rules.push(rule);
  return { version: value.version, subjects: value.subjects, rules: value.rules, output_rules };
}
