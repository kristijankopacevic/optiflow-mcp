import { describe, expect, it } from "vitest";
import { terraformFilter } from "./terraform.js";
import { loadCliOutputFixture } from "./test-fixtures.js";
import type { FilterInput } from "./types.js";

function input(stdout: string, args: string[] = ["plan"]): FilterInput {
  return { stdout, stderr: "", args, exitCode: 0 };
}

describe("terraformFilter", () => {
  const stdout = loadCliOutputFixture("terraform-plan.txt");

  it("always preserves the Plan: summary line verbatim", () => {
    const result = terraformFilter(input(stdout));
    expect(result.text).toContain("Plan: 2 to add, 2 to change, 1 to destroy.");
    expect(result.meta?.summary).toBe("Plan: 2 to add, 2 to change, 1 to destroy.");
  });

  it("counts all 5 resource change blocks", () => {
    const result = terraformFilter(input(stdout));
    expect(result.meta?.resourceCount).toBe(5);
  });

  it("truncates large resource diff blocks to the first N lines with an omitted-count marker", () => {
    const result = terraformFilter(input(stdout));
    // aws_instance.api's body is 8 lines -> truncated to 6 + a 2-line-omitted marker.
    expect(result.text).toContain("[2 lines omitted]");
    // aws_security_group.api_sg's body is 9 lines -> truncated to 6 + a 3-line-omitted marker.
    expect(result.text).toContain("[3 lines omitted]");
  });

  it("keeps small resource blocks (<= 6 body lines) fully", () => {
    const result = terraformFilter(input(stdout));
    expect(result.text).toContain('ami                    = "ami-0123456789abcdef0" -> null');
    expect(result.text).toContain('id                     = "i-0fedcba9876543210" -> null');
  });

  it("keeps every resource header line", () => {
    const result = terraformFilter(input(stdout));
    expect(result.text).toContain("aws_instance.api will be updated in-place");
    expect(result.text).toContain("aws_instance.worker will be destroyed");
    expect(result.text).toContain("aws_security_group.api_sg will be created");
    expect(result.text).toContain("aws_db_instance.postgres will be updated in-place");
    expect(result.text).toContain("module.vpc.aws_subnet.private[0] will be created");
  });

  it("shrinks total output size", () => {
    const result = terraformFilter(input(stdout));
    expect(result.text.length).toBeLessThan(stdout.length);
  });

  it("handles a plan with no changes", () => {
    const result = terraformFilter(input("No changes. Your infrastructure matches the configuration.\n"));
    expect(result.meta?.summary).toContain("No changes.");
  });
});
