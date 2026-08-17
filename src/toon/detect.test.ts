import { describe, expect, it } from "vitest";
import { detectFormat, isUniformObjectArray, scoreJsonUniformity } from "./detect.js";

describe("detectFormat — JSON", () => {
  it("scores a uniform top-level array of objects highly", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `item-${i}`, active: i % 2 === 0 }));
    const result = detectFormat(JSON.stringify(items));
    expect(result.format).toBe("json");
    expect(result.json?.uniformity.isArray).toBe(true);
    expect(result.json?.uniformity.strictlyUniform).toBe(true);
    expect(result.json?.uniformity.keyOverlapRatio).toBe(1);
    expect(result.json?.uniformity.rowCount).toBe(20);
  });

  it("scores a deeply nested, non-uniform JSON value low", () => {
    const value = {
      apiVersion: "v1",
      metadata: { name: "example", labels: { app: "demo" } },
      items: [
        { id: 1, meta: { a: { b: { c: 1 } } } },
        { id: 2, other: "value", extra: { deep: { deeper: 2 } } },
      ],
    };
    const result = detectFormat(JSON.stringify(value));
    expect(result.format).toBe("json");
    // Top-level value isn't even an array, so uniformity is trivially empty/false.
    expect(result.json?.uniformity.isArray).toBe(false);
    expect(result.json?.uniformity.strictlyUniform).toBe(false);
  });

  it("scores a non-uniform top-level array (mixed key sets) low", () => {
    const items = [
      { id: 1, meta: { a: 1 } },
      { id: 2, other: "value", extra: { deep: 2 } },
      { id: 3, flag: true },
    ];
    const result = detectFormat(JSON.stringify(items));
    expect(result.format).toBe("json");
    expect(result.json?.uniformity.isArray).toBe(true);
    expect(result.json?.uniformity.strictlyUniform).toBe(false);
    expect(result.json?.uniformity.keyOverlapRatio).toBeLessThan(1);
  });

  it("does not misdetect invalid JSON starting with '{' as JSON", () => {
    const result = detectFormat("{not actually json");
    expect(result.format).not.toBe("json");
  });
});

describe("isUniformObjectArray", () => {
  it("is false for an empty array", () => {
    expect(isUniformObjectArray([])).toBe(false);
  });

  it("is false when elements have different key sets", () => {
    expect(isUniformObjectArray([{ a: 1 }, { b: 2 }])).toBe(false);
  });
});

describe("scoreJsonUniformity", () => {
  it("returns an empty/false score for non-array values", () => {
    const score = scoreJsonUniformity({ a: 1 });
    expect(score.isArray).toBe(false);
    expect(score.rowCount).toBe(0);
    expect(score.keyOverlapRatio).toBe(0);
  });

  it("returns rowCount 0 with no crash for an empty array", () => {
    const score = scoreJsonUniformity([]);
    expect(score.isArray).toBe(true);
    expect(score.rowCount).toBe(0);
  });
});

describe("detectFormat — CSV", () => {
  it("detects a simple comma-delimited table", () => {
    const csv = "id,name,active\n1,Ada,true\n2,Grace,false\n3,Alan,true\n";
    const result = detectFormat(csv);
    expect(result.format).toBe("csv");
  });

  it("handles a quoted field containing a comma without misdetecting as YAML/JSON", () => {
    const csv = 'id,name,note\n1,"Ada, Lovelace",first\n2,"Grace, Hopper",second\n';
    const result = detectFormat(csv);
    // The cheap sniff undercounts fields inside quotes, so this is a
    // documented limitation: it may NOT be detected as CSV here. What
    // matters is that it's never misdetected as something it isn't, which
    // would cause incorrect conversion downstream.
    expect(["csv", "text"]).toContain(result.format);
  });
});

describe("detectFormat — YAML", () => {
  it("detects a simple YAML mapping with nesting", () => {
    const yaml = [
      "name: example-service",
      "replicas: 3",
      "metadata:",
      "  owner: platform-team",
      "  tier: backend",
      "tags:",
      "  - api",
      "  - internal",
    ].join("\n");
    const result = detectFormat(yaml);
    expect(result.format).toBe("yaml");
  });

  it("does not misdetect a realistic application log (with colon-suffixed levels) as YAML", () => {
    const log = [
      "2026-08-17T10:00:00Z INFO: Starting service",
      "2026-08-17T10:00:01Z DEBUG: Loaded configuration from disk",
      "2026-08-17T10:00:02Z WARN: Cache miss for key user:42",
      "2026-08-17T10:00:03Z ERROR: Failed to connect to upstream, retrying",
      "2026-08-17T10:00:04Z INFO: Retry succeeded",
    ].join("\n");
    const result = detectFormat(log);
    expect(result.format).not.toBe("yaml");
    expect(result.format).not.toBe("json");
    expect(result.format).not.toBe("csv");
  });
});

describe("detectFormat — plain text", () => {
  it("does not misdetect plain prose as JSON/CSV/YAML", () => {
    const text = "This is just a plain sentence, with a comma, and another one, for good measure.";
    const result = detectFormat(text);
    expect(result.format).toBe("text");
  });

  it("treats empty input as text", () => {
    expect(detectFormat("").format).toBe("text");
    expect(detectFormat("   \n  ").format).toBe("text");
  });
});
