import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { LibSQLStore } from "@mastra/libsql";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HooksClient, ServiceError } from "../lib/hooks-client";
import { resetSnapshots } from "../lib/snapshot-reset";
import { createRuntime } from "../lib/agent-runtime";
import { createWebApp } from "../lib/web-app";
import { scriptedModel } from "./helpers";

async function resetFixture() {
  const directory = mkdtempSync(join(tmpdir(), "workshop-reset-"));
  const path = join(directory, "snapshots.db");
  const storage = new LibSQLStore({ id: crypto.randomUUID(), url: `file:${path}` });
  await storage.init();
  const workflows = (await storage.getStore("workflows"))!;
  await workflows.persistWorkflowSnapshot({ workflowName: "agentic-loop", runId: "waiting-run", snapshot: {
    runId: "waiting-run", status: "suspended", value: {}, context: {}, serializedStepGraph: [], activePaths: [], activeStepsPath: {}, suspendedPaths: {}, resumeLabels: {}, waitingPaths: {}, timestamp: Date.now(),
  } });
  const operator = Bun.serve({ port: 0, fetch(request) {
    if (new URL(request.url).pathname !== "/operator/state" || request.headers.get("authorization") !== "Bearer operator-test") return new Response(null, { status: 403 });
    return Response.json({ active: false, active_run_count: 0, reset_epoch: 1 });
  } });
  return { path, storage, workflows, hooks: new HooksClient(`http://127.0.0.1:${operator.port}`, "operator-test"), async close() { operator.stop(true); await storage.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("native reset fails visibly when deletion makes no progress and can be retried", async () => {
  const fixture = await resetFixture();
  const fault = new Database(fixture.path);
  try {
    // An actual SQLite trigger makes the first DELETE succeed without removing
    // its row. A second DELETE fails, bounding the pre-fix regression as well.
    fault.exec(`CREATE TABLE reset_fault (attempts INTEGER NOT NULL);
      INSERT INTO reset_fault VALUES (0);
      CREATE TRIGGER ineffective_delete BEFORE DELETE ON mastra_workflow_snapshot BEGIN
        UPDATE reset_fault SET attempts = attempts + 1;
        SELECT CASE WHEN (SELECT attempts FROM reset_fault) > 1 THEN RAISE(ABORT, 'Repeated ineffective snapshot deletion') ELSE RAISE(IGNORE) END;
      END;`);
    const result = await resetSnapshots(fixture.storage, fixture.hooks, 1).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(ServiceError);
    expect((result as ServiceError).status).toBe(503);
    expect((result as Error).message).toContain("made no progress");
    expect((await fixture.workflows.listWorkflowRuns({ workflowName: "agentic-loop" })).runs.map((run) => run.runId)).toEqual(["waiting-run"]);
    fault.exec("DROP TRIGGER ineffective_delete");
    expect(await resetSnapshots(fixture.storage, fixture.hooks, 1)).toEqual({ deleted_snapshots: 1 });
    expect((await fixture.workflows.listWorkflowRuns({ workflowName: "agentic-loop" })).runs).toEqual([]);
  } finally { fault.close(); await fixture.close(); }
});

test("reset refuses a worker that starts while its request body is arriving", async () => {
  const fixture = await resetFixture();
  let started!: () => void, finish!: () => void;
  const modelStarted = new Promise<void>((resolve) => { started = resolve; });
  const modelMayFinish = new Promise<void>((resolve) => { finish = resolve; });
  const model = scriptedModel(["Supplied research complete."]);
  const runtime = createRuntime({ model: { ...model, async doGenerate(input: any) { started(); await modelMayFinish; return model.doGenerate(input); } } });
  const app = createWebApp({ runtime: () => runtime, hooks: () => fixture.hooks,
    session: () => { throw Error("Supplied research must not require identity"); }, arcadeKey: () => "unused",
    operatorToken: () => "operator-test", resetSnapshots: (epoch) => resetSnapshots(fixture.storage, fixture.hooks, epoch),
  });
  const headers = { authorization: "Bearer operator-test", "content-type": "application/json" };
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller; } });
  const reset = app.fetch(new Request("http://localhost/api/operator/reset", { method: "POST", headers, body: stream }));
  const research = app.fetch(new Request("http://localhost/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "supplied", message: "Research the supplied account" }) }));
  try {
    await modelStarted;
    body.enqueue(new TextEncoder().encode('{"reset_epoch":1}')); body.close();
    const refused = await reset;
    expect(refused.status).toBe(409);
    expect((await refused.json() as any).error).toContain("active web worker");
    expect((await fixture.workflows.listWorkflowRuns({ workflowName: "agentic-loop" })).runs.map((run) => run.runId)).toEqual(["waiting-run"]);
    finish();
    expect((await research).status).toBe(200);
    const retried = await app.fetch(new Request("http://localhost/api/operator/reset", { method: "POST", headers, body: '{"reset_epoch":1}' }));
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual({ reset: true, deleted_snapshots: 1 });
  } finally { finish(); await research; await reset; await fixture.close(); }
});
