import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { partitionByVisitDate } from "../src/utils.js";
import { makeResult, makeDetail, makeExport } from "./helpers.js";

describe("partitionByVisitDate", () => {
  it("returns single partition for single visit date", () => {
    const data = makeExport({
      results: [
        makeResult({ biomarkerName: "Vitamin D", dateOfService: "2026-01-20" }),
        makeResult({ biomarkerName: "Iron", dateOfService: "2026-01-20" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron")],
    });

    const partitions = partitionByVisitDate(data);
    assert.equal(partitions.size, 1);
    assert.ok(partitions.has("2026-01-20"));

    const partition = partitions.get("2026-01-20")!;
    assert.equal(partition.results.length, 2);
    // Single partition returns original data unchanged
    assert.equal(partition, data);
  });

  it("partitions results by dateOfService for multiple visits", () => {
    const data = makeExport({
      results: [
        makeResult({ biomarkerName: "Vitamin D", dateOfService: "2026-01-20" }),
        makeResult({ biomarkerName: "Iron", dateOfService: "2026-01-20" }),
        makeResult({ biomarkerName: "B12", dateOfService: "2026-01-29" }),
        makeResult({ biomarkerName: "Folate", dateOfService: "2026-01-29" }),
        makeResult({ biomarkerName: "Zinc", dateOfService: "2026-01-29" }),
      ],
      biomarkerDetails: [
        makeDetail("Vitamin D"), makeDetail("Iron"),
        makeDetail("B12"), makeDetail("Folate"), makeDetail("Zinc"),
      ],
    });

    const partitions = partitionByVisitDate(data);
    assert.equal(partitions.size, 2);

    const jan20 = partitions.get("2026-01-20")!;
    assert.equal(jan20.results.length, 2);
    assert.deepEqual(jan20.results.map(r => r.biomarkerName).sort(), ["Iron", "Vitamin D"]);
    assert.equal(jan20.biomarkerDetails.length, 2);

    const jan29 = partitions.get("2026-01-29")!;
    assert.equal(jan29.results.length, 3);
    assert.deepEqual(jan29.results.map(r => r.biomarkerName).sort(), ["B12", "Folate", "Zinc"]);
    assert.equal(jan29.biomarkerDetails.length, 3);
  });

  it("filters biomarkerDetails to match each partition's results", () => {
    const data = makeExport({
      results: [
        makeResult({ biomarkerName: "Vitamin D", dateOfService: "2026-01-20" }),
        makeResult({ biomarkerName: "Iron", dateOfService: "2026-01-29" }),
      ],
      biomarkerDetails: [makeDetail("Vitamin D"), makeDetail("Iron"), makeDetail("Unused")],
    });

    const partitions = partitionByVisitDate(data);
    const jan20 = partitions.get("2026-01-20")!;
    const jan29 = partitions.get("2026-01-29")!;

    assert.deepEqual(jan20.biomarkerDetails.map(d => d.name), ["Vitamin D"]);
    assert.deepEqual(jan29.biomarkerDetails.map(d => d.name), ["Iron"]);
  });

  it("shares non-result data across all partitions", () => {
    const profile = { id: "p1", patientIdentifier: "P001", fname: "Test", lname: "User", preferredName: "", biologicalSex: "Male", dob: "1990-01-01", pronouns: "", canScheduleInBetaStates: false, patientContactInfo: { email: "", phoneNumber: "", streetAddress: "", city: "", state: "", zip: "" }, dateJoined: "", intake_status: false, patientMembership: "" };
    const data = makeExport({
      profile,
      results: [
        makeResult({ biomarkerName: "A", dateOfService: "2026-01-20" }),
        makeResult({ biomarkerName: "B", dateOfService: "2026-01-29" }),
      ],
      biomarkerDetails: [makeDetail("A"), makeDetail("B")],
      categories: [{ id: "c1", categoryName: "Heart", description: "", biomarkers: [] }],
    });

    const partitions = partitionByVisitDate(data);
    for (const [, partition] of partitions) {
      assert.equal(partition.profile, profile);
      assert.equal(partition.categories, data.categories);
      assert.equal(partition.recommendations, data.recommendations);
    }
  });

  it("handles results with no dateOfService gracefully", () => {
    const data = makeExport({
      results: [
        makeResult({ biomarkerName: "A", dateOfService: "" }),
        makeResult({ biomarkerName: "B", dateOfService: "2026-01-20" }),
      ],
      biomarkerDetails: [makeDetail("A"), makeDetail("B")],
    });

    const partitions = partitionByVisitDate(data);
    // Result with empty dateOfService is skipped from grouping
    // Only one date group → single partition returns original data
    assert.equal(partitions.size, 1);
    assert.ok(partitions.has("2026-01-20"));
  });

  it("returns fallback date when no results exist", () => {
    const data = makeExport({ results: [] });
    const partitions = partitionByVisitDate(data);
    assert.equal(partitions.size, 1);
    // Should use deriveExportDate fallback (today's date)
    const [date] = [...partitions.keys()];
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  });

  it("truncates dateOfService to YYYY-MM-DD", () => {
    const data = makeExport({
      results: [
        makeResult({ biomarkerName: "A", dateOfService: "2026-01-20T10:30:00Z" }),
        makeResult({ biomarkerName: "B", dateOfService: "2026-01-20T14:00:00Z" }),
      ],
      biomarkerDetails: [makeDetail("A"), makeDetail("B")],
    });

    const partitions = partitionByVisitDate(data);
    assert.equal(partitions.size, 1);
    assert.ok(partitions.has("2026-01-20"));
  });
});
