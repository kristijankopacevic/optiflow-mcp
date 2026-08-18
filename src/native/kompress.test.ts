import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Fake tokenizer / ONNX session (never the real model/network) ──────────
//
// A tiny deterministic "vocabulary" lets this test control exactly which
// words the (mocked) model scores high vs. low, so the assertions below
// exercise this module's real algorithm — word/sub-token alignment,
// chunking, the score threshold, and the must-keep regex override — without
// downloading or running the actual 274MB Kompress model. See this
// directory's `kompress-model.test.ts` for the download/cache logic's own
// dedicated (also network-free) tests, and the task's handoff notes for the
// one real manual smoke test against the actual model.
const VOCAB: Record<string, number> = {
  x: 5, // probe word used by detectSpecialWrapping; id is irrelevant to scoring
  keepme: 1, // odd id -> mocked high score -> kept
  dropme: 2, // even id -> mocked low score -> dropped
  filler: 4, // even id -> mocked low score -> dropped
  ERROR: 2, // even id -> mocked low score, but ALLCAPS -> must-keep override applies
};

function encodeWord(word: string, addSpecialTokens: boolean): number[] {
  const id = VOCAB[word] ?? 999;
  // Fake CLS/SEP-equivalent wrapping (100/101), detected generically by
  // `detectSpecialWrapping`'s probe-diff logic — mirrors a real tokenizer's
  // special-token behavior closely enough to exercise that code path.
  return addSpecialTokens ? [100, id, 101] : [id];
}

const fakeTokenizer = {
  encode: vi.fn((text: string, opts?: { add_special_tokens?: boolean }) =>
    encodeWord(text, opts?.add_special_tokens ?? true)
  ),
};

const fakeSession = {
  run: vi.fn(async (feeds: { input_ids: { data: BigInt64Array } }) => {
    const ids = Array.from(feeds.input_ids.data).map(Number);
    // Odd token id -> score 0.9 (kept, > 0.5 threshold); even -> 0.1 (dropped).
    const scores = new Float32Array(ids.map((id) => (id % 2 === 1 ? 0.9 : 0.1)));
    return { final_scores: { data: scores } };
  }),
};

vi.mock("@huggingface/transformers", () => ({
  AutoTokenizer: {
    from_pretrained: vi.fn(async () => fakeTokenizer),
  },
}));

vi.mock("onnxruntime-node", async () => {
  const actual = await vi.importActual<typeof import("onnxruntime-node")>("onnxruntime-node");
  return {
    ...actual,
    InferenceSession: {
      create: vi.fn(async () => fakeSession),
    },
  };
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-kompress-test-"));
  fakeSession.run.mockClear();
  fakeTokenizer.encode.mockClear();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** Pre-seeds the local model cache directly (no download involved) so
 * `ensureModelDownloaded` reports `available: true` without ever calling
 * `fetchImpl` — the file *contents* don't matter since the ONNX session and
 * tokenizer loading are both mocked above and never actually parse them. */
function seedFakeModelCache(): void {
  const dir = path.join(home, "models", "kompress");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "kompress-int8-wo.onnx"), "not a real onnx file");
  const tokDir = path.join(dir, "tokenizer");
  mkdirSync(tokDir, { recursive: true });
  writeFileSync(path.join(tokDir, "tokenizer.json"), "{}");
  writeFileSync(path.join(tokDir, "tokenizer_config.json"), "{}");
  writeFileSync(path.join(tokDir, "special_tokens_map.json"), "{}");
}

describe("compressWithKompress — graceful degradation (never throws, never hits the network)", () => {
  it("returns available:false when disabled, without ever calling fetchImpl", async () => {
    const { compressWithKompress } = await import("./kompress.js");
    const fetchImpl = vi.fn();
    const result = await compressWithKompress("word ".repeat(20), {
      enabled: false,
      home,
      fetchImpl: fetchImpl as never,
    });

    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/disabled/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("defaults to disabled when `enabled` is omitted entirely", async () => {
    const { compressWithKompress } = await import("./kompress.js");
    const result = await compressWithKompress("word ".repeat(20), { home });
    expect(result.available).toBe(false);
  });

  it("returns available:false for input under 10 words, before resolving the model at all", async () => {
    const { compressWithKompress } = await import("./kompress.js");
    const fetchImpl = vi.fn();
    const result = await compressWithKompress("only four words here", {
      enabled: true,
      home,
      fetchImpl: fetchImpl as never,
    });

    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/too short/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns available:false when the model is not cached and downloading is not allowed", async () => {
    const { compressWithKompress } = await import("./kompress.js");
    const fetchImpl = vi.fn();
    const result = await compressWithKompress("word ".repeat(20), {
      enabled: true,
      allowDownload: false,
      home,
      fetchImpl: fetchImpl as never,
    });

    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/not cached/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns available:false (never throws) when the model is not cached, even with allowDownload true, if the download itself fails", async () => {
    const { compressWithKompress } = await import("./kompress.js");
    const fetchImpl = vi.fn(async () => {
      throw new Error("simulated network failure");
    });

    await expect(
      compressWithKompress("word ".repeat(20), {
        enabled: true,
        allowDownload: true,
        home,
        fetchImpl: fetchImpl as never,
      })
    ).resolves.toEqual(expect.objectContaining({ available: false }));
  });
});

describe("compressWithKompress — inference pipeline (mocked ONNX session + tokenizer, real algorithm)", () => {
  it("keeps high-score words, drops low-score words, and always keeps must-keep tokens regardless of model score", async () => {
    seedFakeModelCache();
    const { compressWithKompress } = await import("./kompress.js");

    const words = [
      "keepme",
      "dropme",
      "keepme",
      "dropme",
      "keepme",
      "dropme",
      "filler",
      "filler",
      "ERROR",
      "filler",
      "filler",
      "filler",
    ];
    const input = words.join(" ");

    const result = await compressWithKompress(input, { enabled: true, home });

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.original).toBe(input);
    expect(result.originalTokens).toBe(words.length);

    const compressedWords = result.compressed.split(" ").filter((w) => w.length > 0);

    // All three "keepme" occurrences (high model score) survive.
    expect(compressedWords.filter((w) => w === "keepme")).toHaveLength(3);
    // "ERROR" survives despite a low model score, because it matches the
    // must-keep ALLCAPS pattern.
    expect(compressedWords).toContain("ERROR");
    // Low-score, non-must-keep words are actually dropped.
    expect(compressedWords).not.toContain("dropme");
    expect(compressedWords).not.toContain("filler");

    expect(result.compressedTokens).toBe(4); // 3x keepme + 1x ERROR
    expect(result.compressionRatio).toBeLessThan(1);
    expect(result.compressionRatio).toBeGreaterThan(0);
  });

  it("word order in the compressed output follows original position, not model score", async () => {
    seedFakeModelCache();
    const { compressWithKompress } = await import("./kompress.js");

    const words = ["ERROR", "filler", "filler", "keepme", "filler", "filler", "filler", "filler", "filler", "filler"];
    const result = await compressWithKompress(words.join(" "), { enabled: true, home });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.compressed).toBe("ERROR keepme");
  });

  it("passes through unmodified when every word in the input is dropped by the model", async () => {
    seedFakeModelCache();
    const { compressWithKompress } = await import("./kompress.js");

    const input = new Array(12).fill("filler").join(" ");
    const result = await compressWithKompress(input, { enabled: true, home });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.compressed).toBe(input);
    expect(result.compressionRatio).toBe(1);
  });

  it("never calls fetchImpl once the model is already cached", async () => {
    seedFakeModelCache();
    const { compressWithKompress } = await import("./kompress.js");
    const fetchImpl = vi.fn();

    const result = await compressWithKompress(new Array(15).fill("keepme").join(" "), {
      enabled: true,
      allowDownload: true,
      home,
      fetchImpl: fetchImpl as never,
    });

    expect(result.available).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
