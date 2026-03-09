import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupByRound } from "../src/utils.js";
import { makeResult, makeDetail, makeExport, roundsToMap } from "./helpers.js";

describe("groupByRound", () => {
  it("groups results with same requisitionId into single round", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-01-29", requisitionId: "req1" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron")],
    });

    const rounds = roundsToMap(groupByRound(data));
    assert.equal(rounds.size, 1);
    assert.ok(rounds.has("2026-01-20"));

    const round = rounds.get("2026-01-20")!;
    assert.equal(round.results.length, 2);
    assert.equal(round.biomarkerDetails.length, 2);
  });

  it("separates results with different requisitionIds into different rounds", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-07-15", requisitionId: "req2" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron")],
    });

    const rounds = roundsToMap(groupByRound(data));
    assert.equal(rounds.size, 2);
    assert.ok(rounds.has("2026-01-20"));
    assert.ok(rounds.has("2026-07-15"));

    assert.equal(rounds.get("2026-01-20")!.results.length, 1);
    assert.equal(rounds.get("2026-07-15")!.results.length, 1);
  });

  it("assigns empty requisitionId to round with exact dateOfService match", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-01-20", requisitionId: "" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron")],
    });

    const rounds = roundsToMap(groupByRound(data));
    assert.equal(rounds.size, 1);
    assert.ok(rounds.has("2026-01-20"));
    assert.equal(rounds.get("2026-01-20")!.results.length, 2);
  });

  it("isolates empty requisitionId when ambiguous (multiple rounds share date)", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-01-20", requisitionId: "req2" }),
        makeResult({ id: "r3", biomarkerName: "B12", dateOfService: "2026-01-20", requisitionId: "" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron"), makeDetail("B12")],
    });

    const rounds = groupByRound(data);
    // 3 groups: req1, req2, orphan — all keyed by "2026-01-20"
    assert.equal(rounds.length, 3);
    // All results preserved (no data loss)
    const totalResults = rounds.reduce((sum, [, r]) => sum + r.results.length, 0);
    assert.equal(totalResults, 3);
  });

  it("isolates empty requisitionId with no matching date", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-02-15", requisitionId: "" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron")],
    });

    const rounds = groupByRound(data);
    assert.equal(rounds.length, 2);
  });

  it("keys round by earliest dateOfService", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-29", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r3", biomarkerName: "B12", dateOfService: "2026-01-25", requisitionId: "req1" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron"), makeDetail("B12")],
    });

    const rounds = roundsToMap(groupByRound(data));
    assert.equal(rounds.size, 1);
    assert.ok(rounds.has("2026-01-20"));
    assert.equal(rounds.get("2026-01-20")!.results.length, 3);
  });

  it("handles single result as single round", () => {
    const data = makeExport({
      results: [makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" })],
      biomarkerDetails: [makeDetail("Vitamin D")],
    });

    const rounds = roundsToMap(groupByRound(data));
    assert.equal(rounds.size, 1);
    assert.ok(rounds.has("2026-01-20"));
  });

  it("handles all results same date as single round", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r3", biomarkerName: "B12", dateOfService: "2026-01-20", requisitionId: "req1" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron"), makeDetail("B12")],
    });

    const rounds = roundsToMap(groupByRound(data));
    assert.equal(rounds.size, 1);
    assert.ok(rounds.has("2026-01-20"));
    assert.equal(rounds.get("2026-01-20")!.results.length, 3);
  });

  it("preserves all rounds when different requisitionIds share same earliest date", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-01-20", requisitionId: "req2" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron")],
    });

    const rounds = groupByRound(data);
    // Both rounds preserved — no data loss from key collision
    assert.equal(rounds.length, 2);
    const totalResults = rounds.reduce((sum, [, r]) => sum + r.results.length, 0);
    assert.equal(totalResults, 2);
    // Both keyed by the same date
    assert.equal(rounds[0][0], "2026-01-20");
    assert.equal(rounds[1][0], "2026-01-20");
  });

  it("returns fallback date when no results exist", () => {
    const data = makeExport({ results: [] });
    const rounds = groupByRound(data);
    assert.equal(rounds.length, 1);
    assert.match(rounds[0][0], /^\d{4}-\d{2}-\d{2}$/);
  });

  it("truncates dateOfService to YYYY-MM-DD", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "A", dateOfService: "2026-01-20T10:30:00Z", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "B", dateOfService: "2026-01-20T14:00:00Z", requisitionId: "req1" }),
      ],
      biomarkerDetails: [makeDetail("A"), makeDetail("B")],
    });

    const rounds = roundsToMap(groupByRound(data));
    assert.equal(rounds.size, 1);
    assert.ok(rounds.has("2026-01-20"));
  });

  it("filters biomarkerDetails to match each round's results", () => {
    const data = makeExport({
      results: [
        makeResult({ id: "r1", biomarkerName: "Vitamin D", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "Iron", dateOfService: "2026-07-15", requisitionId: "req2" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron"), makeDetail("Unused")],
    });

    const rounds = roundsToMap(groupByRound(data));
    assert.deepEqual(rounds.get("2026-01-20")!.biomarkerDetails.map(d => d.name), ["Vitamin D"]);
    assert.deepEqual(rounds.get("2026-07-15")!.biomarkerDetails.map(d => d.name), ["Iron"]);
  });

  it("shares non-result data across all rounds", () => {
    const profile = { id: "p1", patientIdentifier: "P001", fname: "Test", lname: "User", preferredName: "", biologicalSex: "Male", dob: "1990-01-01", pronouns: "", canScheduleInBetaStates: false, patientContactInfo: { email: "", phoneNumber: "", streetAddress: "", city: "", state: "", zip: "" }, dateJoined: "", intake_status: false, patientMembership: "" };
    const data = makeExport({
      profile,
      results: [
        makeResult({ id: "r1", biomarkerName: "A", dateOfService: "2026-01-20", requisitionId: "req1" }),
        makeResult({ id: "r2", biomarkerName: "B", dateOfService: "2026-07-15", requisitionId: "req2" }),
      ],
      biomarkerDetails: [makeDetail("A"), makeDetail("B")],
      categories: [{ id: "c1", categoryName: "Heart", description: "", biomarkers: [] }],
    });

    const rounds = groupByRound(data);
    for (const [, round] of rounds) {
      assert.equal(round.profile, profile);
      assert.equal(round.categories, data.categories);
      assert.equal(round.recommendations, data.recommendations);
    }
  });
});
