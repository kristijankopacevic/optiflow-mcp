/* @ts-self-types="./headroom_wasm.d.ts" */

/**
 * Minimal exported stub retained from Phase 1. Confirms wasm-bindgen
 * glue + the linked `headroom-core` dependency both work end to end
 * from Node; harmless to keep alongside the real `smart_crush` export.
 * @returns {string}
 */
function ping() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.ping();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.ping = ping;

/**
 * Real SmartCrusher compression, exported for Node.
 *
 * `content` is the raw text/JSON to compress; `query` is optional
 * relevance-scoring context (`""` is a valid default when there's no
 * specific query); `bias` steers `compute_optimal_k`'s adaptive sizing
 * (`0.0` is the real production default — see `transforms/live_zone.rs`'s
 * `DEFAULT_BIAS` constant, used at its own real `SmartCrusher::crush`
 * call sites; note `crusher.rs`'s own unit tests instead pass `1.0`, but
 * that is test-suite convention, not evidence of a production default —
 * this wrapper follows the production call site).
 *
 * Returns a JSON string (not a wasm-bindgen struct-with-getters) because
 * `CrushResult` (`smart_crusher/types.rs`) has no `#[derive(Serialize)]`
 * today — round-tripping through a hand-built `serde_json::Value` here
 * is the least wasm-bindgen ceremony for a first correct version. The
 * JSON shape mirrors `CrushResult` exactly:
 * `{"compressed": string, "original": string, "wasModified": bool,
 * "strategy": string}`. The TS side (`src/native/smart-crusher.ts`)
 * `JSON.parse`s this.
 *
 * A fresh `SmartCrusher` is constructed on every call (simplicity over
 * per-call construction overhead — an optimization for a later phase
 * if profiling ever shows it matters).
 * @param {string} content
 * @param {string} query
 * @param {number} bias
 * @returns {string}
 */
function smart_crush(content, query, bias) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.smart_crush(ptr0, len0, ptr1, len1, bias);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.smart_crush = smart_crush;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./headroom_wasm_bg.js": import0,
    };
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/headroom_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
