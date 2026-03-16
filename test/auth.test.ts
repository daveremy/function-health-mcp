import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { shouldAttemptEnvLogin } from "../src/auth.js";

describe("shouldAttemptEnvLogin", () => {
  const originalEnv = { FH_EMAIL: process.env.FH_EMAIL, FH_PASSWORD: process.env.FH_PASSWORD };

  afterEach(() => {
    // Restore original env
    if (originalEnv.FH_EMAIL !== undefined) process.env.FH_EMAIL = originalEnv.FH_EMAIL;
    else delete process.env.FH_EMAIL;
    if (originalEnv.FH_PASSWORD !== undefined) process.env.FH_PASSWORD = originalEnv.FH_PASSWORD;
    else delete process.env.FH_PASSWORD;
  });

  it("returns credentials when env vars are set and email matches", () => {
    process.env.FH_EMAIL = "user@example.com";
    process.env.FH_PASSWORD = "pass123";
    const result = shouldAttemptEnvLogin("user@example.com");
    assert.deepEqual(result, { email: "user@example.com", password: "pass123" });
  });

  it("returns null when env vars are not set", () => {
    // Use empty strings to override any .env file fallback
    process.env.FH_EMAIL = "";
    process.env.FH_PASSWORD = "";
    assert.equal(shouldAttemptEnvLogin("user@example.com"), null);
  });

  it("returns null when only FH_EMAIL is set", () => {
    process.env.FH_EMAIL = "user@example.com";
    process.env.FH_PASSWORD = "";
    assert.equal(shouldAttemptEnvLogin("user@example.com"), null);
  });

  it("returns null when only FH_PASSWORD is set", () => {
    process.env.FH_EMAIL = "";
    process.env.FH_PASSWORD = "pass123";
    assert.equal(shouldAttemptEnvLogin("user@example.com"), null);
  });

  it("returns null when env email does not match stored account", () => {
    process.env.FH_EMAIL = "other@example.com";
    process.env.FH_PASSWORD = "pass123";
    assert.equal(shouldAttemptEnvLogin("user@example.com"), null);
  });

  it("allows fallback when stored email is empty (legacy credentials)", () => {
    process.env.FH_EMAIL = "user@example.com";
    process.env.FH_PASSWORD = "pass123";
    const result = shouldAttemptEnvLogin("");
    assert.deepEqual(result, { email: "user@example.com", password: "pass123" });
  });

  it("email comparison is case-insensitive", () => {
    process.env.FH_EMAIL = "user@example.com";
    process.env.FH_PASSWORD = "pass123";
    const result = shouldAttemptEnvLogin("User@Example.COM");
    assert.deepEqual(result, { email: "user@example.com", password: "pass123" });
  });
});
