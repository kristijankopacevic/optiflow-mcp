// Dispatches to the right per-binary filter. `wrapper.ts` is the only
// consumer that needs actual process spawning; this module only maps a
// binary name to the pure filter function that compresses its output.

import { BUILTIN_TEST_RUNNERS } from "../allowlist.js";
import { dockerFilter } from "./docker.js";
import { genericFilter } from "./generic.js";
import { gitFilter } from "./git.js";
import { kubectlFilter } from "./kubectl.js";
import { npmFilter } from "./npm.js";
import { terraformFilter } from "./terraform.js";
import { testrunnerFilter } from "./testrunner.js";
import type { FilterInput, FilterOutput, OutputFilter } from "./types.js";

export type { FilterInput, FilterOutput, OutputFilter };
export { dockerFilter, genericFilter, gitFilter, kubectlFilter, npmFilter, terraformFilter, testrunnerFilter };

const TEST_RUNNER_BINARIES = new Set<string>(BUILTIN_TEST_RUNNERS);

/** Picks the filter to run for `binary` (the wrapped command's first token). */
export function getFilterForBinary(binary: string): OutputFilter {
  switch (binary) {
    case "git":
      return gitFilter;
    case "docker":
      return dockerFilter;
    case "kubectl":
      return kubectlFilter;
    case "npm":
      return npmFilter;
    case "terraform":
      return terraformFilter;
    case "go":
      return testrunnerFilter;
    default:
      if (TEST_RUNNER_BINARIES.has(binary)) return testrunnerFilter;
      return genericFilter;
  }
}
