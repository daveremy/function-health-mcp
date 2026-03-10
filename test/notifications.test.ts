import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffMeta, buildChangeSummary, diffExports } from "../src/diff.js";
import { makeExport, makeResult } from "./helpers.js";
import type { MetaChanges } from "../src/types.js";

describe("diffMeta", () => {
  it("first sync — null previous returns changes for all non-null current fields", () => {
    const curr = makeExport({
      biologicalAge: { biologicalAge: 42, chronologicalAge: 45 },
      bmi: { bmi: 23.5 },
      recommendations: [{ id: "r1" }, { id: "r2" }],
      notes: [{ id: "n1" }],
      requisitions: [{ id: "q1" }],
      report: { summary: "all good" },
    });
    const meta = diffMeta(null, curr);

    assert.deepStrictEqual(meta.biologicalAge, { previous: null, current: 42 });
    assert.deepStrictEqual(meta.bmi, { previous: null, current: 23.5 });
    assert.equal(meta.recommendationCountDelta, 2);
    assert.equal(meta.newNotes, 1);
    assert.equal(meta.newRequisitions, 1);
    // report: no previous to compare, so reportChanged should be undefined
    assert.equal(meta.reportChanged, undefined);
  });

  it("bio age changed, recommendations added, report same", () => {
    const prev = makeExport({
      biologicalAge: { biologicalAge: 44, chronologicalAge: 45 },
      bmi: { bmi: 23.5 },
      recommendations: [{ id: "r1" }],
      notes: [{ id: "n1" }],
      requisitions: [{ id: "q1" }],
      report: { summary: "ok" },
    });
    const curr = makeExport({
      biologicalAge: { biologicalAge: 42, chronologicalAge: 45 },
      bmi: { bmi: 23.5 },
      recommendations: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
      notes: [{ id: "n1" }],
      requisitions: [{ id: "q1" }],
      report: { summary: "ok" },
    });
    const meta = diffMeta(prev, curr);

    assert.deepStrictEqual(meta.biologicalAge, { previous: 44, current: 42 });
    assert.equal(meta.bmi, undefined); // unchanged
    assert.equal(meta.recommendationCountDelta, 2);
    assert.equal(meta.newNotes, undefined); // no new notes
    assert.equal(meta.newRequisitions, undefined); // no new reqs
    assert.equal(meta.reportChanged, undefined); // same report
  });

  it("identical data returns empty MetaChanges", () => {
    const data = makeExport({
      biologicalAge: { biologicalAge: 42 },
      bmi: { bmi: 23.5 },
      recommendations: [{ id: "r1" }],
      notes: [{ id: "n1" }],
      requisitions: [{ id: "q1" }],
      report: { summary: "ok" },
    });
    const meta = diffMeta(data, data);
    assert.deepStrictEqual(meta, {});
  });

  it("detects in-place recommendation changes (same count, different content)", () => {
    const prev = makeExport({ recommendations: [{ id: "r1", title: "Eat more fish" }] });
    const curr = makeExport({ recommendations: [{ id: "r1", title: "Eat more vegetables" }] });
    const meta = diffMeta(prev, curr);
    assert.equal(meta.recommendationCountDelta, 0);
  });

  it("detects in-place note edits", () => {
    const prev = makeExport({ notes: [{ id: "n1", content: "Original" }] });
    const curr = makeExport({ notes: [{ id: "n1", content: "Edited" }] });
    const meta = diffMeta(prev, curr);
    assert.equal(meta.newNotes, 0);
  });

  it("report changed detected via deep comparison", () => {
    const prev = makeExport({ report: { summary: "ok", details: [1, 2, 3] } });
    const curr = makeExport({ report: { summary: "ok", details: [1, 2, 4] } });
    const meta = diffMeta(prev, curr);
    assert.equal(meta.reportChanged, true);
  });

  it("report with different key ordering is not flagged as changed", () => {
    const prev = makeExport({ report: { a: 1, b: 2 } });
    const curr = makeExport({ report: { b: 2, a: 1 } });
    const meta = diffMeta(prev, curr);
    assert.equal(meta.reportChanged, undefined);
  });
});

describe("buildChangeSummary", () => {
  it("first sync message with context", () => {
    const meta: MetaChanges = {};
    const lines = buildChangeSummary(null, meta, { totalResults: 113, roundCount: 1 });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /Initial sync: 113 results across 1 round/);
  });

  it("no changes returns empty array", () => {
    const meta: MetaChanges = {};
    const lines = buildChangeSummary(null, meta);
    assert.equal(lines.length, 0);
  });

  it("result diff lines", () => {
    const prev = makeExport({
      results: [
        makeResult({ id: "1", biomarkerName: "Vitamin D", calculatedResult: "30", displayResult: "30", inRange: false }),
      ],
      biomarkers: [{ id: "b1", name: "Vitamin D", questBiomarkerCode: "", categories: [], sexDetails: [], status: null }],
    });
    const curr = makeExport({
      results: [
        makeResult({ id: "1", biomarkerName: "Vitamin D", calculatedResult: "45", displayResult: "45", inRange: true }),
        makeResult({ id: "2", biomarkerName: "Iron", calculatedResult: "100", displayResult: "100", inRange: true }),
      ],
      biomarkers: [
        { id: "b1", name: "Vitamin D", questBiomarkerCode: "", categories: [], sexDetails: [], status: null },
        { id: "b2", name: "Iron", questBiomarkerCode: "", categories: [], sexDetails: [], status: null },
      ],
    });

    const diff = diffExports(prev, curr);
    const meta: MetaChanges = {};
    const lines = buildChangeSummary(diff, meta);

    assert.ok(lines.some(l => l.includes("1 new result")));
    assert.ok(lines.some(l => l.includes("1 improved")));
    assert.ok(lines.some(l => l.includes("Vitamin D")));
  });

  it("meta change lines", () => {
    const meta: MetaChanges = {
      biologicalAge: { previous: 44, current: 42 },
      bmi: { previous: 24.0, current: 23.5 },
      recommendationCountDelta: 3,
      newNotes: 2,
      newRequisitions: 1,
      reportChanged: true,
    };
    const lines = buildChangeSummary(null, meta);

    assert.ok(lines.some(l => l.includes("Biological age: 44 → 42")));
    assert.ok(lines.some(l => l.includes("BMI: 24 → 23.5")));
    assert.ok(lines.some(l => l.includes("Recommendations: +3")));
    assert.ok(lines.some(l => l.includes("2 new note(s)")));
    assert.ok(lines.some(l => l.includes("1 new requisition(s)")));
    assert.ok(lines.some(l => l.includes("Clinician report updated")));
  });

  it("content-changed meta produces 'updated' lines", () => {
    const meta: MetaChanges = {
      recommendationCountDelta: 0,
      newNotes: 0,
      newRequisitions: 0,
    };
    const lines = buildChangeSummary(null, meta);
    assert.ok(lines.some(l => l.includes("Recommendations updated")));
    assert.ok(lines.some(l => l.includes("Notes updated")));
    assert.ok(lines.some(l => l.includes("Requisitions updated")));
  });

  it("new round with stable values produces notification", () => {
    const prev = makeExport({
      results: [
        makeResult({ id: "1", biomarkerName: "Vitamin D", calculatedResult: "45", displayResult: "45", inRange: true }),
      ],
      biomarkers: [{ id: "b1", name: "Vitamin D", questBiomarkerCode: "", categories: [], sexDetails: [], status: null }],
    });
    const curr = makeExport({
      results: [
        makeResult({ id: "2", biomarkerName: "Vitamin D", calculatedResult: "46", displayResult: "46", inRange: true }),
      ],
      biomarkers: [{ id: "b1", name: "Vitamin D", questBiomarkerCode: "", categories: [], sexDetails: [], status: null }],
    });

    const diff = diffExports(prev, curr);
    const meta: MetaChanges = {};
    // 2 rounds now, 1 previously — new round detected
    const lines = buildChangeSummary(diff, meta, { totalResults: 1, roundCount: 2, previousRoundCount: 1 });

    assert.ok(lines.some(l => l.includes("new round")));
  });

  it("does not add 'new round' line when diff already reports new biomarkers", () => {
    const prev = makeExport({
      results: [
        makeResult({ id: "1", biomarkerName: "Vitamin D", calculatedResult: "45", displayResult: "45", inRange: true }),
      ],
      biomarkers: [{ id: "b1", name: "Vitamin D", questBiomarkerCode: "", categories: [], sexDetails: [], status: null }],
    });
    const curr = makeExport({
      results: [
        makeResult({ id: "1", biomarkerName: "Vitamin D", calculatedResult: "45", displayResult: "45", inRange: true }),
        makeResult({ id: "2", biomarkerName: "Iron", calculatedResult: "100", displayResult: "100", inRange: true }),
      ],
      biomarkers: [
        { id: "b1", name: "Vitamin D", questBiomarkerCode: "", categories: [], sexDetails: [], status: null },
        { id: "b2", name: "Iron", questBiomarkerCode: "", categories: [], sexDetails: [], status: null },
      ],
    });

    const diff = diffExports(prev, curr);
    const meta: MetaChanges = {};
    const lines = buildChangeSummary(diff, meta, { totalResults: 2, roundCount: 2, previousRoundCount: 1 });

    // Should have "1 new result(s)" from the diff, but NOT "new round" since diff already covers it
    assert.ok(lines.some(l => l.includes("1 new result")));
    assert.ok(!lines.some(l => l.includes("new round")));
  });

  it("integration: diffExports + diffMeta + buildChangeSummary", () => {
    const prev = makeExport({
      results: [
        makeResult({ id: "1", biomarkerName: "A1C", calculatedResult: "5.5", displayResult: "5.5", inRange: true }),
      ],
      biomarkers: [{ id: "b1", name: "A1C", questBiomarkerCode: "", categories: [], sexDetails: [], status: null }],
      biologicalAge: { biologicalAge: 44 },
      report: { v: 1 },
    });
    const curr = makeExport({
      results: [
        makeResult({ id: "1", biomarkerName: "A1C", calculatedResult: "5.8", displayResult: "5.8", inRange: false }),
      ],
      biomarkers: [{ id: "b1", name: "A1C", questBiomarkerCode: "", categories: [], sexDetails: [], status: null }],
      biologicalAge: { biologicalAge: 42 },
      report: { v: 2 },
    });

    const diff = diffExports(prev, curr);
    const meta = diffMeta(prev, curr);
    const lines = buildChangeSummary(diff, meta);

    assert.ok(lines.some(l => l.includes("worsened")));
    assert.ok(lines.some(l => l.includes("A1C")));
    assert.ok(lines.some(l => l.includes("Biological age: 44 → 42")));
    assert.ok(lines.some(l => l.includes("Clinician report updated")));
  });
});
