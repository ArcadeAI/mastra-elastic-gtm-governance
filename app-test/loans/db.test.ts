/**
 * The deal book itself: seeding, filtering, and the decision history.
 */
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Database } from "bun:sqlite";

import type { LoanSeed } from "../../lib/loans/db.ts";
import {
  countLoans,
  getLoan,
  openLoanBook,
  recordDecision,
  searchLoans,
  seed,
} from "../../lib/loans/db.ts";

const ONE_LOAN: LoanSeed = {
  deal_id: "DL-9001",
  account_name: "Placeholder Co",
  amount: 1_000,
  status: "pending",
  purpose: "Working capital",
  requested_at: "2026-01-01",
  credit_score: 700,
  arr: 100_000,
  years_as_customer: 1,
  bank_account_number: "0000000000000000",
  tax_id: "00-0000000",
  crm_notes: "None.",
  decisions: [],
};

function freshBook() {
  return openLoanBook(":memory:");
}

describe("seeding", () => {
  test("bootstraps the fixture into an empty database", () => {
    const db = freshBook();

    expect(countLoans(db)).toBeGreaterThan(1);
    expect(getLoan(db, "DL-2291")).not.toBeNull();
  });

  test("seeds DL-2291 with the fields the demo turns on", () => {
    const loan = getLoan(freshBook(), "DL-2291");

    expect(loan).toMatchObject({
      deal_id: "DL-2291",
      account_name: "Northwind Robotics",
      amount: 95_000,
      status: "pending",
    });

    // Act 3 redacts these downstream; the deal book must actually hand them out.
    expect(loan?.bank_account_number).toMatch(/^\d{16}$/);
    expect(loan?.tax_id).toMatch(/^\d{2}-\d{7}$/);

    // Act 4 strips this downstream. It has to be there to be stripped.
    expect(loan?.crm_notes).toMatch(/approve_discount/);
  });

  test("a seed that fails leaves no schema, so the next boot retries", () => {
    // The scenario: a forker duplicates a loan in loans.json. It passes the
    // zod schema and violates the primary key. If the schema were created
    // outside the seed transaction, the tables would survive the failed
    // inserts, `hasSchema` would report the database as already seeded, and
    // every later boot would come up green with zero loans — permanently, on
    // a disk that persists.
    const db = new Database(":memory:");

    expect(() => seed(db, [ONE_LOAN, ONE_LOAN])).toThrow(/UNIQUE/);
    expect(() => countLoans(db)).toThrow(/no such table/);

    // And the retry works once the fixture is fixed.
    seed(db, [ONE_LOAN]);
    expect(countLoans(db)).toBe(1);
  });

  test("leaves an existing database alone — later boots are not a reset", () => {
    const path = join(tmpdir(), `cg-loans-${crypto.randomUUID()}`, "loans.db");

    const first = openLoanBook(path);
    recordDecision(first, {
      deal_id: "DL-2291",
      decision: "approved",
      amount: 95_000,
      reason: null,
    });
    first.close();

    const second = openLoanBook(path);
    const loan = getLoan(second, "DL-2291");
    second.close();
    rmSync(dirname(path), { recursive: true, force: true });

    expect(loan?.status).toBe("approved");
    expect(loan?.decisions).toHaveLength(1);
  });
});

describe("searchLoans", () => {
  test("returns every loan when no filter is given", () => {
    const db = freshBook();
    expect(searchLoans(db, {})).toHaveLength(countLoans(db));
  });

  test("filters by status", () => {
    const results = searchLoans(freshBook(), { status: "approved" });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((loan) => loan.status === "approved")).toBe(true);
  });

  test("filters by amount range, inclusive at both ends", () => {
    const results = searchLoans(freshBook(), { min_amount: 95_000, max_amount: 95_000 });

    expect(results.map((loan) => loan.deal_id)).toEqual(["DL-2291"]);
  });

  test("combines filters", () => {
    const results = searchLoans(freshBook(), { status: "pending", min_amount: 90_000 });

    expect(results.map((loan) => loan.deal_id).sort()).toEqual(["DL-2290", "DL-2291", "DL-2295"]);
  });

  test("returns list-view fields only — the detail view is get_deal", () => {
    const [first] = searchLoans(freshBook(), { status: "pending" });

    expect(Object.keys(first ?? {}).sort()).toEqual([
      "account_name",
      "amount",
      "deal_id",
      "purpose",
      "requested_at",
      "status",
    ]);
  });

  test("is newest submission first", () => {
    const dates = searchLoans(freshBook(), {}).map((loan) => loan.requested_at);

    expect(dates).toEqual([...dates].sort().reverse());
  });
});

describe("recordDecision", () => {
  test("appends the approval and moves the status", () => {
    const db = freshBook();
    const loan = recordDecision(db, {
      deal_id: "DL-2291",
      decision: "approved",
      amount: 95_000,
      reason: null,
    });

    expect(loan?.status).toBe("approved");
    expect(loan?.decisions).toHaveLength(1);
    expect(loan?.decisions.at(-1)).toMatchObject({
      decision: "approved",
      amount: 95_000,
      reason: null,
    });
  });

  test("approving twice is visible in the data, not an accidental no-op", () => {
    const db = freshBook();

    recordDecision(db, {
      deal_id: "DL-2291",
      decision: "approved",
      amount: 95_000,
      reason: null,
    });
    const second = recordDecision(db, {
      deal_id: "DL-2291",
      decision: "approved",
      amount: 50_000,
      reason: null,
    });

    expect(second?.decisions).toHaveLength(2);
    expect(second?.decisions.map((d) => d.amount)).toEqual([95_000, 50_000]);
  });

  test("keeps the earlier decision when a loan is decided the other way", () => {
    const db = freshBook();

    recordDecision(db, {
      deal_id: "DL-2292",
      decision: "denied",
      amount: null,
      reason: "Interim statements outstanding.",
    });
    const approved = recordDecision(db, {
      deal_id: "DL-2292",
      decision: "approved",
      amount: 15_500,
      reason: null,
    });

    expect(approved?.status).toBe("approved");
    expect(approved?.decisions.map((d) => d.decision)).toEqual(["denied", "approved"]);
  });

  test("preserves a decision history that came in with the seed", () => {
    const db = freshBook();

    expect(getLoan(db, "DL-2288")?.decisions).toHaveLength(1);

    const after = recordDecision(db, {
      deal_id: "DL-2288",
      decision: "approved",
      amount: 38_000,
      reason: null,
    });

    expect(after?.decisions).toHaveLength(2);
  });

  test("returns null for an unknown loan and writes nothing", () => {
    const db = freshBook();
    const before = countLoans(db);

    expect(
      recordDecision(db, {
        deal_id: "DL-0000",
        decision: "approved",
        amount: 1,
        reason: null,
      }),
    ).toBeNull();

    expect(countLoans(db)).toBe(before);
  });
});

describe("getLoan", () => {
  test("returns null for an unknown ID", () => {
    expect(getLoan(freshBook(), "DL-0000")).toBeNull();
  });
});
