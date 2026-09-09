import type { MastraCompositeStore } from "@mastra/core/storage";
import { HooksClient, ServiceError } from "./hooks-client";

/** Hooks invalidates continuations first; snapshots alone never authorize a write. */
export async function resetSnapshots(storage: MastraCompositeStore, operator: HooksClient, resetEpoch: number) {
  const state = await operator.request("/operator/state");
  if (state.active !== false || state.active_run_count !== 0 || state.reset_epoch !== resetEpoch || resetEpoch < 1) throw new ServiceError("Reset hooks first and provide its current reset_epoch; all workers must be idle.", 409);
  const workflows = await storage.getStore("workflows");
  if (!workflows) throw new ServiceError("Native snapshot storage is unavailable.", 503);
  const deleted = new Set<string>();
  for (;;) {
    const batch = await workflows.listWorkflowRuns({ workflowName: "agentic-loop", page: 0, perPage: 100 });
    if (!batch.runs.length) break;
    for (const run of batch.runs) {
      if (deleted.has(run.runId)) throw new ServiceError("Native snapshot reset made no progress. Resolve the storage failure and retry reset.", 503);
      await workflows.deleteWorkflowRunById({ workflowName: "agentic-loop", runId: run.runId });
      deleted.add(run.runId);
    }
  }
  return { deleted_snapshots: deleted.size };
}
