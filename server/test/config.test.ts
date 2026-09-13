import { describe, expect, it } from "vitest";
import { sslFor } from "../src/db/client";
import { reasoningEffortFor } from "../src/llm/openai";

describe("database TLS", () => {
  it("leaves sslmode in the URL to pg", () => {
    expect(sslFor("postgresql://u:p@ep-cool-1.us-east-2.aws.neon.tech/db?sslmode=require")).toBeUndefined();
  });
  it("forces TLS for Neon hosts that don't say (Replit production databases)", () => {
    expect(sslFor("postgresql://u:p@ep-cool-1.us-east-2.aws.neon.tech/db")).toBe(true);
  });
  it("keeps plain connections for local and Replit development databases", () => {
    expect(sslFor("postgres://sayship:sayship@localhost:5432/sayship")).toBeUndefined();
    expect(sslFor("postgresql://postgres:pw@helium/heliumdb?sslmode=disable")).toBeUndefined();
    expect(sslFor("not a url")).toBeUndefined();
  });
});

describe("reasoning effort", () => {
  it("defaults to low for reasoning models only", () => {
    expect(reasoningEffortFor("gpt-5.4-mini", undefined)).toBe("low");
    expect(reasoningEffortFor("o4-mini", undefined)).toBe("low");
    expect(reasoningEffortFor("gpt-4.1-mini", undefined)).toBeUndefined();
    expect(reasoningEffortFor("gpt-4o-mini", undefined)).toBeUndefined();
  });
  it("respects an explicit setting", () => {
    expect(reasoningEffortFor("gpt-5.4-mini", "medium")).toBe("medium");
    expect(reasoningEffortFor("gpt-4.1-mini", "minimal")).toBe("minimal");
  });
});
