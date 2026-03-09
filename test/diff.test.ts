import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffExports } from "../src/diff.js";
import { makeResult, makeExport } from "./helpers.js";

function makeBiomarker(name: string) {
  return { id: `bm-${name}`, name, questBiomarkerCode: "", categories: [], sexDetails: [], status: null };
}

describe("diffExports", () => {
  it("detects new markers (in 'to' but not 'from')", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "Vitamin D", dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("Vitamin D")],
    });
    const to = makeExport({
      results: [
        makeResult({ biomarkerName: "Vitamin D", dateOfService: "2026-01-29" }),
        makeResult({ biomarkerName: "Iron", dateOfService: "2026-01-29" }),
      ],
      biomarkers: [makeBiomarker("Vitamin D"), makeBiomarker("Iron")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.summary.newCount, 1);
    assert.equal(diff.newBiomarkers[0].biomarkerName, "Iron");
  });

  it("detects disappeared markers (in 'from' but not 'to')", () => {
    const from = makeExport({
      results: [
        makeResult({ biomarkerName: "Vitamin D", dateOfService: "2026-01-20" }),
        makeResult({ biomarkerName: "Iron", dateOfService: "2026-01-20" }),
      ],
      biomarkers: [makeBiomarker("Vitamin D"), makeBiomarker("Iron")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "Vitamin D", dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("Vitamin D")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.summary.disappearedCount, 1);
    assert.equal(diff.disappeared[0].biomarkerName, "Iron");
    assert.equal(diff.disappeared[0].changeType, "disappeared");
    assert.equal(diff.disappeared[0].currentValue, "");
  });

  it("detects improved markers (out of range → in range)", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "Vitamin D", displayResult: "20", inRange: false, dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("Vitamin D")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "Vitamin D", displayResult: "45", inRange: true, dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("Vitamin D")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.summary.improvedCount, 1);
    assert.equal(diff.improved[0].changeType, "improved");
  });

  it("detects worsened markers (in range → out of range)", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "Glucose", displayResult: "90", inRange: true, dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("Glucose")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "Glucose", displayResult: "130", inRange: false, dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("Glucose")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.summary.worsenedCount, 1);
    assert.equal(diff.worsened[0].changeType, "worsened");
  });

  it("detects significant numeric change (>10%) within same range status", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "LDL", displayResult: "100", inRange: true, dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("LDL")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "LDL", displayResult: "120", inRange: true, dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("LDL")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.summary.significantChangeCount, 1);
    assert.equal(diff.significantlyChanged[0].changeType, "changed");
    assert.equal(diff.significantlyChanged[0].percentChange, 20);
  });

  it("classifies small numeric change as unchanged", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "LDL", displayResult: "100", inRange: true, dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("LDL")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "LDL", displayResult: "105", inRange: true, dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("LDL")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.summary.unchangedCount, 1);
  });

  it("detects non-numeric value change as significant", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "Urinalysis", displayResult: "CLEAR", calculatedResult: "CLEAR", inRange: true, dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("Urinalysis")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "Urinalysis", displayResult: "ABNORMAL", calculatedResult: "ABNORMAL", inRange: true, dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("Urinalysis")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.summary.significantChangeCount, 1);
    assert.equal(diff.significantlyChanged[0].changeType, "changed");
    assert.equal(diff.significantlyChanged[0].percentChange, null);
  });

  it("classifies identical non-numeric values as unchanged", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "Urinalysis", displayResult: "CLEAR", calculatedResult: "CLEAR", inRange: true, dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("Urinalysis")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "Urinalysis", displayResult: "CLEAR", calculatedResult: "CLEAR", inRange: true, dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("Urinalysis")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.summary.unchangedCount, 1);
  });

  it("calculates correct percent change", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "TSH", displayResult: "2.0", inRange: true, dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("TSH")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "TSH", displayResult: "3.0", inRange: true, dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("TSH")],
    });

    const diff = diffExports(from, to);
    // 50% increase → classified as significant change
    assert.equal(diff.significantlyChanged[0].percentChange, 50);
  });

  it("sets correct fromDate and toDate from results", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "A", dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("A")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "A", dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("A")],
    });

    const diff = diffExports(from, to);
    assert.equal(diff.fromDate, "2026-01-20");
    assert.equal(diff.toDate, "2026-01-29");
  });

  it("handles empty exports without crashing", () => {
    const from = makeExport();
    const to = makeExport();

    const diff = diffExports(from, to);
    assert.equal(diff.summary.totalCompared, 0);
    assert.equal(diff.summary.disappearedCount, 0);
  });

  it("handles values like '<0.2' as non-numeric", () => {
    const from = makeExport({
      results: [makeResult({ biomarkerName: "hsCRP", displayResult: "<0.2", calculatedResult: "<0.2", inRange: true, dateOfService: "2026-01-20" })],
      biomarkers: [makeBiomarker("hsCRP")],
    });
    const to = makeExport({
      results: [makeResult({ biomarkerName: "hsCRP", displayResult: "1.5", calculatedResult: "1.5", inRange: true, dateOfService: "2026-01-29" })],
      biomarkers: [makeBiomarker("hsCRP")],
    });

    const diff = diffExports(from, to);
    // "<0.2" parseFloat gives NaN on some engines, or 0.2 on others
    // Either way, a change should be detected (not silently unchanged)
    assert.equal(diff.summary.unchangedCount, 0);
  });
});
