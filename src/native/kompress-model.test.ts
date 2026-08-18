import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KompressFetch, KompressFetchResponse } from "./kompress-model.js";
import { ensureModelDownloaded } from "./kompress-model.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "optiflow-kompress-model-test-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/**
 * Builds a fake `fetch` Response-shaped object backed by a small in-memory
 * payload — never a real network call, never the real 274MB model.
 */
function fakeResponse(
  body: Uint8Array,
  opts: { ok?: boolean; status?: number; contentLengthOverride?: number | null } = {}
): KompressFetchResponse {
  const ok = opts.ok ?? true;
  const status = opts.status ?? 200;
  const contentLength =
    opts.contentLengthOverride === undefined ? body.length : opts.contentLengthOverride;

  const stream = ok
    ? new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(body);
          controller.close();
        },
      })
    : null;

  return {
    ok,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length" && contentLength !== null
          ? String(contentLength)
          : null,
    },
    body: stream,
  };
}

function fixedPayloadFetch(payload: Uint8Array): KompressFetch {
  return vi.fn(async () => fakeResponse(payload));
}

const FAKE_ONNX_BYTES = new TextEncoder().encode("fake onnx model contents, not the real 274MB");

describe("ensureModelDownloaded — download-not-allowed (never touches the network)", () => {
  it("returns available:false and never calls fetchImpl when allowDownload is unset (default false)", async () => {
    const fetchImpl = vi.fn();
    const result = await ensureModelDownloaded({ home, fetchImpl: fetchImpl as unknown as KompressFetch });

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toMatch(/not cached/i);
      expect(result.reason).toMatch(/allowDownload/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns available:false and never calls fetchImpl when allowDownload is explicitly false", async () => {
    const fetchImpl = vi.fn();
    const result = await ensureModelDownloaded({
      home,
      allowDownload: false,
      fetchImpl: fetchImpl as unknown as KompressFetch,
    });

    expect(result.available).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ensureModelDownloaded — cache-path resolution and atomic download", () => {
  it("downloads the onnx artifact and tokenizer files under <home>/models/kompress/", async () => {
    const fetchImpl = fixedPayloadFetch(FAKE_ONNX_BYTES);
    const result = await ensureModelDownloaded({ home, allowDownload: true, fetchImpl });

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.cached).toBe(false);
    expect(result.variant).toBe("int8");
    expect(result.onnxPath).toBe(
      path.join(home, "models", "kompress", "kompress-int8-wo.onnx")
    );
    expect(result.tokenizerDir).toBe(path.join(home, "models", "kompress", "tokenizer"));

    expect(existsSync(result.onnxPath)).toBe(true);
    expect(readFileSync(result.onnxPath)).toEqual(Buffer.from(FAKE_ONNX_BYTES));

    for (const f of ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"]) {
      expect(existsSync(path.join(result.tokenizerDir, f))).toBe(true);
    }

    // fetchImpl called once per file: 1 onnx + 3 tokenizer files.
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    // Resolved URLs are pinned to the documented commit SHA, not a floating ref.
    const calledUrls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0]
    );
    expect(calledUrls.some((u) => typeof u === "string" && u.includes("kompress-int8-wo.onnx"))).toBe(
      true
    );
    expect(
      calledUrls.every(
        (u) =>
          typeof u === "string" &&
          u.includes("b1563631b35bfdcee37587ad530147497d820d4c") &&
          u.startsWith("https://huggingface.co/chopratejas/kompress-v2-base/resolve/")
      )
    ).toBe(true);
  });

  it("writes the onnx file atomically (no leftover temp files after a successful download)", async () => {
    const fetchImpl = fixedPayloadFetch(FAKE_ONNX_BYTES);
    await ensureModelDownloaded({ home, allowDownload: true, fetchImpl });

    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(path.join(home, "models", "kompress"));
    expect(entries.some((e) => e.includes(".optiflow-tmp-"))).toBe(false);
  });

  it("resolves the fp32 variant to a distinct local filename", async () => {
    const fetchImpl = fixedPayloadFetch(FAKE_ONNX_BYTES);
    const result = await ensureModelDownloaded({ home, allowDownload: true, variant: "fp32", fetchImpl });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.onnxPath).toBe(path.join(home, "models", "kompress", "kompress-fp32.onnx"));
    const calledUrls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0]
    );
    expect(calledUrls.some((u) => typeof u === "string" && u.includes("kompress-fp32.onnx"))).toBe(true);
  });
});

describe("ensureModelDownloaded — already cached, skip download", () => {
  it("does not call fetchImpl again once every file is already cached", async () => {
    const firstFetch = fixedPayloadFetch(FAKE_ONNX_BYTES);
    const first = await ensureModelDownloaded({ home, allowDownload: true, fetchImpl: firstFetch });
    expect(first.available).toBe(true);
    expect(firstFetch).toHaveBeenCalledTimes(4);

    const secondFetch = vi.fn();
    const second = await ensureModelDownloaded({
      home,
      allowDownload: true,
      fetchImpl: secondFetch as unknown as KompressFetch,
    });

    expect(second.available).toBe(true);
    if (second.available) expect(second.cached).toBe(true);
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it("reports available:true with cached:true even when allowDownload is false, once cached", async () => {
    const firstFetch = fixedPayloadFetch(FAKE_ONNX_BYTES);
    await ensureModelDownloaded({ home, allowDownload: true, fetchImpl: firstFetch });

    const secondFetch = vi.fn();
    const second = await ensureModelDownloaded({
      home,
      allowDownload: false,
      fetchImpl: secondFetch as unknown as KompressFetch,
    });
    expect(second.available).toBe(true);
    expect(secondFetch).not.toHaveBeenCalled();
  });
});

describe("ensureModelDownloaded — failure handling", () => {
  it("returns available:false without throwing on an HTTP error response, and leaves no file behind", async () => {
    const fetchImpl: KompressFetch = vi.fn(async () => fakeResponse(FAKE_ONNX_BYTES, { ok: false, status: 404 }));

    const result = await ensureModelDownloaded({ home, allowDownload: true, fetchImpl });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/404/);

    expect(existsSync(path.join(home, "models", "kompress", "kompress-int8-wo.onnx"))).toBe(false);
  });

  it("returns available:false and cleans up the temp file on a content-length size mismatch", async () => {
    const fetchImpl: KompressFetch = vi.fn(async () =>
      fakeResponse(FAKE_ONNX_BYTES, { contentLengthOverride: FAKE_ONNX_BYTES.length + 1000 })
    );

    const result = await ensureModelDownloaded({ home, allowDownload: true, fetchImpl });
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/size mismatch/);

    const onnxPath = path.join(home, "models", "kompress", "kompress-int8-wo.onnx");
    expect(existsSync(onnxPath)).toBe(false);

    const { readdirSync } = await import("node:fs");
    const kompressDir = path.join(home, "models", "kompress");
    if (existsSync(kompressDir)) {
      const entries = readdirSync(kompressDir);
      expect(entries.some((e) => e.includes(".optiflow-tmp-"))).toBe(false);
    }
  });

  it("never throws when fetchImpl itself rejects (network error)", async () => {
    const fetchImpl: KompressFetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    await expect(ensureModelDownloaded({ home, allowDownload: true, fetchImpl })).resolves.toEqual(
      expect.objectContaining({ available: false })
    );
  });
});
