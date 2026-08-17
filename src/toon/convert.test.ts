import { describe, expect, it } from "vitest";
import { convertCsvToToon, convertJsonValueToToon, convertToToon, convertYamlToToon, decode, encode, parseCsv } from "./convert.js";

describe("convertJsonValueToToon — round-trip", () => {
  it("round-trips a simple uniform array through encode/decode", () => {
    const items = [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
      { id: 3, name: "Alan" },
    ];
    const result = convertJsonValueToToon(items);
    expect(result.ok).toBe(true);
    expect(result.format).toBe("json");
    expect(decode(result.output as string)).toEqual(items);
  });

  it("does not crash on an empty array", () => {
    const result = convertJsonValueToToon([]);
    expect(result.ok).toBe(true);
    expect(decode(result.output as string)).toEqual([]);
  });

  it("does not crash on a single object", () => {
    const value = { id: 1, name: "Ada" };
    const result = convertJsonValueToToon(value);
    expect(result.ok).toBe(true);
    expect(decode(result.output as string)).toEqual(value);
  });

  it("does not crash on a deeply nested value inside an otherwise-uniform array", () => {
    const items = [
      { id: 1, name: "Ada", meta: { nested: { deeper: { value: 1 } } } },
      { id: 2, name: "Grace", meta: { nested: { deeper: { value: 2 } } } },
    ];
    const result = convertJsonValueToToon(items);
    expect(result.ok).toBe(true);
    expect(decode(result.output as string)).toEqual(items);
  });

  it("re-exports the real @toon-format/toon encode/decode functions", () => {
    expect(encode({ a: 1 })).toBe("a: 1");
    expect(decode("a: 1")).toEqual({ a: 1 });
  });
});

describe("parseCsv", () => {
  it("parses a simple comma-delimited table into rows of fields", () => {
    const rows = parseCsv("id,name\n1,Ada\n2,Grace\n");
    expect(rows).toEqual([
      ["id", "name"],
      ["1", "Ada"],
      ["2", "Grace"],
    ]);
  });

  it("handles quoted fields containing commas and escaped quotes", () => {
    const rows = parseCsv('id,note\n1,"hello, ""world"""\n');
    expect(rows).toEqual([
      ["id", "note"],
      ["1", 'hello, "world"'],
    ]);
  });

  it("returns null for an unterminated quote", () => {
    expect(parseCsv('id,note\n1,"unterminated')).toBeNull();
  });
});

describe("convertCsvToToon", () => {
  it("converts a header + data rows CSV to TOON", () => {
    const csv = "id,name,active\n1,Ada,true\n2,Grace,false\n";
    const result = convertCsvToToon(csv);
    expect(result.ok).toBe(true);
    expect(result.format).toBe("csv");
    // CSV values are strings — documented limitation, no type inference.
    expect(decode(result.output as string)).toEqual([
      { id: "1", name: "Ada", active: "true" },
      { id: "2", name: "Grace", active: "false" },
    ]);
  });

  it("declines when rows have inconsistent column counts", () => {
    const csv = "id,name\n1,Ada\n2,Grace,extra\n";
    const result = convertCsvToToon(csv);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/inconsistent column counts/);
  });

  it("declines when there is no data row", () => {
    const result = convertCsvToToon("id,name\n");
    expect(result.ok).toBe(false);
  });
});

describe("convertYamlToToon", () => {
  it("always declines (YAML conversion is not implemented this phase) rather than guessing", () => {
    const result = convertYamlToToon("name: Ada\nage: 30\n");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not implemented/);
  });
});

describe("convertToToon — dispatch", () => {
  it("dispatches JSON input to the JSON converter", () => {
    const items = [{ id: 1 }, { id: 2 }];
    const result = convertToToon(JSON.stringify(items));
    expect(result.ok).toBe(true);
    expect(result.format).toBe("json");
  });

  it("dispatches CSV input to the CSV converter", () => {
    const result = convertToToon("id,name\n1,Ada\n2,Grace\n");
    expect(result.ok).toBe(true);
    expect(result.format).toBe("csv");
  });

  it("dispatches YAML input to the (declining) YAML converter", () => {
    const result = convertToToon("name: Ada\nrole: engineer\ntier: senior\n");
    expect(result.ok).toBe(false);
  });

  it("declines plain text that doesn't look like JSON/CSV/YAML", () => {
    const result = convertToToon("just some plain log output\nwith a couple lines\n");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not look like/);
  });
});
