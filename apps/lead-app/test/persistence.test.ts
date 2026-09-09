import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDiscountedOffer, getAccount, getOperation, openSalesStore } from "../src/db";

const action = { operation_key:"persisted-offer",actor:"dana@example.test",account_id:"ACC-2291",body:{discount_percent:30,list_price:12000,rationale:"Annual account renewal."} };

test("draft storage failure rolls the entire offer transaction back", () => {
  const db = openSalesStore(":memory:");
  try {
    db.exec("CREATE TRIGGER fail_draft BEFORE INSERT ON sales_email_drafts BEGIN SELECT RAISE(ABORT,'draft disk fault'); END;");
    expect(() => createDiscountedOffer(db,action)).toThrow("draft disk fault");
    expect(getAccount(db,"ACC-2291")).toMatchObject({offer:null,decisions:[]});
    expect(getOperation(db,action.operation_key)).toBeNull();
    db.exec("DROP TRIGGER fail_draft");
    expect(createDiscountedOffer(db,action)?.offer.net_price).toBe(8400);
    for (const table of ["sales_offers","sales_email_drafts","sales_decisions","sales_operations"]) expect(db.query<{n:number},[]>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n).toBe(1);
  } finally { db.close(); }
});

test("an existing deployment disk preserves its earlier records and saves new sales drafts", () => {
  const directory = mkdtempSync(join(tmpdir(),"sales-migration-")); const path=join(directory,"business.db");
  const legacy=new Database(path); legacy.exec("CREATE TABLE leads(lead_id TEXT PRIMARY KEY); INSERT INTO leads VALUES('LD-historical');"); legacy.close();
  const db=openSalesStore(path);
  try {
    expect(db.query("SELECT lead_id FROM leads").all()).toEqual([{lead_id:"LD-historical"}]);
    expect(getAccount(db,"ACC-2291")?.offer).toBeNull();
    createDiscountedOffer(db,action);
  } finally { db.close(); }
  const reopened=openSalesStore(path);
  try {
    expect(createDiscountedOffer(reopened,action)?.replayed).toBe(true);
    expect(getAccount(reopened,"ACC-2291")?.decisions).toHaveLength(1);
    expect(reopened.query("SELECT lead_id FROM leads").all()).toEqual([{lead_id:"LD-historical"}]);
    expect(reopened.query<{n:number},[]>("SELECT COUNT(*) AS n FROM sales_email_drafts").get()?.n).toBe(1);
  } finally { reopened.close(); rmSync(directory,{recursive:true,force:true}); }
});

test("saved offer and email draft replay once after a separate business process restart", async () => {
  const directory=mkdtempSync(join(tmpdir(),"sales-process-"));
  const idp=Bun.serve({port:0,fetch:request=>request.headers.get("authorization")==="Bearer local-token"?Response.json({email:action.actor}):new Response(null,{status:401})});
  async function start() {
    const probe=Bun.serve({port:0,fetch:()=>new Response()}); const port=probe.port;probe.stop(true);
    const child=Bun.spawn([process.execPath,join(import.meta.dir,"../src/index.ts")],{env:{...process.env,PORT:String(port),LEADS_DB_PATH:join(directory,"business.db"),IDP_PUBLIC_HOST:`http://127.0.0.1:${idp.port}`},stdout:"ignore",stderr:"pipe"});
    const origin=`http://127.0.0.1:${port}`; const end=Date.now()+10000;
    for (;;) { try {if((await fetch(`${origin}/health`)).ok)return{child,origin};}catch{/* Bounded startup polling. */}
      if(child.exitCode!==null||Date.now()>end){child.kill();throw new Error(await new Response(child.stderr).text());} await Bun.sleep(20);
    }
  }
  const send=(origin:string)=>fetch(`${origin}/accounts/ACC-2291/offers`,{method:"POST",headers:{authorization:"Bearer local-token","content-type":"application/json","Idempotency-Key":action.operation_key},body:JSON.stringify(action.body)});
  let running:Awaited<ReturnType<typeof start>>|undefined;
  try {
    running=await start(); const first=await send(running.origin);expect(first.status).toBe(200);const saved=await first.json();
    running.child.kill();await running.child.exited;running=await start();
    const replay=await send(running.origin);expect(replay.headers.get("Idempotency-Replayed")).toBe("true");expect(await replay.json()).toEqual(saved);
    const db=new Database(join(directory,"business.db"),{readonly:true});
    try {for(const table of ["sales_offers","sales_email_drafts","sales_decisions"])expect(db.query<{n:number},[]>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n).toBe(1);}finally{db.close();}
  } finally {if(running){running.child.kill();await running.child.exited;}idp.stop(true);rmSync(directory,{recursive:true,force:true});}
});
