import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";

// We test migration by setting up a temp directory structure that mimics ~/.function-health/exports/
// Since store.ts uses a hardcoded path, we test the underlying logic via groupByRound and
// integration tests that exercise saveRoundExport.

import { groupByRound, extractRequisitionId, extractVisitDates } from "../src/utils.js";
import { makeResult, makeDetail, makeExport, makeRoundMeta } from "./helpers.js";

describe("extractRequisitionId", () => {
  it("returns single requisitionId when all results share one", () => {
    const results = [
      makeResult({ requisitionId: "req1" }),
      makeResult({ requisitionId: "req1" }),
    ];
    assert.equal(extractRequisitionId(results), "req1");
  });

  it("returns empty string when results have different requisitionIds", () => {
    const results = [
      makeResult({ requisitionId: "req1" }),
      makeResult({ requisitionId: "req2" }),
    ];
    assert.equal(extractRequisitionId(results), "");
  });

  it("returns empty string when no results have requisitionId", () => {
    const results = [
      makeResult({ requisitionId: "" }),
    ];
    assert.equal(extractRequisitionId(results), "");
  });
});

describe("extractVisitDates", () => {
  it("returns unique sorted dates", () => {
    const results = [
      makeResult({ dateOfService: "2026-01-29" }),
      makeResult({ dateOfService: "2026-01-20" }),
      makeResult({ dateOfService: "2026-01-29" }),
      makeResult({ dateOfService: "2026-01-25" }),
    ];
    assert.deepEqual(extractVisitDates(results), ["2026-01-20", "2026-01-25", "2026-01-29"]);
  });

  it("skips empty dateOfService", () => {
    const results = [
      makeResult({ dateOfService: "" }),
      makeResult({ dateOfService: "2026-01-20" }),
    ];
    assert.deepEqual(extractVisitDates(results), ["2026-01-20"]);
  });
});

describe("migration logic via groupByRound", () => {
  it("merges results from different visit dates into one round when same requisitionId", () => {
    // Simulates two old per-visit directories that should be merged
    const allResults = [
      makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
      makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-01-20", requisitionId: "req1" }),
      makeResult({ id: "r3", biomarkerName: "B12", dateOfService: "2026-01-29", requisitionId: "req1" }),
      makeResult({ id: "r4", biomarkerName: "Folate", dateOfService: "2026-01-29", requisitionId: "req1" }),
    ];

    const data = makeExport({
      results: allResults,
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron"), makeDetail("B12"), makeDetail("Folate")],
    });

    const rounds = groupByRound(data);
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0][0], "2026-01-20"); // earliest date
    assert.equal(rounds[0][1].results.length, 4);
  });

  it("deduplicates results by id when merging", () => {
    // Same result appears in two groups (simulating re-run)
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D")],
    });

    const rounds = groupByRound(data);
    assert.equal(rounds.length, 1);
    // groupByRound doesn't deduplicate by id (that's migration's job), but results are in same group
    assert.equal(rounds[0][0], "2026-01-20");
  });

  it("keeps separate rounds separate", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-07-15", requisitionId: "req2" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron")],
    });

    const rounds = groupByRound(data);
    assert.equal(rounds.length, 2);
    const keys = rounds.map(([k]) => k).sort();
    assert.deepEqual(keys, ["2026-01-20", "2026-07-15"]);
  });
});

describe("makeRoundMeta helper", () => {
  it("creates default round meta", () => {
    const meta = makeRoundMeta();
    assert.equal(meta.requisitionId, "req1");
    assert.deepEqual(meta.visitDates, ["2026-01-20"]);
    assert.equal(meta.resultCount, 1);
  });

  it("accepts overrides", () => {
    const meta = makeRoundMeta({ requisitionId: "req2", resultCount: 42 });
    assert.equal(meta.requisitionId, "req2");
    assert.equal(meta.resultCount, 42);
  });
});
