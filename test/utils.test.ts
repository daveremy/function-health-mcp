import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveExportDate, validateDate, isValidDateString, fuzzyMatch, getResultName, getResultValue, buildOutOfRangeSet, filterResults, parseDotenv } from "../src/utils.js";
import { exportsEqual } from "../src/store.js";
import { makeResult, makeExport } from "./helpers.js";

describe("deriveExportDate", () => {
  it("returns latest dateOfService from results", () => {
    const data = {
      results: [
        makeResult({ dateOfService: "2026-01-20" }),
        makeResult({ dateOfService: "2026-01-29" }),
        makeResult({ dateOfService: "2026-01-15" }),
      ],
    };
    assert.equal(deriveExportDate(data), "2026-01-29");
  });

  it("returns fallback when no results", () => {
    assert.equal(deriveExportDate({ results: [] }), "unknown");
    assert.equal(deriveExportDate({ results: [] }, "2026-03-01"), "2026-03-01");
  });

  it("truncates dateOfService with timestamps", () => {
    const data = { results: [makeResult({ dateOfService: "2026-01-20T10:30:00Z" })] };
    assert.equal(deriveExportDate(data), "2026-01-20");
  });
});

describe("validateDate", () => {
  it("accepts valid YYYY-MM-DD dates", () => {
    assert.equal(validateDate("2026-01-20"), "2026-01-20");
    assert.equal(validateDate("2000-12-31"), "2000-12-31");
  });

  it("rejects invalid formats", () => {
    assert.throws(() => validateDate("01-20-2026"));
    assert.throws(() => validateDate("2026/01/20"));
    assert.throws(() => validateDate("not-a-date"));
    assert.throws(() => validateDate(""));
  });

  it("rejects overflow dates", () => {
    assert.throws(() => validateDate("2026-13-01")); // month 13
    assert.throws(() => validateDate("2026-02-30")); // Feb 30
  });
});

describe("isValidDateString", () => {
  it("validates correct dates", () => {
    assert.equal(isValidDateString("2026-01-20"), true);
    assert.equal(isValidDateString("2026-02-28"), true);
  });

  it("rejects invalid dates", () => {
    assert.equal(isValidDateString("2026-13-01"), false);
    assert.equal(isValidDateString("abc"), false);
    assert.equal(isValidDateString("2026-1-1"), false);
  });
});

describe("fuzzyMatch", () => {
  it("matches case-insensitively", () => {
    assert.equal(fuzzyMatch("vitamin d", "Vitamin D"), true);
    assert.equal(fuzzyMatch("VITAMIN D", "vitamin d"), true);
  });

  it("matches substrings", () => {
    assert.equal(fuzzyMatch("vitamin", "Vitamin D, 25-Hydroxy"), true);
    assert.equal(fuzzyMatch("tsh", "TSH (Thyroid Stimulating Hormone)"), true);
  });

  it("rejects non-matches", () => {
    assert.equal(fuzzyMatch("iron", "Vitamin D"), false);
  });

  it("handles whitespace in query", () => {
    assert.equal(fuzzyMatch("  vitamin d  ", "Vitamin D"), true);
  });
});

describe("getResultName", () => {
  it("returns biomarkerName when present", () => {
    assert.equal(getResultName(makeResult({ biomarkerName: "Vitamin D" })), "Vitamin D");
  });

  it("falls back to name field", () => {
    const r = { name: "Iron", id: "1", dateOfService: "", calculatedResult: "", displayResult: "", inRange: true, requisitionId: "" };
    assert.equal(getResultName(r), "Iron");
  });

  it("uses idToName map for biomarkerId fallback", () => {
    const idToName = new Map([["bm1", "Zinc"]]);
    const r = { biomarkerId: "bm1", id: "1", dateOfService: "", calculatedResult: "", displayResult: "", inRange: true, requisitionId: "" };
    assert.equal(getResultName(r, idToName), "Zinc");
  });

  it("returns null when no name can be resolved", () => {
    const r = { id: "1", dateOfService: "", calculatedResult: "", displayResult: "", inRange: true, requisitionId: "" };
    assert.equal(getResultName(r), null);
  });
});

describe("getResultValue", () => {
  it("prefers displayResult", () => {
    assert.equal(getResultValue(makeResult({ displayResult: "30 ng/mL", calculatedResult: "30" })), "30 ng/mL");
  });

  it("falls back to calculatedResult", () => {
    assert.equal(getResultValue(makeResult({ displayResult: "", calculatedResult: "30" })), "30");
  });
});

describe("buildOutOfRangeSet", () => {
  it("collects lowercase names of out-of-range results", () => {
    const results = [
      makeResult({ biomarkerName: "Vitamin D", inRange: false }),
      makeResult({ biomarkerName: "Iron", inRange: true }),
      makeResult({ biomarkerName: "B12", inRange: false }),
    ];
    const set = buildOutOfRangeSet(results);
    assert.equal(set.has("vitamin d"), true);
    assert.equal(set.has("b12"), true);
    assert.equal(set.has("iron"), false);
  });
});

describe("filterResults", () => {
  const results = [
    makeResult({ biomarkerName: "Vitamin D", inRange: true }),
    makeResult({ biomarkerName: "Iron", inRange: false }),
    makeResult({ biomarkerName: "Vitamin B12", inRange: true }),
  ];

  it("filters by biomarker name (fuzzy)", () => {
    const filtered = filterResults(results, { biomarker: "vitamin" });
    assert.equal(filtered.length, 2);
  });

  it("filters by status in_range", () => {
    const filtered = filterResults(results, { status: "in_range" });
    assert.equal(filtered.length, 2);
  });

  it("filters by status out_of_range", () => {
    const filtered = filterResults(results, { status: "out_of_range" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].biomarkerName, "Iron");
  });

  it("returns all when no filters", () => {
    const filtered = filterResults(results, {});
    assert.equal(filtered.length, 3);
  });
});

describe("exportsEqual", () => {
  it("returns true for identical exports", () => {
    const a = makeExport({ results: [makeResult()] });
    const b = makeExport({ results: [makeResult()] });
    assert.equal(exportsEqual(a, b), true);
  });

  it("returns false when results differ", () => {
    const a = makeExport({ results: [makeResult({ displayResult: "30" })] });
    const b = makeExport({ results: [makeResult({ displayResult: "42" })] });
    assert.equal(exportsEqual(a, b), false);
  });

  it("returns false when metadata differs", () => {
    const a = makeExport({ biologicalAge: { age: 35 } });
    const b = makeExport({ biologicalAge: { age: 37 } });
    assert.equal(exportsEqual(a, b), false);
  });

  it("returns true for empty exports", () => {
    assert.equal(exportsEqual(makeExport(), makeExport()), true);
  });
});

describe("parseDotenv", () => {
  it("parses KEY=VALUE pairs", () => {
    assert.deepEqual(parseDotenv("FOO=bar\nBAZ=qux"), { FOO: "bar", BAZ: "qux" });
  });

  it("strips double quotes", () => {
    assert.deepEqual(parseDotenv('FOO="bar baz"'), { FOO: "bar baz" });
  });

  it("strips single quotes", () => {
    assert.deepEqual(parseDotenv("FOO='bar baz'"), { FOO: "bar baz" });
  });

  it("skips comments and blank lines", () => {
    assert.deepEqual(parseDotenv("# comment\n\nFOO=bar\n  # another"), { FOO: "bar" });
  });

  it("handles values with equals signs", () => {
    assert.deepEqual(parseDotenv("URL=https://example.com?a=1&b=2"), { URL: "https://example.com?a=1&b=2" });
  });

  it("returns empty object for empty input", () => {
    assert.deepEqual(parseDotenv(""), {});
  });
});
