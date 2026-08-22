var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err2) => function __init() {
  if (err2) throw err2[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err2 = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/web-tree-sitter/tree-sitter.js
var require_tree_sitter = __commonJS({
  "node_modules/web-tree-sitter/tree-sitter.js"(exports, module) {
    var Module = typeof Module != "undefined" ? Module : {};
    var ENVIRONMENT_IS_WEB = typeof window == "object";
    var ENVIRONMENT_IS_WORKER = typeof importScripts == "function";
    var ENVIRONMENT_IS_NODE = typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string";
    if (ENVIRONMENT_IS_NODE) {
    }
    var TreeSitter = (function() {
      var initPromise;
      var document = typeof window == "object" ? {
        currentScript: window.document.currentScript
      } : null;
      class Parser {
        constructor() {
          this.initialize();
        }
        initialize() {
          throw new Error("cannot construct a Parser before calling `init()`");
        }
        static init(moduleOptions) {
          if (initPromise) return initPromise;
          Module = Object.assign({}, Module, moduleOptions);
          return initPromise = new Promise((resolveInitPromise) => {
            var moduleOverrides = Object.assign({}, Module);
            var arguments_ = [];
            var thisProgram = "./this.program";
            var quit_ = (status, toThrow) => {
              throw toThrow;
            };
            var scriptDirectory = "";
            function locateFile(path3) {
              if (Module["locateFile"]) {
                return Module["locateFile"](path3, scriptDirectory);
              }
              return scriptDirectory + path3;
            }
            var readAsync, readBinary;
            if (ENVIRONMENT_IS_NODE) {
              var fs = __require("fs");
              var nodePath = __require("path");
              scriptDirectory = __dirname + "/";
              readBinary = (filename) => {
                filename = isFileURI(filename) ? new URL(filename) : nodePath.normalize(filename);
                var ret = fs.readFileSync(filename);
                return ret;
              };
              readAsync = (filename, binary2 = true) => {
                filename = isFileURI(filename) ? new URL(filename) : nodePath.normalize(filename);
                return new Promise((resolve2, reject) => {
                  fs.readFile(filename, binary2 ? void 0 : "utf8", (err2, data) => {
                    if (err2) reject(err2);
                    else resolve2(binary2 ? data.buffer : data);
                  });
                });
              };
              if (!Module["thisProgram"] && process.argv.length > 1) {
                thisProgram = process.argv[1].replace(/\\/g, "/");
              }
              arguments_ = process.argv.slice(2);
              if (typeof module != "undefined") {
                module["exports"] = Module;
              }
              quit_ = (status, toThrow) => {
                process.exitCode = status;
                throw toThrow;
              };
            } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
              if (ENVIRONMENT_IS_WORKER) {
                scriptDirectory = self.location.href;
              } else if (typeof document != "undefined" && document.currentScript) {
                scriptDirectory = document.currentScript.src;
              }
              if (scriptDirectory.startsWith("blob:")) {
                scriptDirectory = "";
              } else {
                scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
              }
              {
                if (ENVIRONMENT_IS_WORKER) {
                  readBinary = (url) => {
                    var xhr = new XMLHttpRequest();
                    xhr.open("GET", url, false);
                    xhr.responseType = "arraybuffer";
                    xhr.send(null);
                    return new Uint8Array(
                      /** @type{!ArrayBuffer} */
                      xhr.response
                    );
                  };
                }
                readAsync = (url) => {
                  if (isFileURI(url)) {
                    return new Promise((reject, resolve2) => {
                      var xhr = new XMLHttpRequest();
                      xhr.open("GET", url, true);
                      xhr.responseType = "arraybuffer";
                      xhr.onload = () => {
                        if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                          resolve2(xhr.response);
                        }
                        reject(xhr.status);
                      };
                      xhr.onerror = reject;
                      xhr.send(null);
                    });
                  }
                  return fetch(url, {
                    credentials: "same-origin"
                  }).then((response) => {
                    if (response.ok) {
                      return response.arrayBuffer();
                    }
                    return Promise.reject(new Error(response.status + " : " + response.url));
                  });
                };
              }
            } else {
            }
            var out = Module["print"] || console.log.bind(console);
            var err = Module["printErr"] || console.error.bind(console);
            Object.assign(Module, moduleOverrides);
            moduleOverrides = null;
            if (Module["arguments"]) arguments_ = Module["arguments"];
            if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
            if (Module["quit"]) quit_ = Module["quit"];
            var dynamicLibraries = Module["dynamicLibraries"] || [];
            var wasmBinary;
            if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
            var wasmMemory;
            var ABORT = false;
            var EXITSTATUS;
            var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
            var HEAP_DATA_VIEW;
            function updateMemoryViews() {
              var b = wasmMemory.buffer;
              Module["HEAP_DATA_VIEW"] = HEAP_DATA_VIEW = new DataView(b);
              Module["HEAP8"] = HEAP8 = new Int8Array(b);
              Module["HEAP16"] = HEAP16 = new Int16Array(b);
              Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
              Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
              Module["HEAP32"] = HEAP32 = new Int32Array(b);
              Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
              Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
              Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
            }
            if (Module["wasmMemory"]) {
              wasmMemory = Module["wasmMemory"];
            } else {
              var INITIAL_MEMORY = Module["INITIAL_MEMORY"] || 33554432;
              wasmMemory = new WebAssembly.Memory({
                "initial": INITIAL_MEMORY / 65536,
                // In theory we should not need to emit the maximum if we want "unlimited"
                // or 4GB of memory, but VMs error on that atm, see
                // https://github.com/emscripten-core/emscripten/issues/14130
                // And in the pthreads case we definitely need to emit a maximum. So
                // always emit one.
                "maximum": 2147483648 / 65536
              });
            }
            updateMemoryViews();
            var __ATPRERUN__ = [];
            var __ATINIT__ = [];
            var __ATMAIN__ = [];
            var __ATPOSTRUN__ = [];
            var __RELOC_FUNCS__ = [];
            var runtimeInitialized = false;
            function preRun() {
              if (Module["preRun"]) {
                if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
                while (Module["preRun"].length) {
                  addOnPreRun(Module["preRun"].shift());
                }
              }
              callRuntimeCallbacks(__ATPRERUN__);
            }
            function initRuntime() {
              runtimeInitialized = true;
              callRuntimeCallbacks(__RELOC_FUNCS__);
              callRuntimeCallbacks(__ATINIT__);
            }
            function preMain() {
              callRuntimeCallbacks(__ATMAIN__);
            }
            function postRun() {
              if (Module["postRun"]) {
                if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
                while (Module["postRun"].length) {
                  addOnPostRun(Module["postRun"].shift());
                }
              }
              callRuntimeCallbacks(__ATPOSTRUN__);
            }
            function addOnPreRun(cb) {
              __ATPRERUN__.unshift(cb);
            }
            function addOnInit(cb) {
              __ATINIT__.unshift(cb);
            }
            function addOnPostRun(cb) {
              __ATPOSTRUN__.unshift(cb);
            }
            var runDependencies = 0;
            var runDependencyWatcher = null;
            var dependenciesFulfilled = null;
            function getUniqueRunDependency(id) {
              return id;
            }
            function addRunDependency(id) {
              runDependencies++;
              Module["monitorRunDependencies"]?.(runDependencies);
            }
            function removeRunDependency(id) {
              runDependencies--;
              Module["monitorRunDependencies"]?.(runDependencies);
              if (runDependencies == 0) {
                if (runDependencyWatcher !== null) {
                  clearInterval(runDependencyWatcher);
                  runDependencyWatcher = null;
                }
                if (dependenciesFulfilled) {
                  var callback = dependenciesFulfilled;
                  dependenciesFulfilled = null;
                  callback();
                }
              }
            }
            function abort(what) {
              Module["onAbort"]?.(what);
              what = "Aborted(" + what + ")";
              err(what);
              ABORT = true;
              EXITSTATUS = 1;
              what += ". Build with -sASSERTIONS for more info.";
              var e = new WebAssembly.RuntimeError(what);
              throw e;
            }
            var dataURIPrefix = "data:application/octet-stream;base64,";
            var isDataURI = (filename) => filename.startsWith(dataURIPrefix);
            var isFileURI = (filename) => filename.startsWith("file://");
            function findWasmBinary() {
              var f = "tree-sitter.wasm";
              if (!isDataURI(f)) {
                return locateFile(f);
              }
              return f;
            }
            var wasmBinaryFile;
            function getBinarySync(file) {
              if (file == wasmBinaryFile && wasmBinary) {
                return new Uint8Array(wasmBinary);
              }
              if (readBinary) {
                return readBinary(file);
              }
              throw "both async and sync fetching of the wasm failed";
            }
            function getBinaryPromise(binaryFile) {
              if (!wasmBinary) {
                return readAsync(binaryFile).then(
                  (response) => new Uint8Array(
                    /** @type{!ArrayBuffer} */
                    response
                  ),
                  // Fall back to getBinarySync if readAsync fails
                  () => getBinarySync(binaryFile)
                );
              }
              return Promise.resolve().then(() => getBinarySync(binaryFile));
            }
            function instantiateArrayBuffer(binaryFile, imports, receiver) {
              return getBinaryPromise(binaryFile).then((binary2) => WebAssembly.instantiate(binary2, imports)).then(receiver, (reason) => {
                err(`failed to asynchronously prepare wasm: ${reason}`);
                abort(reason);
              });
            }
            function instantiateAsync(binary2, binaryFile, imports, callback) {
              if (!binary2 && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(binaryFile) && // Don't use streaming for file:// delivered objects in a webview, fetch them synchronously.
              !isFileURI(binaryFile) && // Avoid instantiateStreaming() on Node.js environment for now, as while
              // Node.js v18.1.0 implements it, it does not have a full fetch()
              // implementation yet.
              // Reference:
              //   https://github.com/emscripten-core/emscripten/pull/16917
              !ENVIRONMENT_IS_NODE && typeof fetch == "function") {
                return fetch(binaryFile, {
                  credentials: "same-origin"
                }).then((response) => {
                  var result = WebAssembly.instantiateStreaming(response, imports);
                  return result.then(callback, function(reason) {
                    err(`wasm streaming compile failed: ${reason}`);
                    err("falling back to ArrayBuffer instantiation");
                    return instantiateArrayBuffer(binaryFile, imports, callback);
                  });
                });
              }
              return instantiateArrayBuffer(binaryFile, imports, callback);
            }
            function getWasmImports() {
              return {
                "env": wasmImports,
                "wasi_snapshot_preview1": wasmImports,
                "GOT.mem": new Proxy(wasmImports, GOTHandler),
                "GOT.func": new Proxy(wasmImports, GOTHandler)
              };
            }
            function createWasm() {
              var info2 = getWasmImports();
              function receiveInstance(instance2, module2) {
                wasmExports = instance2.exports;
                wasmExports = relocateExports(wasmExports, 1024);
                var metadata2 = getDylinkMetadata(module2);
                if (metadata2.neededDynlibs) {
                  dynamicLibraries = metadata2.neededDynlibs.concat(dynamicLibraries);
                }
                mergeLibSymbols(wasmExports, "main");
                LDSO.init();
                loadDylibs();
                addOnInit(wasmExports["__wasm_call_ctors"]);
                __RELOC_FUNCS__.push(wasmExports["__wasm_apply_data_relocs"]);
                removeRunDependency("wasm-instantiate");
                return wasmExports;
              }
              addRunDependency("wasm-instantiate");
              function receiveInstantiationResult(result) {
                receiveInstance(result["instance"], result["module"]);
              }
              if (Module["instantiateWasm"]) {
                try {
                  return Module["instantiateWasm"](info2, receiveInstance);
                } catch (e) {
                  err(`Module.instantiateWasm callback failed with error: ${e}`);
                  return false;
                }
              }
              if (!wasmBinaryFile) wasmBinaryFile = findWasmBinary();
              instantiateAsync(wasmBinary, wasmBinaryFile, info2, receiveInstantiationResult);
              return {};
            }
            var ASM_CONSTS = {};
            function ExitStatus(status) {
              this.name = "ExitStatus";
              this.message = `Program terminated with exit(${status})`;
              this.status = status;
            }
            var GOT = {};
            var currentModuleWeakSymbols = /* @__PURE__ */ new Set([]);
            var GOTHandler = {
              get(obj, symName) {
                var rtn = GOT[symName];
                if (!rtn) {
                  rtn = GOT[symName] = new WebAssembly.Global({
                    "value": "i32",
                    "mutable": true
                  });
                }
                if (!currentModuleWeakSymbols.has(symName)) {
                  rtn.required = true;
                }
                return rtn;
              }
            };
            var LE_HEAP_LOAD_F32 = (byteOffset) => HEAP_DATA_VIEW.getFloat32(byteOffset, true);
            var LE_HEAP_LOAD_F64 = (byteOffset) => HEAP_DATA_VIEW.getFloat64(byteOffset, true);
            var LE_HEAP_LOAD_I16 = (byteOffset) => HEAP_DATA_VIEW.getInt16(byteOffset, true);
            var LE_HEAP_LOAD_I32 = (byteOffset) => HEAP_DATA_VIEW.getInt32(byteOffset, true);
            var LE_HEAP_LOAD_U32 = (byteOffset) => HEAP_DATA_VIEW.getUint32(byteOffset, true);
            var LE_HEAP_STORE_F32 = (byteOffset, value) => HEAP_DATA_VIEW.setFloat32(byteOffset, value, true);
            var LE_HEAP_STORE_F64 = (byteOffset, value) => HEAP_DATA_VIEW.setFloat64(byteOffset, value, true);
            var LE_HEAP_STORE_I16 = (byteOffset, value) => HEAP_DATA_VIEW.setInt16(byteOffset, value, true);
            var LE_HEAP_STORE_I32 = (byteOffset, value) => HEAP_DATA_VIEW.setInt32(byteOffset, value, true);
            var LE_HEAP_STORE_U32 = (byteOffset, value) => HEAP_DATA_VIEW.setUint32(byteOffset, value, true);
            var callRuntimeCallbacks = (callbacks) => {
              while (callbacks.length > 0) {
                callbacks.shift()(Module);
              }
            };
            var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder() : void 0;
            var UTF8ArrayToString = (heapOrArray, idx, maxBytesToRead) => {
              var endIdx = idx + maxBytesToRead;
              var endPtr = idx;
              while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;
              if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
                return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
              }
              var str = "";
              while (idx < endPtr) {
                var u0 = heapOrArray[idx++];
                if (!(u0 & 128)) {
                  str += String.fromCharCode(u0);
                  continue;
                }
                var u1 = heapOrArray[idx++] & 63;
                if ((u0 & 224) == 192) {
                  str += String.fromCharCode((u0 & 31) << 6 | u1);
                  continue;
                }
                var u2 = heapOrArray[idx++] & 63;
                if ((u0 & 240) == 224) {
                  u0 = (u0 & 15) << 12 | u1 << 6 | u2;
                } else {
                  u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
                }
                if (u0 < 65536) {
                  str += String.fromCharCode(u0);
                } else {
                  var ch = u0 - 65536;
                  str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
                }
              }
              return str;
            };
            var getDylinkMetadata = (binary2) => {
              var offset = 0;
              var end = 0;
              function getU8() {
                return binary2[offset++];
              }
              function getLEB() {
                var ret = 0;
                var mul = 1;
                while (1) {
                  var byte = binary2[offset++];
                  ret += (byte & 127) * mul;
                  mul *= 128;
                  if (!(byte & 128)) break;
                }
                return ret;
              }
              function getString() {
                var len = getLEB();
                offset += len;
                return UTF8ArrayToString(binary2, offset - len, len);
              }
              function failIf(condition, message) {
                if (condition) throw new Error(message);
              }
              var name2 = "dylink.0";
              if (binary2 instanceof WebAssembly.Module) {
                var dylinkSection = WebAssembly.Module.customSections(binary2, name2);
                if (dylinkSection.length === 0) {
                  name2 = "dylink";
                  dylinkSection = WebAssembly.Module.customSections(binary2, name2);
                }
                failIf(dylinkSection.length === 0, "need dylink section");
                binary2 = new Uint8Array(dylinkSection[0]);
                end = binary2.length;
              } else {
                var int32View = new Uint32Array(new Uint8Array(binary2.subarray(0, 24)).buffer);
                var magicNumberFound = int32View[0] == 1836278016 || int32View[0] == 6386541;
                failIf(!magicNumberFound, "need to see wasm magic number");
                failIf(binary2[8] !== 0, "need the dylink section to be first");
                offset = 9;
                var section_size = getLEB();
                end = offset + section_size;
                name2 = getString();
              }
              var customSection = {
                neededDynlibs: [],
                tlsExports: /* @__PURE__ */ new Set(),
                weakImports: /* @__PURE__ */ new Set()
              };
              if (name2 == "dylink") {
                customSection.memorySize = getLEB();
                customSection.memoryAlign = getLEB();
                customSection.tableSize = getLEB();
                customSection.tableAlign = getLEB();
                var neededDynlibsCount = getLEB();
                for (var i2 = 0; i2 < neededDynlibsCount; ++i2) {
                  var libname = getString();
                  customSection.neededDynlibs.push(libname);
                }
              } else {
                failIf(name2 !== "dylink.0");
                var WASM_DYLINK_MEM_INFO = 1;
                var WASM_DYLINK_NEEDED = 2;
                var WASM_DYLINK_EXPORT_INFO = 3;
                var WASM_DYLINK_IMPORT_INFO = 4;
                var WASM_SYMBOL_TLS = 256;
                var WASM_SYMBOL_BINDING_MASK = 3;
                var WASM_SYMBOL_BINDING_WEAK = 1;
                while (offset < end) {
                  var subsectionType = getU8();
                  var subsectionSize = getLEB();
                  if (subsectionType === WASM_DYLINK_MEM_INFO) {
                    customSection.memorySize = getLEB();
                    customSection.memoryAlign = getLEB();
                    customSection.tableSize = getLEB();
                    customSection.tableAlign = getLEB();
                  } else if (subsectionType === WASM_DYLINK_NEEDED) {
                    var neededDynlibsCount = getLEB();
                    for (var i2 = 0; i2 < neededDynlibsCount; ++i2) {
                      libname = getString();
                      customSection.neededDynlibs.push(libname);
                    }
                  } else if (subsectionType === WASM_DYLINK_EXPORT_INFO) {
                    var count = getLEB();
                    while (count--) {
                      var symname = getString();
                      var flags2 = getLEB();
                      if (flags2 & WASM_SYMBOL_TLS) {
                        customSection.tlsExports.add(symname);
                      }
                    }
                  } else if (subsectionType === WASM_DYLINK_IMPORT_INFO) {
                    var count = getLEB();
                    while (count--) {
                      var modname = getString();
                      var symname = getString();
                      var flags2 = getLEB();
                      if ((flags2 & WASM_SYMBOL_BINDING_MASK) == WASM_SYMBOL_BINDING_WEAK) {
                        customSection.weakImports.add(symname);
                      }
                    }
                  } else {
                    offset += subsectionSize;
                  }
                }
              }
              return customSection;
            };
            function getValue(ptr, type = "i8") {
              if (type.endsWith("*")) type = "*";
              switch (type) {
                case "i1":
                  return HEAP8[ptr];
                case "i8":
                  return HEAP8[ptr];
                case "i16":
                  return LE_HEAP_LOAD_I16((ptr >> 1) * 2);
                case "i32":
                  return LE_HEAP_LOAD_I32((ptr >> 2) * 4);
                case "i64":
                  abort("to do getValue(i64) use WASM_BIGINT");
                case "float":
                  return LE_HEAP_LOAD_F32((ptr >> 2) * 4);
                case "double":
                  return LE_HEAP_LOAD_F64((ptr >> 3) * 8);
                case "*":
                  return LE_HEAP_LOAD_U32((ptr >> 2) * 4);
                default:
                  abort(`invalid type for getValue: ${type}`);
              }
            }
            var newDSO = (name2, handle2, syms) => {
              var dso = {
                refcount: Infinity,
                name: name2,
                exports: syms,
                global: true
              };
              LDSO.loadedLibsByName[name2] = dso;
              if (handle2 != void 0) {
                LDSO.loadedLibsByHandle[handle2] = dso;
              }
              return dso;
            };
            var LDSO = {
              loadedLibsByName: {},
              loadedLibsByHandle: {},
              init() {
                newDSO("__main__", 0, wasmImports);
              }
            };
            var ___heap_base = 78112;
            var zeroMemory = (address, size) => {
              HEAPU8.fill(0, address, address + size);
              return address;
            };
            var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
            var getMemory = (size) => {
              if (runtimeInitialized) {
                return zeroMemory(_malloc(size), size);
              }
              var ret = ___heap_base;
              var end = ret + alignMemory(size, 16);
              ___heap_base = end;
              GOT["__heap_base"].value = end;
              return ret;
            };
            var isInternalSym = (symName) => ["__cpp_exception", "__c_longjmp", "__wasm_apply_data_relocs", "__dso_handle", "__tls_size", "__tls_align", "__set_stack_limits", "_emscripten_tls_init", "__wasm_init_tls", "__wasm_call_ctors", "__start_em_asm", "__stop_em_asm", "__start_em_js", "__stop_em_js"].includes(symName) || symName.startsWith("__em_js__");
            var uleb128Encode = (n, target) => {
              if (n < 128) {
                target.push(n);
              } else {
                target.push(n % 128 | 128, n >> 7);
              }
            };
            var sigToWasmTypes = (sig) => {
              var typeNames = {
                "i": "i32",
                "j": "i64",
                "f": "f32",
                "d": "f64",
                "e": "externref",
                "p": "i32"
              };
              var type = {
                parameters: [],
                results: sig[0] == "v" ? [] : [typeNames[sig[0]]]
              };
              for (var i2 = 1; i2 < sig.length; ++i2) {
                type.parameters.push(typeNames[sig[i2]]);
              }
              return type;
            };
            var generateFuncType = (sig, target) => {
              var sigRet = sig.slice(0, 1);
              var sigParam = sig.slice(1);
              var typeCodes = {
                "i": 127,
                // i32
                "p": 127,
                // i32
                "j": 126,
                // i64
                "f": 125,
                // f32
                "d": 124,
                // f64
                "e": 111
              };
              target.push(96);
              uleb128Encode(sigParam.length, target);
              for (var i2 = 0; i2 < sigParam.length; ++i2) {
                target.push(typeCodes[sigParam[i2]]);
              }
              if (sigRet == "v") {
                target.push(0);
              } else {
                target.push(1, typeCodes[sigRet]);
              }
            };
            var convertJsFunctionToWasm = (func2, sig) => {
              if (typeof WebAssembly.Function == "function") {
                return new WebAssembly.Function(sigToWasmTypes(sig), func2);
              }
              var typeSectionBody = [1];
              generateFuncType(sig, typeSectionBody);
              var bytes = [
                0,
                97,
                115,
                109,
                // magic ("\0asm")
                1,
                0,
                0,
                0,
                // version: 1
                1
              ];
              uleb128Encode(typeSectionBody.length, bytes);
              bytes.push(...typeSectionBody);
              bytes.push(
                2,
                7,
                // import section
                // (import "e" "f" (func 0 (type 0)))
                1,
                1,
                101,
                1,
                102,
                0,
                0,
                7,
                5,
                // export section
                // (export "f" (func 0 (type 0)))
                1,
                1,
                102,
                0,
                0
              );
              var module2 = new WebAssembly.Module(new Uint8Array(bytes));
              var instance2 = new WebAssembly.Instance(module2, {
                "e": {
                  "f": func2
                }
              });
              var wrappedFunc = instance2.exports["f"];
              return wrappedFunc;
            };
            var wasmTableMirror = [];
            var wasmTable = new WebAssembly.Table({
              "initial": 28,
              "element": "anyfunc"
            });
            var getWasmTableEntry = (funcPtr) => {
              var func2 = wasmTableMirror[funcPtr];
              if (!func2) {
                if (funcPtr >= wasmTableMirror.length) wasmTableMirror.length = funcPtr + 1;
                wasmTableMirror[funcPtr] = func2 = wasmTable.get(funcPtr);
              }
              return func2;
            };
            var updateTableMap = (offset, count) => {
              if (functionsInTableMap) {
                for (var i2 = offset; i2 < offset + count; i2++) {
                  var item = getWasmTableEntry(i2);
                  if (item) {
                    functionsInTableMap.set(item, i2);
                  }
                }
              }
            };
            var functionsInTableMap;
            var getFunctionAddress = (func2) => {
              if (!functionsInTableMap) {
                functionsInTableMap = /* @__PURE__ */ new WeakMap();
                updateTableMap(0, wasmTable.length);
              }
              return functionsInTableMap.get(func2) || 0;
            };
            var freeTableIndexes = [];
            var getEmptyTableSlot = () => {
              if (freeTableIndexes.length) {
                return freeTableIndexes.pop();
              }
              try {
                wasmTable.grow(1);
              } catch (err2) {
                if (!(err2 instanceof RangeError)) {
                  throw err2;
                }
                throw "Unable to grow wasm table. Set ALLOW_TABLE_GROWTH.";
              }
              return wasmTable.length - 1;
            };
            var setWasmTableEntry = (idx, func2) => {
              wasmTable.set(idx, func2);
              wasmTableMirror[idx] = wasmTable.get(idx);
            };
            var addFunction = (func2, sig) => {
              var rtn = getFunctionAddress(func2);
              if (rtn) {
                return rtn;
              }
              var ret = getEmptyTableSlot();
              try {
                setWasmTableEntry(ret, func2);
              } catch (err2) {
                if (!(err2 instanceof TypeError)) {
                  throw err2;
                }
                var wrapped = convertJsFunctionToWasm(func2, sig);
                setWasmTableEntry(ret, wrapped);
              }
              functionsInTableMap.set(func2, ret);
              return ret;
            };
            var updateGOT = (exports2, replace) => {
              for (var symName in exports2) {
                if (isInternalSym(symName)) {
                  continue;
                }
                var value = exports2[symName];
                if (symName.startsWith("orig$")) {
                  symName = symName.split("$")[1];
                  replace = true;
                }
                GOT[symName] ||= new WebAssembly.Global({
                  "value": "i32",
                  "mutable": true
                });
                if (replace || GOT[symName].value == 0) {
                  if (typeof value == "function") {
                    GOT[symName].value = addFunction(value);
                  } else if (typeof value == "number") {
                    GOT[symName].value = value;
                  } else {
                    err(`unhandled export type for '${symName}': ${typeof value}`);
                  }
                }
              }
            };
            var relocateExports = (exports2, memoryBase2, replace) => {
              var relocated = {};
              for (var e in exports2) {
                var value = exports2[e];
                if (typeof value == "object") {
                  value = value.value;
                }
                if (typeof value == "number") {
                  value += memoryBase2;
                }
                relocated[e] = value;
              }
              updateGOT(relocated, replace);
              return relocated;
            };
            var isSymbolDefined = (symName) => {
              var existing = wasmImports[symName];
              if (!existing || existing.stub) {
                return false;
              }
              return true;
            };
            var dynCallLegacy = (sig, ptr, args2) => {
              sig = sig.replace(/p/g, "i");
              var f = Module["dynCall_" + sig];
              return f(ptr, ...args2);
            };
            var dynCall = (sig, ptr, args2 = []) => {
              if (sig.includes("j")) {
                return dynCallLegacy(sig, ptr, args2);
              }
              var rtn = getWasmTableEntry(ptr)(...args2);
              return rtn;
            };
            var stackSave = () => _emscripten_stack_get_current();
            var stackRestore = (val) => __emscripten_stack_restore(val);
            var createInvokeFunction = (sig) => (ptr, ...args2) => {
              var sp = stackSave();
              try {
                return dynCall(sig, ptr, args2);
              } catch (e) {
                stackRestore(sp);
                if (e !== e + 0) throw e;
                _setThrew(1, 0);
              }
            };
            var resolveGlobalSymbol = (symName, direct = false) => {
              var sym;
              if (direct && "orig$" + symName in wasmImports) {
                symName = "orig$" + symName;
              }
              if (isSymbolDefined(symName)) {
                sym = wasmImports[symName];
              } else if (symName.startsWith("invoke_")) {
                sym = wasmImports[symName] = createInvokeFunction(symName.split("_")[1]);
              }
              return {
                sym,
                name: symName
              };
            };
            var UTF8ToString = (ptr, maxBytesToRead) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
            var loadWebAssemblyModule = (binary, flags, libName, localScope, handle) => {
              var metadata = getDylinkMetadata(binary);
              currentModuleWeakSymbols = metadata.weakImports;
              function loadModule() {
                var firstLoad = !handle || !HEAP8[handle + 8];
                if (firstLoad) {
                  var memAlign = Math.pow(2, metadata.memoryAlign);
                  var memoryBase = metadata.memorySize ? alignMemory(getMemory(metadata.memorySize + memAlign), memAlign) : 0;
                  var tableBase = metadata.tableSize ? wasmTable.length : 0;
                  if (handle) {
                    HEAP8[handle + 8] = 1;
                    LE_HEAP_STORE_U32((handle + 12 >> 2) * 4, memoryBase);
                    LE_HEAP_STORE_I32((handle + 16 >> 2) * 4, metadata.memorySize);
                    LE_HEAP_STORE_U32((handle + 20 >> 2) * 4, tableBase);
                    LE_HEAP_STORE_I32((handle + 24 >> 2) * 4, metadata.tableSize);
                  }
                } else {
                  memoryBase = LE_HEAP_LOAD_U32((handle + 12 >> 2) * 4);
                  tableBase = LE_HEAP_LOAD_U32((handle + 20 >> 2) * 4);
                }
                var tableGrowthNeeded = tableBase + metadata.tableSize - wasmTable.length;
                if (tableGrowthNeeded > 0) {
                  wasmTable.grow(tableGrowthNeeded);
                }
                var moduleExports;
                function resolveSymbol(sym) {
                  var resolved = resolveGlobalSymbol(sym).sym;
                  if (!resolved && localScope) {
                    resolved = localScope[sym];
                  }
                  if (!resolved) {
                    resolved = moduleExports[sym];
                  }
                  return resolved;
                }
                var proxyHandler = {
                  get(stubs, prop) {
                    switch (prop) {
                      case "__memory_base":
                        return memoryBase;
                      case "__table_base":
                        return tableBase;
                    }
                    if (prop in wasmImports && !wasmImports[prop].stub) {
                      return wasmImports[prop];
                    }
                    if (!(prop in stubs)) {
                      var resolved;
                      stubs[prop] = (...args2) => {
                        resolved ||= resolveSymbol(prop);
                        return resolved(...args2);
                      };
                    }
                    return stubs[prop];
                  }
                };
                var proxy = new Proxy({}, proxyHandler);
                var info = {
                  "GOT.mem": new Proxy({}, GOTHandler),
                  "GOT.func": new Proxy({}, GOTHandler),
                  "env": proxy,
                  "wasi_snapshot_preview1": proxy
                };
                function postInstantiation(module, instance) {
                  updateTableMap(tableBase, metadata.tableSize);
                  moduleExports = relocateExports(instance.exports, memoryBase);
                  if (!flags.allowUndefined) {
                    reportUndefinedSymbols();
                  }
                  function addEmAsm(addr, body) {
                    var args = [];
                    var arity = 0;
                    for (; arity < 16; arity++) {
                      if (body.indexOf("$" + arity) != -1) {
                        args.push("$" + arity);
                      } else {
                        break;
                      }
                    }
                    args = args.join(",");
                    var func = `(${args}) => { ${body} };`;
                    ASM_CONSTS[start] = eval(func);
                  }
                  if ("__start_em_asm" in moduleExports) {
                    var start = moduleExports["__start_em_asm"];
                    var stop = moduleExports["__stop_em_asm"];
                    while (start < stop) {
                      var jsString = UTF8ToString(start);
                      addEmAsm(start, jsString);
                      start = HEAPU8.indexOf(0, start) + 1;
                    }
                  }
                  function addEmJs(name, cSig, body) {
                    var jsArgs = [];
                    cSig = cSig.slice(1, -1);
                    if (cSig != "void") {
                      cSig = cSig.split(",");
                      for (var i in cSig) {
                        var jsArg = cSig[i].split(" ").pop();
                        jsArgs.push(jsArg.replace("*", ""));
                      }
                    }
                    var func = `(${jsArgs}) => ${body};`;
                    moduleExports[name] = eval(func);
                  }
                  for (var name in moduleExports) {
                    if (name.startsWith("__em_js__")) {
                      var start = moduleExports[name];
                      var jsString = UTF8ToString(start);
                      var parts = jsString.split("<::>");
                      addEmJs(name.replace("__em_js__", ""), parts[0], parts[1]);
                      delete moduleExports[name];
                    }
                  }
                  var applyRelocs = moduleExports["__wasm_apply_data_relocs"];
                  if (applyRelocs) {
                    if (runtimeInitialized) {
                      applyRelocs();
                    } else {
                      __RELOC_FUNCS__.push(applyRelocs);
                    }
                  }
                  var init = moduleExports["__wasm_call_ctors"];
                  if (init) {
                    if (runtimeInitialized) {
                      init();
                    } else {
                      __ATINIT__.push(init);
                    }
                  }
                  return moduleExports;
                }
                if (flags.loadAsync) {
                  if (binary instanceof WebAssembly.Module) {
                    var instance = new WebAssembly.Instance(binary, info);
                    return Promise.resolve(postInstantiation(binary, instance));
                  }
                  return WebAssembly.instantiate(binary, info).then((result) => postInstantiation(result.module, result.instance));
                }
                var module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(binary);
                var instance = new WebAssembly.Instance(module, info);
                return postInstantiation(module, instance);
              }
              if (flags.loadAsync) {
                return metadata.neededDynlibs.reduce((chain, dynNeeded) => chain.then(() => loadDynamicLibrary(dynNeeded, flags, localScope)), Promise.resolve()).then(loadModule);
              }
              metadata.neededDynlibs.forEach((needed) => loadDynamicLibrary(needed, flags, localScope));
              return loadModule();
            };
            var mergeLibSymbols = (exports2, libName2) => {
              for (var [sym, exp] of Object.entries(exports2)) {
                const setImport = (target) => {
                  if (!isSymbolDefined(target)) {
                    wasmImports[target] = exp;
                  }
                };
                setImport(sym);
                const main_alias = "__main_argc_argv";
                if (sym == "main") {
                  setImport(main_alias);
                }
                if (sym == main_alias) {
                  setImport("main");
                }
                if (sym.startsWith("dynCall_") && !Module.hasOwnProperty(sym)) {
                  Module[sym] = exp;
                }
              }
            };
            var asyncLoad = (url, onload, onerror, noRunDep) => {
              var dep = !noRunDep ? getUniqueRunDependency(`al ${url}`) : "";
              readAsync(url).then((arrayBuffer) => {
                onload(new Uint8Array(arrayBuffer));
                if (dep) removeRunDependency(dep);
              }, (err2) => {
                if (onerror) {
                  onerror();
                } else {
                  throw `Loading data file "${url}" failed.`;
                }
              });
              if (dep) addRunDependency(dep);
            };
            function loadDynamicLibrary(libName2, flags2 = {
              global: true,
              nodelete: true
            }, localScope2, handle2) {
              var dso = LDSO.loadedLibsByName[libName2];
              if (dso) {
                if (!flags2.global) {
                  if (localScope2) {
                    Object.assign(localScope2, dso.exports);
                  }
                } else if (!dso.global) {
                  dso.global = true;
                  mergeLibSymbols(dso.exports, libName2);
                }
                if (flags2.nodelete && dso.refcount !== Infinity) {
                  dso.refcount = Infinity;
                }
                dso.refcount++;
                if (handle2) {
                  LDSO.loadedLibsByHandle[handle2] = dso;
                }
                return flags2.loadAsync ? Promise.resolve(true) : true;
              }
              dso = newDSO(libName2, handle2, "loading");
              dso.refcount = flags2.nodelete ? Infinity : 1;
              dso.global = flags2.global;
              function loadLibData() {
                if (handle2) {
                  var data = LE_HEAP_LOAD_U32((handle2 + 28 >> 2) * 4);
                  var dataSize = LE_HEAP_LOAD_U32((handle2 + 32 >> 2) * 4);
                  if (data && dataSize) {
                    var libData = HEAP8.slice(data, data + dataSize);
                    return flags2.loadAsync ? Promise.resolve(libData) : libData;
                  }
                }
                var libFile = locateFile(libName2);
                if (flags2.loadAsync) {
                  return new Promise(function(resolve2, reject) {
                    asyncLoad(libFile, resolve2, reject);
                  });
                }
                if (!readBinary) {
                  throw new Error(`${libFile}: file not found, and synchronous loading of external files is not available`);
                }
                return readBinary(libFile);
              }
              function getExports() {
                if (flags2.loadAsync) {
                  return loadLibData().then((libData) => loadWebAssemblyModule(libData, flags2, libName2, localScope2, handle2));
                }
                return loadWebAssemblyModule(loadLibData(), flags2, libName2, localScope2, handle2);
              }
              function moduleLoaded(exports2) {
                if (dso.global) {
                  mergeLibSymbols(exports2, libName2);
                } else if (localScope2) {
                  Object.assign(localScope2, exports2);
                }
                dso.exports = exports2;
              }
              if (flags2.loadAsync) {
                return getExports().then((exports2) => {
                  moduleLoaded(exports2);
                  return true;
                });
              }
              moduleLoaded(getExports());
              return true;
            }
            var reportUndefinedSymbols = () => {
              for (var [symName, entry] of Object.entries(GOT)) {
                if (entry.value == 0) {
                  var value = resolveGlobalSymbol(symName, true).sym;
                  if (!value && !entry.required) {
                    continue;
                  }
                  if (typeof value == "function") {
                    entry.value = addFunction(value, value.sig);
                  } else if (typeof value == "number") {
                    entry.value = value;
                  } else {
                    throw new Error(`bad export type for '${symName}': ${typeof value}`);
                  }
                }
              }
            };
            var loadDylibs = () => {
              if (!dynamicLibraries.length) {
                reportUndefinedSymbols();
                return;
              }
              addRunDependency("loadDylibs");
              dynamicLibraries.reduce((chain, lib) => chain.then(() => loadDynamicLibrary(lib, {
                loadAsync: true,
                global: true,
                nodelete: true,
                allowUndefined: true
              })), Promise.resolve()).then(() => {
                reportUndefinedSymbols();
                removeRunDependency("loadDylibs");
              });
            };
            var noExitRuntime = Module["noExitRuntime"] || true;
            function setValue(ptr, value, type = "i8") {
              if (type.endsWith("*")) type = "*";
              switch (type) {
                case "i1":
                  HEAP8[ptr] = value;
                  break;
                case "i8":
                  HEAP8[ptr] = value;
                  break;
                case "i16":
                  LE_HEAP_STORE_I16((ptr >> 1) * 2, value);
                  break;
                case "i32":
                  LE_HEAP_STORE_I32((ptr >> 2) * 4, value);
                  break;
                case "i64":
                  abort("to do setValue(i64) use WASM_BIGINT");
                case "float":
                  LE_HEAP_STORE_F32((ptr >> 2) * 4, value);
                  break;
                case "double":
                  LE_HEAP_STORE_F64((ptr >> 3) * 8, value);
                  break;
                case "*":
                  LE_HEAP_STORE_U32((ptr >> 2) * 4, value);
                  break;
                default:
                  abort(`invalid type for setValue: ${type}`);
              }
            }
            var ___memory_base = new WebAssembly.Global({
              "value": "i32",
              "mutable": false
            }, 1024);
            var ___stack_pointer = new WebAssembly.Global({
              "value": "i32",
              "mutable": true
            }, 78112);
            var ___table_base = new WebAssembly.Global({
              "value": "i32",
              "mutable": false
            }, 1);
            var __abort_js = () => {
              abort("");
            };
            __abort_js.sig = "v";
            var nowIsMonotonic = 1;
            var __emscripten_get_now_is_monotonic = () => nowIsMonotonic;
            __emscripten_get_now_is_monotonic.sig = "i";
            var __emscripten_memcpy_js = (dest, src, num) => HEAPU8.copyWithin(dest, src, src + num);
            __emscripten_memcpy_js.sig = "vppp";
            var _emscripten_date_now = () => Date.now();
            _emscripten_date_now.sig = "d";
            var _emscripten_get_now;
            _emscripten_get_now = () => performance.now();
            _emscripten_get_now.sig = "d";
            var getHeapMax = () => (
              // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
              // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
              // for any code that deals with heap sizes, which would require special
              // casing all heap size related code to treat 0 specially.
              2147483648
            );
            var growMemory = (size) => {
              var b = wasmMemory.buffer;
              var pages = (size - b.byteLength + 65535) / 65536;
              try {
                wasmMemory.grow(pages);
                updateMemoryViews();
                return 1;
              } catch (e) {
              }
            };
            var _emscripten_resize_heap = (requestedSize) => {
              var oldSize = HEAPU8.length;
              requestedSize >>>= 0;
              var maxHeapSize = getHeapMax();
              if (requestedSize > maxHeapSize) {
                return false;
              }
              var alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
              for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
                var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
                overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
                var newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, overGrownHeapSize), 65536));
                var replacement = growMemory(newSize);
                if (replacement) {
                  return true;
                }
              }
              return false;
            };
            _emscripten_resize_heap.sig = "ip";
            var _fd_close = (fd) => 52;
            _fd_close.sig = "ii";
            var convertI32PairToI53Checked = (lo, hi) => hi + 2097152 >>> 0 < 4194305 - !!lo ? (lo >>> 0) + hi * 4294967296 : NaN;
            function _fd_seek(fd, offset_low, offset_high, whence, newOffset) {
              var offset = convertI32PairToI53Checked(offset_low, offset_high);
              return 70;
            }
            _fd_seek.sig = "iiiiip";
            var printCharBuffers = [null, [], []];
            var printChar = (stream, curr) => {
              var buffer = printCharBuffers[stream];
              if (curr === 0 || curr === 10) {
                (stream === 1 ? out : err)(UTF8ArrayToString(buffer, 0));
                buffer.length = 0;
              } else {
                buffer.push(curr);
              }
            };
            var _fd_write = (fd, iov, iovcnt, pnum) => {
              var num = 0;
              for (var i2 = 0; i2 < iovcnt; i2++) {
                var ptr = LE_HEAP_LOAD_U32((iov >> 2) * 4);
                var len = LE_HEAP_LOAD_U32((iov + 4 >> 2) * 4);
                iov += 8;
                for (var j = 0; j < len; j++) {
                  printChar(fd, HEAPU8[ptr + j]);
                }
                num += len;
              }
              LE_HEAP_STORE_U32((pnum >> 2) * 4, num);
              return 0;
            };
            _fd_write.sig = "iippp";
            function _tree_sitter_log_callback(isLexMessage, messageAddress) {
              if (currentLogCallback) {
                const message = UTF8ToString(messageAddress);
                currentLogCallback(message, isLexMessage !== 0);
              }
            }
            function _tree_sitter_parse_callback(inputBufferAddress, index, row, column, lengthAddress) {
              const INPUT_BUFFER_SIZE = 10 * 1024;
              const string = currentParseCallback(index, {
                row,
                column
              });
              if (typeof string === "string") {
                setValue(lengthAddress, string.length, "i32");
                stringToUTF16(string, inputBufferAddress, INPUT_BUFFER_SIZE);
              } else {
                setValue(lengthAddress, 0, "i32");
              }
            }
            var runtimeKeepaliveCounter = 0;
            var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
            var _proc_exit = (code) => {
              EXITSTATUS = code;
              if (!keepRuntimeAlive()) {
                Module["onExit"]?.(code);
                ABORT = true;
              }
              quit_(code, new ExitStatus(code));
            };
            _proc_exit.sig = "vi";
            var exitJS = (status, implicit) => {
              EXITSTATUS = status;
              _proc_exit(status);
            };
            var handleException = (e) => {
              if (e instanceof ExitStatus || e == "unwind") {
                return EXITSTATUS;
              }
              quit_(1, e);
            };
            var lengthBytesUTF8 = (str) => {
              var len = 0;
              for (var i2 = 0; i2 < str.length; ++i2) {
                var c = str.charCodeAt(i2);
                if (c <= 127) {
                  len++;
                } else if (c <= 2047) {
                  len += 2;
                } else if (c >= 55296 && c <= 57343) {
                  len += 4;
                  ++i2;
                } else {
                  len += 3;
                }
              }
              return len;
            };
            var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
              if (!(maxBytesToWrite > 0)) return 0;
              var startIdx = outIdx;
              var endIdx = outIdx + maxBytesToWrite - 1;
              for (var i2 = 0; i2 < str.length; ++i2) {
                var u = str.charCodeAt(i2);
                if (u >= 55296 && u <= 57343) {
                  var u1 = str.charCodeAt(++i2);
                  u = 65536 + ((u & 1023) << 10) | u1 & 1023;
                }
                if (u <= 127) {
                  if (outIdx >= endIdx) break;
                  heap[outIdx++] = u;
                } else if (u <= 2047) {
                  if (outIdx + 1 >= endIdx) break;
                  heap[outIdx++] = 192 | u >> 6;
                  heap[outIdx++] = 128 | u & 63;
                } else if (u <= 65535) {
                  if (outIdx + 2 >= endIdx) break;
                  heap[outIdx++] = 224 | u >> 12;
                  heap[outIdx++] = 128 | u >> 6 & 63;
                  heap[outIdx++] = 128 | u & 63;
                } else {
                  if (outIdx + 3 >= endIdx) break;
                  heap[outIdx++] = 240 | u >> 18;
                  heap[outIdx++] = 128 | u >> 12 & 63;
                  heap[outIdx++] = 128 | u >> 6 & 63;
                  heap[outIdx++] = 128 | u & 63;
                }
              }
              heap[outIdx] = 0;
              return outIdx - startIdx;
            };
            var stringToUTF8 = (str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
            var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
            var stringToUTF8OnStack = (str) => {
              var size = lengthBytesUTF8(str) + 1;
              var ret = stackAlloc(size);
              stringToUTF8(str, ret, size);
              return ret;
            };
            var stringToUTF16 = (str, outPtr, maxBytesToWrite) => {
              maxBytesToWrite ??= 2147483647;
              if (maxBytesToWrite < 2) return 0;
              maxBytesToWrite -= 2;
              var startPtr = outPtr;
              var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
              for (var i2 = 0; i2 < numCharsToWrite; ++i2) {
                var codeUnit = str.charCodeAt(i2);
                LE_HEAP_STORE_I16((outPtr >> 1) * 2, codeUnit);
                outPtr += 2;
              }
              LE_HEAP_STORE_I16((outPtr >> 1) * 2, 0);
              return outPtr - startPtr;
            };
            var AsciiToString = (ptr) => {
              var str = "";
              while (1) {
                var ch = HEAPU8[ptr++];
                if (!ch) return str;
                str += String.fromCharCode(ch);
              }
            };
            var wasmImports = {
              /** @export */
              __heap_base: ___heap_base,
              /** @export */
              __indirect_function_table: wasmTable,
              /** @export */
              __memory_base: ___memory_base,
              /** @export */
              __stack_pointer: ___stack_pointer,
              /** @export */
              __table_base: ___table_base,
              /** @export */
              _abort_js: __abort_js,
              /** @export */
              _emscripten_get_now_is_monotonic: __emscripten_get_now_is_monotonic,
              /** @export */
              _emscripten_memcpy_js: __emscripten_memcpy_js,
              /** @export */
              emscripten_get_now: _emscripten_get_now,
              /** @export */
              emscripten_resize_heap: _emscripten_resize_heap,
              /** @export */
              fd_close: _fd_close,
              /** @export */
              fd_seek: _fd_seek,
              /** @export */
              fd_write: _fd_write,
              /** @export */
              memory: wasmMemory,
              /** @export */
              tree_sitter_log_callback: _tree_sitter_log_callback,
              /** @export */
              tree_sitter_parse_callback: _tree_sitter_parse_callback
            };
            var wasmExports = createWasm();
            var ___wasm_call_ctors = () => (___wasm_call_ctors = wasmExports["__wasm_call_ctors"])();
            var ___wasm_apply_data_relocs = () => (___wasm_apply_data_relocs = wasmExports["__wasm_apply_data_relocs"])();
            var _malloc = Module["_malloc"] = (a0) => (_malloc = Module["_malloc"] = wasmExports["malloc"])(a0);
            var _calloc = Module["_calloc"] = (a0, a1) => (_calloc = Module["_calloc"] = wasmExports["calloc"])(a0, a1);
            var _realloc = Module["_realloc"] = (a0, a1) => (_realloc = Module["_realloc"] = wasmExports["realloc"])(a0, a1);
            var _free = Module["_free"] = (a0) => (_free = Module["_free"] = wasmExports["free"])(a0);
            var _ts_language_symbol_count = Module["_ts_language_symbol_count"] = (a0) => (_ts_language_symbol_count = Module["_ts_language_symbol_count"] = wasmExports["ts_language_symbol_count"])(a0);
            var _ts_language_state_count = Module["_ts_language_state_count"] = (a0) => (_ts_language_state_count = Module["_ts_language_state_count"] = wasmExports["ts_language_state_count"])(a0);
            var _ts_language_version = Module["_ts_language_version"] = (a0) => (_ts_language_version = Module["_ts_language_version"] = wasmExports["ts_language_version"])(a0);
            var _ts_language_field_count = Module["_ts_language_field_count"] = (a0) => (_ts_language_field_count = Module["_ts_language_field_count"] = wasmExports["ts_language_field_count"])(a0);
            var _ts_language_next_state = Module["_ts_language_next_state"] = (a0, a1, a2) => (_ts_language_next_state = Module["_ts_language_next_state"] = wasmExports["ts_language_next_state"])(a0, a1, a2);
            var _ts_language_symbol_name = Module["_ts_language_symbol_name"] = (a0, a1) => (_ts_language_symbol_name = Module["_ts_language_symbol_name"] = wasmExports["ts_language_symbol_name"])(a0, a1);
            var _ts_language_symbol_for_name = Module["_ts_language_symbol_for_name"] = (a0, a1, a2, a3) => (_ts_language_symbol_for_name = Module["_ts_language_symbol_for_name"] = wasmExports["ts_language_symbol_for_name"])(a0, a1, a2, a3);
            var _strncmp = Module["_strncmp"] = (a0, a1, a2) => (_strncmp = Module["_strncmp"] = wasmExports["strncmp"])(a0, a1, a2);
            var _ts_language_symbol_type = Module["_ts_language_symbol_type"] = (a0, a1) => (_ts_language_symbol_type = Module["_ts_language_symbol_type"] = wasmExports["ts_language_symbol_type"])(a0, a1);
            var _ts_language_field_name_for_id = Module["_ts_language_field_name_for_id"] = (a0, a1) => (_ts_language_field_name_for_id = Module["_ts_language_field_name_for_id"] = wasmExports["ts_language_field_name_for_id"])(a0, a1);
            var _ts_lookahead_iterator_new = Module["_ts_lookahead_iterator_new"] = (a0, a1) => (_ts_lookahead_iterator_new = Module["_ts_lookahead_iterator_new"] = wasmExports["ts_lookahead_iterator_new"])(a0, a1);
            var _ts_lookahead_iterator_delete = Module["_ts_lookahead_iterator_delete"] = (a0) => (_ts_lookahead_iterator_delete = Module["_ts_lookahead_iterator_delete"] = wasmExports["ts_lookahead_iterator_delete"])(a0);
            var _ts_lookahead_iterator_reset_state = Module["_ts_lookahead_iterator_reset_state"] = (a0, a1) => (_ts_lookahead_iterator_reset_state = Module["_ts_lookahead_iterator_reset_state"] = wasmExports["ts_lookahead_iterator_reset_state"])(a0, a1);
            var _ts_lookahead_iterator_reset = Module["_ts_lookahead_iterator_reset"] = (a0, a1, a2) => (_ts_lookahead_iterator_reset = Module["_ts_lookahead_iterator_reset"] = wasmExports["ts_lookahead_iterator_reset"])(a0, a1, a2);
            var _ts_lookahead_iterator_next = Module["_ts_lookahead_iterator_next"] = (a0) => (_ts_lookahead_iterator_next = Module["_ts_lookahead_iterator_next"] = wasmExports["ts_lookahead_iterator_next"])(a0);
            var _ts_lookahead_iterator_current_symbol = Module["_ts_lookahead_iterator_current_symbol"] = (a0) => (_ts_lookahead_iterator_current_symbol = Module["_ts_lookahead_iterator_current_symbol"] = wasmExports["ts_lookahead_iterator_current_symbol"])(a0);
            var _memset = Module["_memset"] = (a0, a1, a2) => (_memset = Module["_memset"] = wasmExports["memset"])(a0, a1, a2);
            var _memcpy = Module["_memcpy"] = (a0, a1, a2) => (_memcpy = Module["_memcpy"] = wasmExports["memcpy"])(a0, a1, a2);
            var _ts_parser_delete = Module["_ts_parser_delete"] = (a0) => (_ts_parser_delete = Module["_ts_parser_delete"] = wasmExports["ts_parser_delete"])(a0);
            var _ts_parser_reset = Module["_ts_parser_reset"] = (a0) => (_ts_parser_reset = Module["_ts_parser_reset"] = wasmExports["ts_parser_reset"])(a0);
            var _ts_parser_set_language = Module["_ts_parser_set_language"] = (a0, a1) => (_ts_parser_set_language = Module["_ts_parser_set_language"] = wasmExports["ts_parser_set_language"])(a0, a1);
            var _ts_parser_timeout_micros = Module["_ts_parser_timeout_micros"] = (a0) => (_ts_parser_timeout_micros = Module["_ts_parser_timeout_micros"] = wasmExports["ts_parser_timeout_micros"])(a0);
            var _ts_parser_set_timeout_micros = Module["_ts_parser_set_timeout_micros"] = (a0, a1, a2) => (_ts_parser_set_timeout_micros = Module["_ts_parser_set_timeout_micros"] = wasmExports["ts_parser_set_timeout_micros"])(a0, a1, a2);
            var _ts_parser_set_included_ranges = Module["_ts_parser_set_included_ranges"] = (a0, a1, a2) => (_ts_parser_set_included_ranges = Module["_ts_parser_set_included_ranges"] = wasmExports["ts_parser_set_included_ranges"])(a0, a1, a2);
            var _memmove = Module["_memmove"] = (a0, a1, a2) => (_memmove = Module["_memmove"] = wasmExports["memmove"])(a0, a1, a2);
            var _memcmp = Module["_memcmp"] = (a0, a1, a2) => (_memcmp = Module["_memcmp"] = wasmExports["memcmp"])(a0, a1, a2);
            var _ts_query_new = Module["_ts_query_new"] = (a0, a1, a2, a3, a4) => (_ts_query_new = Module["_ts_query_new"] = wasmExports["ts_query_new"])(a0, a1, a2, a3, a4);
            var _ts_query_delete = Module["_ts_query_delete"] = (a0) => (_ts_query_delete = Module["_ts_query_delete"] = wasmExports["ts_query_delete"])(a0);
            var _iswspace = Module["_iswspace"] = (a0) => (_iswspace = Module["_iswspace"] = wasmExports["iswspace"])(a0);
            var _iswalnum = Module["_iswalnum"] = (a0) => (_iswalnum = Module["_iswalnum"] = wasmExports["iswalnum"])(a0);
            var _ts_query_pattern_count = Module["_ts_query_pattern_count"] = (a0) => (_ts_query_pattern_count = Module["_ts_query_pattern_count"] = wasmExports["ts_query_pattern_count"])(a0);
            var _ts_query_capture_count = Module["_ts_query_capture_count"] = (a0) => (_ts_query_capture_count = Module["_ts_query_capture_count"] = wasmExports["ts_query_capture_count"])(a0);
            var _ts_query_string_count = Module["_ts_query_string_count"] = (a0) => (_ts_query_string_count = Module["_ts_query_string_count"] = wasmExports["ts_query_string_count"])(a0);
            var _ts_query_capture_name_for_id = Module["_ts_query_capture_name_for_id"] = (a0, a1, a2) => (_ts_query_capture_name_for_id = Module["_ts_query_capture_name_for_id"] = wasmExports["ts_query_capture_name_for_id"])(a0, a1, a2);
            var _ts_query_string_value_for_id = Module["_ts_query_string_value_for_id"] = (a0, a1, a2) => (_ts_query_string_value_for_id = Module["_ts_query_string_value_for_id"] = wasmExports["ts_query_string_value_for_id"])(a0, a1, a2);
            var _ts_query_predicates_for_pattern = Module["_ts_query_predicates_for_pattern"] = (a0, a1, a2) => (_ts_query_predicates_for_pattern = Module["_ts_query_predicates_for_pattern"] = wasmExports["ts_query_predicates_for_pattern"])(a0, a1, a2);
            var _ts_query_disable_capture = Module["_ts_query_disable_capture"] = (a0, a1, a2) => (_ts_query_disable_capture = Module["_ts_query_disable_capture"] = wasmExports["ts_query_disable_capture"])(a0, a1, a2);
            var _ts_tree_copy = Module["_ts_tree_copy"] = (a0) => (_ts_tree_copy = Module["_ts_tree_copy"] = wasmExports["ts_tree_copy"])(a0);
            var _ts_tree_delete = Module["_ts_tree_delete"] = (a0) => (_ts_tree_delete = Module["_ts_tree_delete"] = wasmExports["ts_tree_delete"])(a0);
            var _ts_init = Module["_ts_init"] = () => (_ts_init = Module["_ts_init"] = wasmExports["ts_init"])();
            var _ts_parser_new_wasm = Module["_ts_parser_new_wasm"] = () => (_ts_parser_new_wasm = Module["_ts_parser_new_wasm"] = wasmExports["ts_parser_new_wasm"])();
            var _ts_parser_enable_logger_wasm = Module["_ts_parser_enable_logger_wasm"] = (a0, a1) => (_ts_parser_enable_logger_wasm = Module["_ts_parser_enable_logger_wasm"] = wasmExports["ts_parser_enable_logger_wasm"])(a0, a1);
            var _ts_parser_parse_wasm = Module["_ts_parser_parse_wasm"] = (a0, a1, a2, a3, a4) => (_ts_parser_parse_wasm = Module["_ts_parser_parse_wasm"] = wasmExports["ts_parser_parse_wasm"])(a0, a1, a2, a3, a4);
            var _ts_parser_included_ranges_wasm = Module["_ts_parser_included_ranges_wasm"] = (a0) => (_ts_parser_included_ranges_wasm = Module["_ts_parser_included_ranges_wasm"] = wasmExports["ts_parser_included_ranges_wasm"])(a0);
            var _ts_language_type_is_named_wasm = Module["_ts_language_type_is_named_wasm"] = (a0, a1) => (_ts_language_type_is_named_wasm = Module["_ts_language_type_is_named_wasm"] = wasmExports["ts_language_type_is_named_wasm"])(a0, a1);
            var _ts_language_type_is_visible_wasm = Module["_ts_language_type_is_visible_wasm"] = (a0, a1) => (_ts_language_type_is_visible_wasm = Module["_ts_language_type_is_visible_wasm"] = wasmExports["ts_language_type_is_visible_wasm"])(a0, a1);
            var _ts_tree_root_node_wasm = Module["_ts_tree_root_node_wasm"] = (a0) => (_ts_tree_root_node_wasm = Module["_ts_tree_root_node_wasm"] = wasmExports["ts_tree_root_node_wasm"])(a0);
            var _ts_tree_root_node_with_offset_wasm = Module["_ts_tree_root_node_with_offset_wasm"] = (a0) => (_ts_tree_root_node_with_offset_wasm = Module["_ts_tree_root_node_with_offset_wasm"] = wasmExports["ts_tree_root_node_with_offset_wasm"])(a0);
            var _ts_tree_edit_wasm = Module["_ts_tree_edit_wasm"] = (a0) => (_ts_tree_edit_wasm = Module["_ts_tree_edit_wasm"] = wasmExports["ts_tree_edit_wasm"])(a0);
            var _ts_tree_included_ranges_wasm = Module["_ts_tree_included_ranges_wasm"] = (a0) => (_ts_tree_included_ranges_wasm = Module["_ts_tree_included_ranges_wasm"] = wasmExports["ts_tree_included_ranges_wasm"])(a0);
            var _ts_tree_get_changed_ranges_wasm = Module["_ts_tree_get_changed_ranges_wasm"] = (a0, a1) => (_ts_tree_get_changed_ranges_wasm = Module["_ts_tree_get_changed_ranges_wasm"] = wasmExports["ts_tree_get_changed_ranges_wasm"])(a0, a1);
            var _ts_tree_cursor_new_wasm = Module["_ts_tree_cursor_new_wasm"] = (a0) => (_ts_tree_cursor_new_wasm = Module["_ts_tree_cursor_new_wasm"] = wasmExports["ts_tree_cursor_new_wasm"])(a0);
            var _ts_tree_cursor_delete_wasm = Module["_ts_tree_cursor_delete_wasm"] = (a0) => (_ts_tree_cursor_delete_wasm = Module["_ts_tree_cursor_delete_wasm"] = wasmExports["ts_tree_cursor_delete_wasm"])(a0);
            var _ts_tree_cursor_reset_wasm = Module["_ts_tree_cursor_reset_wasm"] = (a0) => (_ts_tree_cursor_reset_wasm = Module["_ts_tree_cursor_reset_wasm"] = wasmExports["ts_tree_cursor_reset_wasm"])(a0);
            var _ts_tree_cursor_reset_to_wasm = Module["_ts_tree_cursor_reset_to_wasm"] = (a0, a1) => (_ts_tree_cursor_reset_to_wasm = Module["_ts_tree_cursor_reset_to_wasm"] = wasmExports["ts_tree_cursor_reset_to_wasm"])(a0, a1);
            var _ts_tree_cursor_goto_first_child_wasm = Module["_ts_tree_cursor_goto_first_child_wasm"] = (a0) => (_ts_tree_cursor_goto_first_child_wasm = Module["_ts_tree_cursor_goto_first_child_wasm"] = wasmExports["ts_tree_cursor_goto_first_child_wasm"])(a0);
            var _ts_tree_cursor_goto_last_child_wasm = Module["_ts_tree_cursor_goto_last_child_wasm"] = (a0) => (_ts_tree_cursor_goto_last_child_wasm = Module["_ts_tree_cursor_goto_last_child_wasm"] = wasmExports["ts_tree_cursor_goto_last_child_wasm"])(a0);
            var _ts_tree_cursor_goto_first_child_for_index_wasm = Module["_ts_tree_cursor_goto_first_child_for_index_wasm"] = (a0) => (_ts_tree_cursor_goto_first_child_for_index_wasm = Module["_ts_tree_cursor_goto_first_child_for_index_wasm"] = wasmExports["ts_tree_cursor_goto_first_child_for_index_wasm"])(a0);
            var _ts_tree_cursor_goto_first_child_for_position_wasm = Module["_ts_tree_cursor_goto_first_child_for_position_wasm"] = (a0) => (_ts_tree_cursor_goto_first_child_for_position_wasm = Module["_ts_tree_cursor_goto_first_child_for_position_wasm"] = wasmExports["ts_tree_cursor_goto_first_child_for_position_wasm"])(a0);
            var _ts_tree_cursor_goto_next_sibling_wasm = Module["_ts_tree_cursor_goto_next_sibling_wasm"] = (a0) => (_ts_tree_cursor_goto_next_sibling_wasm = Module["_ts_tree_cursor_goto_next_sibling_wasm"] = wasmExports["ts_tree_cursor_goto_next_sibling_wasm"])(a0);
            var _ts_tree_cursor_goto_previous_sibling_wasm = Module["_ts_tree_cursor_goto_previous_sibling_wasm"] = (a0) => (_ts_tree_cursor_goto_previous_sibling_wasm = Module["_ts_tree_cursor_goto_previous_sibling_wasm"] = wasmExports["ts_tree_cursor_goto_previous_sibling_wasm"])(a0);
            var _ts_tree_cursor_goto_descendant_wasm = Module["_ts_tree_cursor_goto_descendant_wasm"] = (a0, a1) => (_ts_tree_cursor_goto_descendant_wasm = Module["_ts_tree_cursor_goto_descendant_wasm"] = wasmExports["ts_tree_cursor_goto_descendant_wasm"])(a0, a1);
            var _ts_tree_cursor_goto_parent_wasm = Module["_ts_tree_cursor_goto_parent_wasm"] = (a0) => (_ts_tree_cursor_goto_parent_wasm = Module["_ts_tree_cursor_goto_parent_wasm"] = wasmExports["ts_tree_cursor_goto_parent_wasm"])(a0);
            var _ts_tree_cursor_current_node_type_id_wasm = Module["_ts_tree_cursor_current_node_type_id_wasm"] = (a0) => (_ts_tree_cursor_current_node_type_id_wasm = Module["_ts_tree_cursor_current_node_type_id_wasm"] = wasmExports["ts_tree_cursor_current_node_type_id_wasm"])(a0);
            var _ts_tree_cursor_current_node_state_id_wasm = Module["_ts_tree_cursor_current_node_state_id_wasm"] = (a0) => (_ts_tree_cursor_current_node_state_id_wasm = Module["_ts_tree_cursor_current_node_state_id_wasm"] = wasmExports["ts_tree_cursor_current_node_state_id_wasm"])(a0);
            var _ts_tree_cursor_current_node_is_named_wasm = Module["_ts_tree_cursor_current_node_is_named_wasm"] = (a0) => (_ts_tree_cursor_current_node_is_named_wasm = Module["_ts_tree_cursor_current_node_is_named_wasm"] = wasmExports["ts_tree_cursor_current_node_is_named_wasm"])(a0);
            var _ts_tree_cursor_current_node_is_missing_wasm = Module["_ts_tree_cursor_current_node_is_missing_wasm"] = (a0) => (_ts_tree_cursor_current_node_is_missing_wasm = Module["_ts_tree_cursor_current_node_is_missing_wasm"] = wasmExports["ts_tree_cursor_current_node_is_missing_wasm"])(a0);
            var _ts_tree_cursor_current_node_id_wasm = Module["_ts_tree_cursor_current_node_id_wasm"] = (a0) => (_ts_tree_cursor_current_node_id_wasm = Module["_ts_tree_cursor_current_node_id_wasm"] = wasmExports["ts_tree_cursor_current_node_id_wasm"])(a0);
            var _ts_tree_cursor_start_position_wasm = Module["_ts_tree_cursor_start_position_wasm"] = (a0) => (_ts_tree_cursor_start_position_wasm = Module["_ts_tree_cursor_start_position_wasm"] = wasmExports["ts_tree_cursor_start_position_wasm"])(a0);
            var _ts_tree_cursor_end_position_wasm = Module["_ts_tree_cursor_end_position_wasm"] = (a0) => (_ts_tree_cursor_end_position_wasm = Module["_ts_tree_cursor_end_position_wasm"] = wasmExports["ts_tree_cursor_end_position_wasm"])(a0);
            var _ts_tree_cursor_start_index_wasm = Module["_ts_tree_cursor_start_index_wasm"] = (a0) => (_ts_tree_cursor_start_index_wasm = Module["_ts_tree_cursor_start_index_wasm"] = wasmExports["ts_tree_cursor_start_index_wasm"])(a0);
            var _ts_tree_cursor_end_index_wasm = Module["_ts_tree_cursor_end_index_wasm"] = (a0) => (_ts_tree_cursor_end_index_wasm = Module["_ts_tree_cursor_end_index_wasm"] = wasmExports["ts_tree_cursor_end_index_wasm"])(a0);
            var _ts_tree_cursor_current_field_id_wasm = Module["_ts_tree_cursor_current_field_id_wasm"] = (a0) => (_ts_tree_cursor_current_field_id_wasm = Module["_ts_tree_cursor_current_field_id_wasm"] = wasmExports["ts_tree_cursor_current_field_id_wasm"])(a0);
            var _ts_tree_cursor_current_depth_wasm = Module["_ts_tree_cursor_current_depth_wasm"] = (a0) => (_ts_tree_cursor_current_depth_wasm = Module["_ts_tree_cursor_current_depth_wasm"] = wasmExports["ts_tree_cursor_current_depth_wasm"])(a0);
            var _ts_tree_cursor_current_descendant_index_wasm = Module["_ts_tree_cursor_current_descendant_index_wasm"] = (a0) => (_ts_tree_cursor_current_descendant_index_wasm = Module["_ts_tree_cursor_current_descendant_index_wasm"] = wasmExports["ts_tree_cursor_current_descendant_index_wasm"])(a0);
            var _ts_tree_cursor_current_node_wasm = Module["_ts_tree_cursor_current_node_wasm"] = (a0) => (_ts_tree_cursor_current_node_wasm = Module["_ts_tree_cursor_current_node_wasm"] = wasmExports["ts_tree_cursor_current_node_wasm"])(a0);
            var _ts_node_symbol_wasm = Module["_ts_node_symbol_wasm"] = (a0) => (_ts_node_symbol_wasm = Module["_ts_node_symbol_wasm"] = wasmExports["ts_node_symbol_wasm"])(a0);
            var _ts_node_field_name_for_child_wasm = Module["_ts_node_field_name_for_child_wasm"] = (a0, a1) => (_ts_node_field_name_for_child_wasm = Module["_ts_node_field_name_for_child_wasm"] = wasmExports["ts_node_field_name_for_child_wasm"])(a0, a1);
            var _ts_node_children_by_field_id_wasm = Module["_ts_node_children_by_field_id_wasm"] = (a0, a1) => (_ts_node_children_by_field_id_wasm = Module["_ts_node_children_by_field_id_wasm"] = wasmExports["ts_node_children_by_field_id_wasm"])(a0, a1);
            var _ts_node_first_child_for_byte_wasm = Module["_ts_node_first_child_for_byte_wasm"] = (a0) => (_ts_node_first_child_for_byte_wasm = Module["_ts_node_first_child_for_byte_wasm"] = wasmExports["ts_node_first_child_for_byte_wasm"])(a0);
            var _ts_node_first_named_child_for_byte_wasm = Module["_ts_node_first_named_child_for_byte_wasm"] = (a0) => (_ts_node_first_named_child_for_byte_wasm = Module["_ts_node_first_named_child_for_byte_wasm"] = wasmExports["ts_node_first_named_child_for_byte_wasm"])(a0);
            var _ts_node_grammar_symbol_wasm = Module["_ts_node_grammar_symbol_wasm"] = (a0) => (_ts_node_grammar_symbol_wasm = Module["_ts_node_grammar_symbol_wasm"] = wasmExports["ts_node_grammar_symbol_wasm"])(a0);
            var _ts_node_child_count_wasm = Module["_ts_node_child_count_wasm"] = (a0) => (_ts_node_child_count_wasm = Module["_ts_node_child_count_wasm"] = wasmExports["ts_node_child_count_wasm"])(a0);
            var _ts_node_named_child_count_wasm = Module["_ts_node_named_child_count_wasm"] = (a0) => (_ts_node_named_child_count_wasm = Module["_ts_node_named_child_count_wasm"] = wasmExports["ts_node_named_child_count_wasm"])(a0);
            var _ts_node_child_wasm = Module["_ts_node_child_wasm"] = (a0, a1) => (_ts_node_child_wasm = Module["_ts_node_child_wasm"] = wasmExports["ts_node_child_wasm"])(a0, a1);
            var _ts_node_named_child_wasm = Module["_ts_node_named_child_wasm"] = (a0, a1) => (_ts_node_named_child_wasm = Module["_ts_node_named_child_wasm"] = wasmExports["ts_node_named_child_wasm"])(a0, a1);
            var _ts_node_child_by_field_id_wasm = Module["_ts_node_child_by_field_id_wasm"] = (a0, a1) => (_ts_node_child_by_field_id_wasm = Module["_ts_node_child_by_field_id_wasm"] = wasmExports["ts_node_child_by_field_id_wasm"])(a0, a1);
            var _ts_node_next_sibling_wasm = Module["_ts_node_next_sibling_wasm"] = (a0) => (_ts_node_next_sibling_wasm = Module["_ts_node_next_sibling_wasm"] = wasmExports["ts_node_next_sibling_wasm"])(a0);
            var _ts_node_prev_sibling_wasm = Module["_ts_node_prev_sibling_wasm"] = (a0) => (_ts_node_prev_sibling_wasm = Module["_ts_node_prev_sibling_wasm"] = wasmExports["ts_node_prev_sibling_wasm"])(a0);
            var _ts_node_next_named_sibling_wasm = Module["_ts_node_next_named_sibling_wasm"] = (a0) => (_ts_node_next_named_sibling_wasm = Module["_ts_node_next_named_sibling_wasm"] = wasmExports["ts_node_next_named_sibling_wasm"])(a0);
            var _ts_node_prev_named_sibling_wasm = Module["_ts_node_prev_named_sibling_wasm"] = (a0) => (_ts_node_prev_named_sibling_wasm = Module["_ts_node_prev_named_sibling_wasm"] = wasmExports["ts_node_prev_named_sibling_wasm"])(a0);
            var _ts_node_descendant_count_wasm = Module["_ts_node_descendant_count_wasm"] = (a0) => (_ts_node_descendant_count_wasm = Module["_ts_node_descendant_count_wasm"] = wasmExports["ts_node_descendant_count_wasm"])(a0);
            var _ts_node_parent_wasm = Module["_ts_node_parent_wasm"] = (a0) => (_ts_node_parent_wasm = Module["_ts_node_parent_wasm"] = wasmExports["ts_node_parent_wasm"])(a0);
            var _ts_node_descendant_for_index_wasm = Module["_ts_node_descendant_for_index_wasm"] = (a0) => (_ts_node_descendant_for_index_wasm = Module["_ts_node_descendant_for_index_wasm"] = wasmExports["ts_node_descendant_for_index_wasm"])(a0);
            var _ts_node_named_descendant_for_index_wasm = Module["_ts_node_named_descendant_for_index_wasm"] = (a0) => (_ts_node_named_descendant_for_index_wasm = Module["_ts_node_named_descendant_for_index_wasm"] = wasmExports["ts_node_named_descendant_for_index_wasm"])(a0);
            var _ts_node_descendant_for_position_wasm = Module["_ts_node_descendant_for_position_wasm"] = (a0) => (_ts_node_descendant_for_position_wasm = Module["_ts_node_descendant_for_position_wasm"] = wasmExports["ts_node_descendant_for_position_wasm"])(a0);
            var _ts_node_named_descendant_for_position_wasm = Module["_ts_node_named_descendant_for_position_wasm"] = (a0) => (_ts_node_named_descendant_for_position_wasm = Module["_ts_node_named_descendant_for_position_wasm"] = wasmExports["ts_node_named_descendant_for_position_wasm"])(a0);
            var _ts_node_start_point_wasm = Module["_ts_node_start_point_wasm"] = (a0) => (_ts_node_start_point_wasm = Module["_ts_node_start_point_wasm"] = wasmExports["ts_node_start_point_wasm"])(a0);
            var _ts_node_end_point_wasm = Module["_ts_node_end_point_wasm"] = (a0) => (_ts_node_end_point_wasm = Module["_ts_node_end_point_wasm"] = wasmExports["ts_node_end_point_wasm"])(a0);
            var _ts_node_start_index_wasm = Module["_ts_node_start_index_wasm"] = (a0) => (_ts_node_start_index_wasm = Module["_ts_node_start_index_wasm"] = wasmExports["ts_node_start_index_wasm"])(a0);
            var _ts_node_end_index_wasm = Module["_ts_node_end_index_wasm"] = (a0) => (_ts_node_end_index_wasm = Module["_ts_node_end_index_wasm"] = wasmExports["ts_node_end_index_wasm"])(a0);
            var _ts_node_to_string_wasm = Module["_ts_node_to_string_wasm"] = (a0) => (_ts_node_to_string_wasm = Module["_ts_node_to_string_wasm"] = wasmExports["ts_node_to_string_wasm"])(a0);
            var _ts_node_children_wasm = Module["_ts_node_children_wasm"] = (a0) => (_ts_node_children_wasm = Module["_ts_node_children_wasm"] = wasmExports["ts_node_children_wasm"])(a0);
            var _ts_node_named_children_wasm = Module["_ts_node_named_children_wasm"] = (a0) => (_ts_node_named_children_wasm = Module["_ts_node_named_children_wasm"] = wasmExports["ts_node_named_children_wasm"])(a0);
            var _ts_node_descendants_of_type_wasm = Module["_ts_node_descendants_of_type_wasm"] = (a0, a1, a2, a3, a4, a5, a6) => (_ts_node_descendants_of_type_wasm = Module["_ts_node_descendants_of_type_wasm"] = wasmExports["ts_node_descendants_of_type_wasm"])(a0, a1, a2, a3, a4, a5, a6);
            var _ts_node_is_named_wasm = Module["_ts_node_is_named_wasm"] = (a0) => (_ts_node_is_named_wasm = Module["_ts_node_is_named_wasm"] = wasmExports["ts_node_is_named_wasm"])(a0);
            var _ts_node_has_changes_wasm = Module["_ts_node_has_changes_wasm"] = (a0) => (_ts_node_has_changes_wasm = Module["_ts_node_has_changes_wasm"] = wasmExports["ts_node_has_changes_wasm"])(a0);
            var _ts_node_has_error_wasm = Module["_ts_node_has_error_wasm"] = (a0) => (_ts_node_has_error_wasm = Module["_ts_node_has_error_wasm"] = wasmExports["ts_node_has_error_wasm"])(a0);
            var _ts_node_is_error_wasm = Module["_ts_node_is_error_wasm"] = (a0) => (_ts_node_is_error_wasm = Module["_ts_node_is_error_wasm"] = wasmExports["ts_node_is_error_wasm"])(a0);
            var _ts_node_is_missing_wasm = Module["_ts_node_is_missing_wasm"] = (a0) => (_ts_node_is_missing_wasm = Module["_ts_node_is_missing_wasm"] = wasmExports["ts_node_is_missing_wasm"])(a0);
            var _ts_node_is_extra_wasm = Module["_ts_node_is_extra_wasm"] = (a0) => (_ts_node_is_extra_wasm = Module["_ts_node_is_extra_wasm"] = wasmExports["ts_node_is_extra_wasm"])(a0);
            var _ts_node_parse_state_wasm = Module["_ts_node_parse_state_wasm"] = (a0) => (_ts_node_parse_state_wasm = Module["_ts_node_parse_state_wasm"] = wasmExports["ts_node_parse_state_wasm"])(a0);
            var _ts_node_next_parse_state_wasm = Module["_ts_node_next_parse_state_wasm"] = (a0) => (_ts_node_next_parse_state_wasm = Module["_ts_node_next_parse_state_wasm"] = wasmExports["ts_node_next_parse_state_wasm"])(a0);
            var _ts_query_matches_wasm = Module["_ts_query_matches_wasm"] = (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) => (_ts_query_matches_wasm = Module["_ts_query_matches_wasm"] = wasmExports["ts_query_matches_wasm"])(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
            var _ts_query_captures_wasm = Module["_ts_query_captures_wasm"] = (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) => (_ts_query_captures_wasm = Module["_ts_query_captures_wasm"] = wasmExports["ts_query_captures_wasm"])(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
            var _iswalpha = Module["_iswalpha"] = (a0) => (_iswalpha = Module["_iswalpha"] = wasmExports["iswalpha"])(a0);
            var _iswblank = Module["_iswblank"] = (a0) => (_iswblank = Module["_iswblank"] = wasmExports["iswblank"])(a0);
            var _iswdigit = Module["_iswdigit"] = (a0) => (_iswdigit = Module["_iswdigit"] = wasmExports["iswdigit"])(a0);
            var _iswlower = Module["_iswlower"] = (a0) => (_iswlower = Module["_iswlower"] = wasmExports["iswlower"])(a0);
            var _iswupper = Module["_iswupper"] = (a0) => (_iswupper = Module["_iswupper"] = wasmExports["iswupper"])(a0);
            var _iswxdigit = Module["_iswxdigit"] = (a0) => (_iswxdigit = Module["_iswxdigit"] = wasmExports["iswxdigit"])(a0);
            var _memchr = Module["_memchr"] = (a0, a1, a2) => (_memchr = Module["_memchr"] = wasmExports["memchr"])(a0, a1, a2);
            var _strlen = Module["_strlen"] = (a0) => (_strlen = Module["_strlen"] = wasmExports["strlen"])(a0);
            var _strcmp = Module["_strcmp"] = (a0, a1) => (_strcmp = Module["_strcmp"] = wasmExports["strcmp"])(a0, a1);
            var _strncat = Module["_strncat"] = (a0, a1, a2) => (_strncat = Module["_strncat"] = wasmExports["strncat"])(a0, a1, a2);
            var _strncpy = Module["_strncpy"] = (a0, a1, a2) => (_strncpy = Module["_strncpy"] = wasmExports["strncpy"])(a0, a1, a2);
            var _towlower = Module["_towlower"] = (a0) => (_towlower = Module["_towlower"] = wasmExports["towlower"])(a0);
            var _towupper = Module["_towupper"] = (a0) => (_towupper = Module["_towupper"] = wasmExports["towupper"])(a0);
            var _setThrew = (a0, a1) => (_setThrew = wasmExports["setThrew"])(a0, a1);
            var __emscripten_stack_restore = (a0) => (__emscripten_stack_restore = wasmExports["_emscripten_stack_restore"])(a0);
            var __emscripten_stack_alloc = (a0) => (__emscripten_stack_alloc = wasmExports["_emscripten_stack_alloc"])(a0);
            var _emscripten_stack_get_current = () => (_emscripten_stack_get_current = wasmExports["emscripten_stack_get_current"])();
            var dynCall_jiji = Module["dynCall_jiji"] = (a0, a1, a2, a3, a4) => (dynCall_jiji = Module["dynCall_jiji"] = wasmExports["dynCall_jiji"])(a0, a1, a2, a3, a4);
            var _orig$ts_parser_timeout_micros = Module["_orig$ts_parser_timeout_micros"] = (a0) => (_orig$ts_parser_timeout_micros = Module["_orig$ts_parser_timeout_micros"] = wasmExports["orig$ts_parser_timeout_micros"])(a0);
            var _orig$ts_parser_set_timeout_micros = Module["_orig$ts_parser_set_timeout_micros"] = (a0, a1) => (_orig$ts_parser_set_timeout_micros = Module["_orig$ts_parser_set_timeout_micros"] = wasmExports["orig$ts_parser_set_timeout_micros"])(a0, a1);
            Module["AsciiToString"] = AsciiToString;
            Module["stringToUTF16"] = stringToUTF16;
            var calledRun;
            dependenciesFulfilled = function runCaller() {
              if (!calledRun) run();
              if (!calledRun) dependenciesFulfilled = runCaller;
            };
            function callMain(args2 = []) {
              var entryFunction = resolveGlobalSymbol("main").sym;
              if (!entryFunction) return;
              args2.unshift(thisProgram);
              var argc = args2.length;
              var argv = stackAlloc((argc + 1) * 4);
              var argv_ptr = argv;
              args2.forEach((arg) => {
                LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, stringToUTF8OnStack(arg));
                argv_ptr += 4;
              });
              LE_HEAP_STORE_U32((argv_ptr >> 2) * 4, 0);
              try {
                var ret = entryFunction(argc, argv);
                exitJS(
                  ret,
                  /* implicit = */
                  true
                );
                return ret;
              } catch (e) {
                return handleException(e);
              }
            }
            function run(args2 = arguments_) {
              if (runDependencies > 0) {
                return;
              }
              preRun();
              if (runDependencies > 0) {
                return;
              }
              function doRun() {
                if (calledRun) return;
                calledRun = true;
                Module["calledRun"] = true;
                if (ABORT) return;
                initRuntime();
                preMain();
                Module["onRuntimeInitialized"]?.();
                if (shouldRunNow) callMain(args2);
                postRun();
              }
              if (Module["setStatus"]) {
                Module["setStatus"]("Running...");
                setTimeout(function() {
                  setTimeout(function() {
                    Module["setStatus"]("");
                  }, 1);
                  doRun();
                }, 1);
              } else {
                doRun();
              }
            }
            if (Module["preInit"]) {
              if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
              while (Module["preInit"].length > 0) {
                Module["preInit"].pop()();
              }
            }
            var shouldRunNow = true;
            if (Module["noInitialRun"]) shouldRunNow = false;
            run();
            const C = Module;
            const INTERNAL = {};
            const SIZE_OF_INT = 4;
            const SIZE_OF_CURSOR = 4 * SIZE_OF_INT;
            const SIZE_OF_NODE = 5 * SIZE_OF_INT;
            const SIZE_OF_POINT = 2 * SIZE_OF_INT;
            const SIZE_OF_RANGE = 2 * SIZE_OF_INT + 2 * SIZE_OF_POINT;
            const ZERO_POINT = {
              row: 0,
              column: 0
            };
            const QUERY_WORD_REGEX = /[\w-.]*/g;
            const PREDICATE_STEP_TYPE_CAPTURE = 1;
            const PREDICATE_STEP_TYPE_STRING = 2;
            const LANGUAGE_FUNCTION_REGEX = /^_?tree_sitter_\w+/;
            let VERSION;
            let MIN_COMPATIBLE_VERSION;
            let TRANSFER_BUFFER;
            let currentParseCallback;
            let currentLogCallback;
            class ParserImpl {
              static init() {
                TRANSFER_BUFFER = C._ts_init();
                VERSION = getValue(TRANSFER_BUFFER, "i32");
                MIN_COMPATIBLE_VERSION = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
              }
              initialize() {
                C._ts_parser_new_wasm();
                this[0] = getValue(TRANSFER_BUFFER, "i32");
                this[1] = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
              }
              delete() {
                C._ts_parser_delete(this[0]);
                C._free(this[1]);
                this[0] = 0;
                this[1] = 0;
              }
              setLanguage(language) {
                let address;
                if (!language) {
                  address = 0;
                  language = null;
                } else if (language.constructor === Language) {
                  address = language[0];
                  const version = C._ts_language_version(address);
                  if (version < MIN_COMPATIBLE_VERSION || VERSION < version) {
                    throw new Error(`Incompatible language version ${version}. Compatibility range ${MIN_COMPATIBLE_VERSION} through ${VERSION}.`);
                  }
                } else {
                  throw new Error("Argument must be a Language");
                }
                this.language = language;
                C._ts_parser_set_language(this[0], address);
                return this;
              }
              getLanguage() {
                return this.language;
              }
              parse(callback, oldTree, options) {
                if (typeof callback === "string") {
                  currentParseCallback = (index, _) => callback.slice(index);
                } else if (typeof callback === "function") {
                  currentParseCallback = callback;
                } else {
                  throw new Error("Argument must be a string or a function");
                }
                if (this.logCallback) {
                  currentLogCallback = this.logCallback;
                  C._ts_parser_enable_logger_wasm(this[0], 1);
                } else {
                  currentLogCallback = null;
                  C._ts_parser_enable_logger_wasm(this[0], 0);
                }
                let rangeCount = 0;
                let rangeAddress = 0;
                if (options?.includedRanges) {
                  rangeCount = options.includedRanges.length;
                  rangeAddress = C._calloc(rangeCount, SIZE_OF_RANGE);
                  let address = rangeAddress;
                  for (let i2 = 0; i2 < rangeCount; i2++) {
                    marshalRange(address, options.includedRanges[i2]);
                    address += SIZE_OF_RANGE;
                  }
                }
                const treeAddress = C._ts_parser_parse_wasm(this[0], this[1], oldTree ? oldTree[0] : 0, rangeAddress, rangeCount);
                if (!treeAddress) {
                  currentParseCallback = null;
                  currentLogCallback = null;
                  throw new Error("Parsing failed");
                }
                const result = new Tree(INTERNAL, treeAddress, this.language, currentParseCallback);
                currentParseCallback = null;
                currentLogCallback = null;
                return result;
              }
              reset() {
                C._ts_parser_reset(this[0]);
              }
              getIncludedRanges() {
                C._ts_parser_included_ranges_wasm(this[0]);
                const count = getValue(TRANSFER_BUFFER, "i32");
                const buffer = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                const result = new Array(count);
                if (count > 0) {
                  let address = buffer;
                  for (let i2 = 0; i2 < count; i2++) {
                    result[i2] = unmarshalRange(address);
                    address += SIZE_OF_RANGE;
                  }
                  C._free(buffer);
                }
                return result;
              }
              getTimeoutMicros() {
                return C._ts_parser_timeout_micros(this[0]);
              }
              setTimeoutMicros(timeout) {
                C._ts_parser_set_timeout_micros(this[0], timeout);
              }
              setLogger(callback) {
                if (!callback) {
                  callback = null;
                } else if (typeof callback !== "function") {
                  throw new Error("Logger callback must be a function");
                }
                this.logCallback = callback;
                return this;
              }
              getLogger() {
                return this.logCallback;
              }
            }
            class Tree {
              constructor(internal, address, language, textCallback) {
                assertInternal(internal);
                this[0] = address;
                this.language = language;
                this.textCallback = textCallback;
              }
              copy() {
                const address = C._ts_tree_copy(this[0]);
                return new Tree(INTERNAL, address, this.language, this.textCallback);
              }
              delete() {
                C._ts_tree_delete(this[0]);
                this[0] = 0;
              }
              edit(edit) {
                marshalEdit(edit);
                C._ts_tree_edit_wasm(this[0]);
              }
              get rootNode() {
                C._ts_tree_root_node_wasm(this[0]);
                return unmarshalNode(this);
              }
              rootNodeWithOffset(offsetBytes, offsetExtent) {
                const address = TRANSFER_BUFFER + SIZE_OF_NODE;
                setValue(address, offsetBytes, "i32");
                marshalPoint(address + SIZE_OF_INT, offsetExtent);
                C._ts_tree_root_node_with_offset_wasm(this[0]);
                return unmarshalNode(this);
              }
              getLanguage() {
                return this.language;
              }
              walk() {
                return this.rootNode.walk();
              }
              getChangedRanges(other) {
                if (other.constructor !== Tree) {
                  throw new TypeError("Argument must be a Tree");
                }
                C._ts_tree_get_changed_ranges_wasm(this[0], other[0]);
                const count = getValue(TRANSFER_BUFFER, "i32");
                const buffer = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                const result = new Array(count);
                if (count > 0) {
                  let address = buffer;
                  for (let i2 = 0; i2 < count; i2++) {
                    result[i2] = unmarshalRange(address);
                    address += SIZE_OF_RANGE;
                  }
                  C._free(buffer);
                }
                return result;
              }
              getIncludedRanges() {
                C._ts_tree_included_ranges_wasm(this[0]);
                const count = getValue(TRANSFER_BUFFER, "i32");
                const buffer = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                const result = new Array(count);
                if (count > 0) {
                  let address = buffer;
                  for (let i2 = 0; i2 < count; i2++) {
                    result[i2] = unmarshalRange(address);
                    address += SIZE_OF_RANGE;
                  }
                  C._free(buffer);
                }
                return result;
              }
            }
            class Node {
              constructor(internal, tree) {
                assertInternal(internal);
                this.tree = tree;
              }
              get typeId() {
                marshalNode(this);
                return C._ts_node_symbol_wasm(this.tree[0]);
              }
              get grammarId() {
                marshalNode(this);
                return C._ts_node_grammar_symbol_wasm(this.tree[0]);
              }
              get type() {
                return this.tree.language.types[this.typeId] || "ERROR";
              }
              get grammarType() {
                return this.tree.language.types[this.grammarId] || "ERROR";
              }
              get endPosition() {
                marshalNode(this);
                C._ts_node_end_point_wasm(this.tree[0]);
                return unmarshalPoint(TRANSFER_BUFFER);
              }
              get endIndex() {
                marshalNode(this);
                return C._ts_node_end_index_wasm(this.tree[0]);
              }
              get text() {
                return getText(this.tree, this.startIndex, this.endIndex);
              }
              get parseState() {
                marshalNode(this);
                return C._ts_node_parse_state_wasm(this.tree[0]);
              }
              get nextParseState() {
                marshalNode(this);
                return C._ts_node_next_parse_state_wasm(this.tree[0]);
              }
              get isNamed() {
                marshalNode(this);
                return C._ts_node_is_named_wasm(this.tree[0]) === 1;
              }
              get hasError() {
                marshalNode(this);
                return C._ts_node_has_error_wasm(this.tree[0]) === 1;
              }
              get hasChanges() {
                marshalNode(this);
                return C._ts_node_has_changes_wasm(this.tree[0]) === 1;
              }
              get isError() {
                marshalNode(this);
                return C._ts_node_is_error_wasm(this.tree[0]) === 1;
              }
              get isMissing() {
                marshalNode(this);
                return C._ts_node_is_missing_wasm(this.tree[0]) === 1;
              }
              get isExtra() {
                marshalNode(this);
                return C._ts_node_is_extra_wasm(this.tree[0]) === 1;
              }
              equals(other) {
                return this.id === other.id;
              }
              child(index) {
                marshalNode(this);
                C._ts_node_child_wasm(this.tree[0], index);
                return unmarshalNode(this.tree);
              }
              namedChild(index) {
                marshalNode(this);
                C._ts_node_named_child_wasm(this.tree[0], index);
                return unmarshalNode(this.tree);
              }
              childForFieldId(fieldId) {
                marshalNode(this);
                C._ts_node_child_by_field_id_wasm(this.tree[0], fieldId);
                return unmarshalNode(this.tree);
              }
              childForFieldName(fieldName) {
                const fieldId = this.tree.language.fields.indexOf(fieldName);
                if (fieldId !== -1) return this.childForFieldId(fieldId);
                return null;
              }
              fieldNameForChild(index) {
                marshalNode(this);
                const address = C._ts_node_field_name_for_child_wasm(this.tree[0], index);
                if (!address) {
                  return null;
                }
                const result = AsciiToString(address);
                return result;
              }
              childrenForFieldName(fieldName) {
                const fieldId = this.tree.language.fields.indexOf(fieldName);
                if (fieldId !== -1 && fieldId !== 0) return this.childrenForFieldId(fieldId);
                return [];
              }
              childrenForFieldId(fieldId) {
                marshalNode(this);
                C._ts_node_children_by_field_id_wasm(this.tree[0], fieldId);
                const count = getValue(TRANSFER_BUFFER, "i32");
                const buffer = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                const result = new Array(count);
                if (count > 0) {
                  let address = buffer;
                  for (let i2 = 0; i2 < count; i2++) {
                    result[i2] = unmarshalNode(this.tree, address);
                    address += SIZE_OF_NODE;
                  }
                  C._free(buffer);
                }
                return result;
              }
              firstChildForIndex(index) {
                marshalNode(this);
                const address = TRANSFER_BUFFER + SIZE_OF_NODE;
                setValue(address, index, "i32");
                C._ts_node_first_child_for_byte_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              firstNamedChildForIndex(index) {
                marshalNode(this);
                const address = TRANSFER_BUFFER + SIZE_OF_NODE;
                setValue(address, index, "i32");
                C._ts_node_first_named_child_for_byte_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              get childCount() {
                marshalNode(this);
                return C._ts_node_child_count_wasm(this.tree[0]);
              }
              get namedChildCount() {
                marshalNode(this);
                return C._ts_node_named_child_count_wasm(this.tree[0]);
              }
              get firstChild() {
                return this.child(0);
              }
              get firstNamedChild() {
                return this.namedChild(0);
              }
              get lastChild() {
                return this.child(this.childCount - 1);
              }
              get lastNamedChild() {
                return this.namedChild(this.namedChildCount - 1);
              }
              get children() {
                if (!this._children) {
                  marshalNode(this);
                  C._ts_node_children_wasm(this.tree[0]);
                  const count = getValue(TRANSFER_BUFFER, "i32");
                  const buffer = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                  this._children = new Array(count);
                  if (count > 0) {
                    let address = buffer;
                    for (let i2 = 0; i2 < count; i2++) {
                      this._children[i2] = unmarshalNode(this.tree, address);
                      address += SIZE_OF_NODE;
                    }
                    C._free(buffer);
                  }
                }
                return this._children;
              }
              get namedChildren() {
                if (!this._namedChildren) {
                  marshalNode(this);
                  C._ts_node_named_children_wasm(this.tree[0]);
                  const count = getValue(TRANSFER_BUFFER, "i32");
                  const buffer = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                  this._namedChildren = new Array(count);
                  if (count > 0) {
                    let address = buffer;
                    for (let i2 = 0; i2 < count; i2++) {
                      this._namedChildren[i2] = unmarshalNode(this.tree, address);
                      address += SIZE_OF_NODE;
                    }
                    C._free(buffer);
                  }
                }
                return this._namedChildren;
              }
              descendantsOfType(types, startPosition, endPosition) {
                if (!Array.isArray(types)) types = [types];
                if (!startPosition) startPosition = ZERO_POINT;
                if (!endPosition) endPosition = ZERO_POINT;
                const symbols = [];
                const typesBySymbol = this.tree.language.types;
                for (let i2 = 0, n = typesBySymbol.length; i2 < n; i2++) {
                  if (types.includes(typesBySymbol[i2])) {
                    symbols.push(i2);
                  }
                }
                const symbolsAddress = C._malloc(SIZE_OF_INT * symbols.length);
                for (let i2 = 0, n = symbols.length; i2 < n; i2++) {
                  setValue(symbolsAddress + i2 * SIZE_OF_INT, symbols[i2], "i32");
                }
                marshalNode(this);
                C._ts_node_descendants_of_type_wasm(this.tree[0], symbolsAddress, symbols.length, startPosition.row, startPosition.column, endPosition.row, endPosition.column);
                const descendantCount = getValue(TRANSFER_BUFFER, "i32");
                const descendantAddress = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                const result = new Array(descendantCount);
                if (descendantCount > 0) {
                  let address = descendantAddress;
                  for (let i2 = 0; i2 < descendantCount; i2++) {
                    result[i2] = unmarshalNode(this.tree, address);
                    address += SIZE_OF_NODE;
                  }
                }
                C._free(descendantAddress);
                C._free(symbolsAddress);
                return result;
              }
              get nextSibling() {
                marshalNode(this);
                C._ts_node_next_sibling_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              get previousSibling() {
                marshalNode(this);
                C._ts_node_prev_sibling_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              get nextNamedSibling() {
                marshalNode(this);
                C._ts_node_next_named_sibling_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              get previousNamedSibling() {
                marshalNode(this);
                C._ts_node_prev_named_sibling_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              get descendantCount() {
                marshalNode(this);
                return C._ts_node_descendant_count_wasm(this.tree[0]);
              }
              get parent() {
                marshalNode(this);
                C._ts_node_parent_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              descendantForIndex(start2, end = start2) {
                if (typeof start2 !== "number" || typeof end !== "number") {
                  throw new Error("Arguments must be numbers");
                }
                marshalNode(this);
                const address = TRANSFER_BUFFER + SIZE_OF_NODE;
                setValue(address, start2, "i32");
                setValue(address + SIZE_OF_INT, end, "i32");
                C._ts_node_descendant_for_index_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              namedDescendantForIndex(start2, end = start2) {
                if (typeof start2 !== "number" || typeof end !== "number") {
                  throw new Error("Arguments must be numbers");
                }
                marshalNode(this);
                const address = TRANSFER_BUFFER + SIZE_OF_NODE;
                setValue(address, start2, "i32");
                setValue(address + SIZE_OF_INT, end, "i32");
                C._ts_node_named_descendant_for_index_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              descendantForPosition(start2, end = start2) {
                if (!isPoint(start2) || !isPoint(end)) {
                  throw new Error("Arguments must be {row, column} objects");
                }
                marshalNode(this);
                const address = TRANSFER_BUFFER + SIZE_OF_NODE;
                marshalPoint(address, start2);
                marshalPoint(address + SIZE_OF_POINT, end);
                C._ts_node_descendant_for_position_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              namedDescendantForPosition(start2, end = start2) {
                if (!isPoint(start2) || !isPoint(end)) {
                  throw new Error("Arguments must be {row, column} objects");
                }
                marshalNode(this);
                const address = TRANSFER_BUFFER + SIZE_OF_NODE;
                marshalPoint(address, start2);
                marshalPoint(address + SIZE_OF_POINT, end);
                C._ts_node_named_descendant_for_position_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              walk() {
                marshalNode(this);
                C._ts_tree_cursor_new_wasm(this.tree[0]);
                return new TreeCursor(INTERNAL, this.tree);
              }
              toString() {
                marshalNode(this);
                const address = C._ts_node_to_string_wasm(this.tree[0]);
                const result = AsciiToString(address);
                C._free(address);
                return result;
              }
            }
            class TreeCursor {
              constructor(internal, tree) {
                assertInternal(internal);
                this.tree = tree;
                unmarshalTreeCursor(this);
              }
              delete() {
                marshalTreeCursor(this);
                C._ts_tree_cursor_delete_wasm(this.tree[0]);
                this[0] = this[1] = this[2] = 0;
              }
              reset(node) {
                marshalNode(node);
                marshalTreeCursor(this, TRANSFER_BUFFER + SIZE_OF_NODE);
                C._ts_tree_cursor_reset_wasm(this.tree[0]);
                unmarshalTreeCursor(this);
              }
              resetTo(cursor) {
                marshalTreeCursor(this, TRANSFER_BUFFER);
                marshalTreeCursor(cursor, TRANSFER_BUFFER + SIZE_OF_CURSOR);
                C._ts_tree_cursor_reset_to_wasm(this.tree[0], cursor.tree[0]);
                unmarshalTreeCursor(this);
              }
              get nodeType() {
                return this.tree.language.types[this.nodeTypeId] || "ERROR";
              }
              get nodeTypeId() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_current_node_type_id_wasm(this.tree[0]);
              }
              get nodeStateId() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_current_node_state_id_wasm(this.tree[0]);
              }
              get nodeId() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_current_node_id_wasm(this.tree[0]);
              }
              get nodeIsNamed() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_current_node_is_named_wasm(this.tree[0]) === 1;
              }
              get nodeIsMissing() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_current_node_is_missing_wasm(this.tree[0]) === 1;
              }
              get nodeText() {
                marshalTreeCursor(this);
                const startIndex = C._ts_tree_cursor_start_index_wasm(this.tree[0]);
                const endIndex = C._ts_tree_cursor_end_index_wasm(this.tree[0]);
                return getText(this.tree, startIndex, endIndex);
              }
              get startPosition() {
                marshalTreeCursor(this);
                C._ts_tree_cursor_start_position_wasm(this.tree[0]);
                return unmarshalPoint(TRANSFER_BUFFER);
              }
              get endPosition() {
                marshalTreeCursor(this);
                C._ts_tree_cursor_end_position_wasm(this.tree[0]);
                return unmarshalPoint(TRANSFER_BUFFER);
              }
              get startIndex() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_start_index_wasm(this.tree[0]);
              }
              get endIndex() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_end_index_wasm(this.tree[0]);
              }
              get currentNode() {
                marshalTreeCursor(this);
                C._ts_tree_cursor_current_node_wasm(this.tree[0]);
                return unmarshalNode(this.tree);
              }
              get currentFieldId() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_current_field_id_wasm(this.tree[0]);
              }
              get currentFieldName() {
                return this.tree.language.fields[this.currentFieldId];
              }
              get currentDepth() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_current_depth_wasm(this.tree[0]);
              }
              get currentDescendantIndex() {
                marshalTreeCursor(this);
                return C._ts_tree_cursor_current_descendant_index_wasm(this.tree[0]);
              }
              gotoFirstChild() {
                marshalTreeCursor(this);
                const result = C._ts_tree_cursor_goto_first_child_wasm(this.tree[0]);
                unmarshalTreeCursor(this);
                return result === 1;
              }
              gotoLastChild() {
                marshalTreeCursor(this);
                const result = C._ts_tree_cursor_goto_last_child_wasm(this.tree[0]);
                unmarshalTreeCursor(this);
                return result === 1;
              }
              gotoFirstChildForIndex(goalIndex) {
                marshalTreeCursor(this);
                setValue(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalIndex, "i32");
                const result = C._ts_tree_cursor_goto_first_child_for_index_wasm(this.tree[0]);
                unmarshalTreeCursor(this);
                return result === 1;
              }
              gotoFirstChildForPosition(goalPosition) {
                marshalTreeCursor(this);
                marshalPoint(TRANSFER_BUFFER + SIZE_OF_CURSOR, goalPosition);
                const result = C._ts_tree_cursor_goto_first_child_for_position_wasm(this.tree[0]);
                unmarshalTreeCursor(this);
                return result === 1;
              }
              gotoNextSibling() {
                marshalTreeCursor(this);
                const result = C._ts_tree_cursor_goto_next_sibling_wasm(this.tree[0]);
                unmarshalTreeCursor(this);
                return result === 1;
              }
              gotoPreviousSibling() {
                marshalTreeCursor(this);
                const result = C._ts_tree_cursor_goto_previous_sibling_wasm(this.tree[0]);
                unmarshalTreeCursor(this);
                return result === 1;
              }
              gotoDescendant(goalDescendantindex) {
                marshalTreeCursor(this);
                C._ts_tree_cursor_goto_descendant_wasm(this.tree[0], goalDescendantindex);
                unmarshalTreeCursor(this);
              }
              gotoParent() {
                marshalTreeCursor(this);
                const result = C._ts_tree_cursor_goto_parent_wasm(this.tree[0]);
                unmarshalTreeCursor(this);
                return result === 1;
              }
            }
            class Language {
              constructor(internal, address) {
                assertInternal(internal);
                this[0] = address;
                this.types = new Array(C._ts_language_symbol_count(this[0]));
                for (let i2 = 0, n = this.types.length; i2 < n; i2++) {
                  if (C._ts_language_symbol_type(this[0], i2) < 2) {
                    this.types[i2] = UTF8ToString(C._ts_language_symbol_name(this[0], i2));
                  }
                }
                this.fields = new Array(C._ts_language_field_count(this[0]) + 1);
                for (let i2 = 0, n = this.fields.length; i2 < n; i2++) {
                  const fieldName = C._ts_language_field_name_for_id(this[0], i2);
                  if (fieldName !== 0) {
                    this.fields[i2] = UTF8ToString(fieldName);
                  } else {
                    this.fields[i2] = null;
                  }
                }
              }
              get version() {
                return C._ts_language_version(this[0]);
              }
              get fieldCount() {
                return this.fields.length - 1;
              }
              get stateCount() {
                return C._ts_language_state_count(this[0]);
              }
              fieldIdForName(fieldName) {
                const result = this.fields.indexOf(fieldName);
                if (result !== -1) {
                  return result;
                } else {
                  return null;
                }
              }
              fieldNameForId(fieldId) {
                return this.fields[fieldId] || null;
              }
              idForNodeType(type, named) {
                const typeLength = lengthBytesUTF8(type);
                const typeAddress = C._malloc(typeLength + 1);
                stringToUTF8(type, typeAddress, typeLength + 1);
                const result = C._ts_language_symbol_for_name(this[0], typeAddress, typeLength, named);
                C._free(typeAddress);
                return result || null;
              }
              get nodeTypeCount() {
                return C._ts_language_symbol_count(this[0]);
              }
              nodeTypeForId(typeId) {
                const name2 = C._ts_language_symbol_name(this[0], typeId);
                return name2 ? UTF8ToString(name2) : null;
              }
              nodeTypeIsNamed(typeId) {
                return C._ts_language_type_is_named_wasm(this[0], typeId) ? true : false;
              }
              nodeTypeIsVisible(typeId) {
                return C._ts_language_type_is_visible_wasm(this[0], typeId) ? true : false;
              }
              nextState(stateId, typeId) {
                return C._ts_language_next_state(this[0], stateId, typeId);
              }
              lookaheadIterator(stateId) {
                const address = C._ts_lookahead_iterator_new(this[0], stateId);
                if (address) return new LookaheadIterable(INTERNAL, address, this);
                return null;
              }
              query(source) {
                const sourceLength = lengthBytesUTF8(source);
                const sourceAddress = C._malloc(sourceLength + 1);
                stringToUTF8(source, sourceAddress, sourceLength + 1);
                const address = C._ts_query_new(this[0], sourceAddress, sourceLength, TRANSFER_BUFFER, TRANSFER_BUFFER + SIZE_OF_INT);
                if (!address) {
                  const errorId = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                  const errorByte = getValue(TRANSFER_BUFFER, "i32");
                  const errorIndex = UTF8ToString(sourceAddress, errorByte).length;
                  const suffix = source.substr(errorIndex, 100).split("\n")[0];
                  let word = suffix.match(QUERY_WORD_REGEX)[0];
                  let error;
                  switch (errorId) {
                    case 2:
                      error = new RangeError(`Bad node name '${word}'`);
                      break;
                    case 3:
                      error = new RangeError(`Bad field name '${word}'`);
                      break;
                    case 4:
                      error = new RangeError(`Bad capture name @${word}`);
                      break;
                    case 5:
                      error = new TypeError(`Bad pattern structure at offset ${errorIndex}: '${suffix}'...`);
                      word = "";
                      break;
                    default:
                      error = new SyntaxError(`Bad syntax at offset ${errorIndex}: '${suffix}'...`);
                      word = "";
                      break;
                  }
                  error.index = errorIndex;
                  error.length = word.length;
                  C._free(sourceAddress);
                  throw error;
                }
                const stringCount = C._ts_query_string_count(address);
                const captureCount = C._ts_query_capture_count(address);
                const patternCount = C._ts_query_pattern_count(address);
                const captureNames = new Array(captureCount);
                const stringValues = new Array(stringCount);
                for (let i2 = 0; i2 < captureCount; i2++) {
                  const nameAddress = C._ts_query_capture_name_for_id(address, i2, TRANSFER_BUFFER);
                  const nameLength = getValue(TRANSFER_BUFFER, "i32");
                  captureNames[i2] = UTF8ToString(nameAddress, nameLength);
                }
                for (let i2 = 0; i2 < stringCount; i2++) {
                  const valueAddress = C._ts_query_string_value_for_id(address, i2, TRANSFER_BUFFER);
                  const nameLength = getValue(TRANSFER_BUFFER, "i32");
                  stringValues[i2] = UTF8ToString(valueAddress, nameLength);
                }
                const setProperties = new Array(patternCount);
                const assertedProperties = new Array(patternCount);
                const refutedProperties = new Array(patternCount);
                const predicates = new Array(patternCount);
                const textPredicates = new Array(patternCount);
                for (let i2 = 0; i2 < patternCount; i2++) {
                  const predicatesAddress = C._ts_query_predicates_for_pattern(address, i2, TRANSFER_BUFFER);
                  const stepCount = getValue(TRANSFER_BUFFER, "i32");
                  predicates[i2] = [];
                  textPredicates[i2] = [];
                  const steps = [];
                  let stepAddress = predicatesAddress;
                  for (let j = 0; j < stepCount; j++) {
                    const stepType = getValue(stepAddress, "i32");
                    stepAddress += SIZE_OF_INT;
                    const stepValueId = getValue(stepAddress, "i32");
                    stepAddress += SIZE_OF_INT;
                    if (stepType === PREDICATE_STEP_TYPE_CAPTURE) {
                      steps.push({
                        type: "capture",
                        name: captureNames[stepValueId]
                      });
                    } else if (stepType === PREDICATE_STEP_TYPE_STRING) {
                      steps.push({
                        type: "string",
                        value: stringValues[stepValueId]
                      });
                    } else if (steps.length > 0) {
                      if (steps[0].type !== "string") {
                        throw new Error("Predicates must begin with a literal value");
                      }
                      const operator = steps[0].value;
                      let isPositive = true;
                      let matchAll = true;
                      let captureName;
                      switch (operator) {
                        case "any-not-eq?":
                        case "not-eq?":
                          isPositive = false;
                        case "any-eq?":
                        case "eq?":
                          if (steps.length !== 3) {
                            throw new Error(`Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}`);
                          }
                          if (steps[1].type !== "capture") {
                            throw new Error(`First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}"`);
                          }
                          matchAll = !operator.startsWith("any-");
                          if (steps[2].type === "capture") {
                            const captureName1 = steps[1].name;
                            const captureName2 = steps[2].name;
                            textPredicates[i2].push((captures) => {
                              const nodes1 = [];
                              const nodes2 = [];
                              for (const c of captures) {
                                if (c.name === captureName1) nodes1.push(c.node);
                                if (c.name === captureName2) nodes2.push(c.node);
                              }
                              const compare = (n1, n2, positive) => positive ? n1.text === n2.text : n1.text !== n2.text;
                              return matchAll ? nodes1.every((n1) => nodes2.some((n2) => compare(n1, n2, isPositive))) : nodes1.some((n1) => nodes2.some((n2) => compare(n1, n2, isPositive)));
                            });
                          } else {
                            captureName = steps[1].name;
                            const stringValue = steps[2].value;
                            const matches = (n) => n.text === stringValue;
                            const doesNotMatch = (n) => n.text !== stringValue;
                            textPredicates[i2].push((captures) => {
                              const nodes = [];
                              for (const c of captures) {
                                if (c.name === captureName) nodes.push(c.node);
                              }
                              const test = isPositive ? matches : doesNotMatch;
                              return matchAll ? nodes.every(test) : nodes.some(test);
                            });
                          }
                          break;
                        case "any-not-match?":
                        case "not-match?":
                          isPositive = false;
                        case "any-match?":
                        case "match?":
                          if (steps.length !== 3) {
                            throw new Error(`Wrong number of arguments to \`#${operator}\` predicate. Expected 2, got ${steps.length - 1}.`);
                          }
                          if (steps[1].type !== "capture") {
                            throw new Error(`First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`);
                          }
                          if (steps[2].type !== "string") {
                            throw new Error(`Second argument of \`#${operator}\` predicate must be a string. Got @${steps[2].value}.`);
                          }
                          captureName = steps[1].name;
                          const regex = new RegExp(steps[2].value);
                          matchAll = !operator.startsWith("any-");
                          textPredicates[i2].push((captures) => {
                            const nodes = [];
                            for (const c of captures) {
                              if (c.name === captureName) nodes.push(c.node.text);
                            }
                            const test = (text, positive) => positive ? regex.test(text) : !regex.test(text);
                            if (nodes.length === 0) return !isPositive;
                            return matchAll ? nodes.every((text) => test(text, isPositive)) : nodes.some((text) => test(text, isPositive));
                          });
                          break;
                        case "set!":
                          if (steps.length < 2 || steps.length > 3) {
                            throw new Error(`Wrong number of arguments to \`#set!\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`);
                          }
                          if (steps.some((s) => s.type !== "string")) {
                            throw new Error(`Arguments to \`#set!\` predicate must be a strings.".`);
                          }
                          if (!setProperties[i2]) setProperties[i2] = {};
                          setProperties[i2][steps[1].value] = steps[2] ? steps[2].value : null;
                          break;
                        case "is?":
                        case "is-not?":
                          if (steps.length < 2 || steps.length > 3) {
                            throw new Error(`Wrong number of arguments to \`#${operator}\` predicate. Expected 1 or 2. Got ${steps.length - 1}.`);
                          }
                          if (steps.some((s) => s.type !== "string")) {
                            throw new Error(`Arguments to \`#${operator}\` predicate must be a strings.".`);
                          }
                          const properties = operator === "is?" ? assertedProperties : refutedProperties;
                          if (!properties[i2]) properties[i2] = {};
                          properties[i2][steps[1].value] = steps[2] ? steps[2].value : null;
                          break;
                        case "not-any-of?":
                          isPositive = false;
                        case "any-of?":
                          if (steps.length < 2) {
                            throw new Error(`Wrong number of arguments to \`#${operator}\` predicate. Expected at least 1. Got ${steps.length - 1}.`);
                          }
                          if (steps[1].type !== "capture") {
                            throw new Error(`First argument of \`#${operator}\` predicate must be a capture. Got "${steps[1].value}".`);
                          }
                          for (let i3 = 2; i3 < steps.length; i3++) {
                            if (steps[i3].type !== "string") {
                              throw new Error(`Arguments to \`#${operator}\` predicate must be a strings.".`);
                            }
                          }
                          captureName = steps[1].name;
                          const values = steps.slice(2).map((s) => s.value);
                          textPredicates[i2].push((captures) => {
                            const nodes = [];
                            for (const c of captures) {
                              if (c.name === captureName) nodes.push(c.node.text);
                            }
                            if (nodes.length === 0) return !isPositive;
                            return nodes.every((text) => values.includes(text)) === isPositive;
                          });
                          break;
                        default:
                          predicates[i2].push({
                            operator,
                            operands: steps.slice(1)
                          });
                      }
                      steps.length = 0;
                    }
                  }
                  Object.freeze(setProperties[i2]);
                  Object.freeze(assertedProperties[i2]);
                  Object.freeze(refutedProperties[i2]);
                }
                C._free(sourceAddress);
                return new Query(INTERNAL, address, captureNames, textPredicates, predicates, Object.freeze(setProperties), Object.freeze(assertedProperties), Object.freeze(refutedProperties));
              }
              static load(input) {
                let bytes;
                if (input instanceof Uint8Array) {
                  bytes = Promise.resolve(input);
                } else {
                  const url = input;
                  if (typeof process !== "undefined" && process.versions && process.versions.node) {
                    const fs2 = __require("fs");
                    bytes = Promise.resolve(fs2.readFileSync(url));
                  } else {
                    bytes = fetch(url).then((response) => response.arrayBuffer().then((buffer) => {
                      if (response.ok) {
                        return new Uint8Array(buffer);
                      } else {
                        const body2 = new TextDecoder("utf-8").decode(buffer);
                        throw new Error(`Language.load failed with status ${response.status}.

${body2}`);
                      }
                    }));
                  }
                }
                return bytes.then((bytes2) => loadWebAssemblyModule(bytes2, {
                  loadAsync: true
                })).then((mod) => {
                  const symbolNames = Object.keys(mod);
                  const functionName = symbolNames.find((key) => LANGUAGE_FUNCTION_REGEX.test(key) && !key.includes("external_scanner_"));
                  if (!functionName) {
                    console.log(`Couldn't find language function in WASM file. Symbols:
${JSON.stringify(symbolNames, null, 2)}`);
                  }
                  const languageAddress = mod[functionName]();
                  return new Language(INTERNAL, languageAddress);
                });
              }
            }
            class LookaheadIterable {
              constructor(internal, address, language) {
                assertInternal(internal);
                this[0] = address;
                this.language = language;
              }
              get currentTypeId() {
                return C._ts_lookahead_iterator_current_symbol(this[0]);
              }
              get currentType() {
                return this.language.types[this.currentTypeId] || "ERROR";
              }
              delete() {
                C._ts_lookahead_iterator_delete(this[0]);
                this[0] = 0;
              }
              resetState(stateId) {
                return C._ts_lookahead_iterator_reset_state(this[0], stateId);
              }
              reset(language, stateId) {
                if (C._ts_lookahead_iterator_reset(this[0], language[0], stateId)) {
                  this.language = language;
                  return true;
                }
                return false;
              }
              [Symbol.iterator]() {
                const self2 = this;
                return {
                  next() {
                    if (C._ts_lookahead_iterator_next(self2[0])) {
                      return {
                        done: false,
                        value: self2.currentType
                      };
                    }
                    return {
                      done: true,
                      value: ""
                    };
                  }
                };
              }
            }
            class Query {
              constructor(internal, address, captureNames, textPredicates, predicates, setProperties, assertedProperties, refutedProperties) {
                assertInternal(internal);
                this[0] = address;
                this.captureNames = captureNames;
                this.textPredicates = textPredicates;
                this.predicates = predicates;
                this.setProperties = setProperties;
                this.assertedProperties = assertedProperties;
                this.refutedProperties = refutedProperties;
                this.exceededMatchLimit = false;
              }
              delete() {
                C._ts_query_delete(this[0]);
                this[0] = 0;
              }
              matches(node, { startPosition = ZERO_POINT, endPosition = ZERO_POINT, startIndex = 0, endIndex = 0, matchLimit = 4294967295, maxStartDepth = 4294967295, timeoutMicros = 0 } = {}) {
                if (typeof matchLimit !== "number") {
                  throw new Error("Arguments must be numbers");
                }
                marshalNode(node);
                C._ts_query_matches_wasm(this[0], node.tree[0], startPosition.row, startPosition.column, endPosition.row, endPosition.column, startIndex, endIndex, matchLimit, maxStartDepth, timeoutMicros);
                const rawCount = getValue(TRANSFER_BUFFER, "i32");
                const startAddress = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                const didExceedMatchLimit = getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
                const result = new Array(rawCount);
                this.exceededMatchLimit = Boolean(didExceedMatchLimit);
                let filteredCount = 0;
                let address = startAddress;
                for (let i2 = 0; i2 < rawCount; i2++) {
                  const pattern = getValue(address, "i32");
                  address += SIZE_OF_INT;
                  const captureCount = getValue(address, "i32");
                  address += SIZE_OF_INT;
                  const captures = new Array(captureCount);
                  address = unmarshalCaptures(this, node.tree, address, captures);
                  if (this.textPredicates[pattern].every((p) => p(captures))) {
                    result[filteredCount] = {
                      pattern,
                      captures
                    };
                    const setProperties = this.setProperties[pattern];
                    if (setProperties) result[filteredCount].setProperties = setProperties;
                    const assertedProperties = this.assertedProperties[pattern];
                    if (assertedProperties) result[filteredCount].assertedProperties = assertedProperties;
                    const refutedProperties = this.refutedProperties[pattern];
                    if (refutedProperties) result[filteredCount].refutedProperties = refutedProperties;
                    filteredCount++;
                  }
                }
                result.length = filteredCount;
                C._free(startAddress);
                return result;
              }
              captures(node, { startPosition = ZERO_POINT, endPosition = ZERO_POINT, startIndex = 0, endIndex = 0, matchLimit = 4294967295, maxStartDepth = 4294967295, timeoutMicros = 0 } = {}) {
                if (typeof matchLimit !== "number") {
                  throw new Error("Arguments must be numbers");
                }
                marshalNode(node);
                C._ts_query_captures_wasm(this[0], node.tree[0], startPosition.row, startPosition.column, endPosition.row, endPosition.column, startIndex, endIndex, matchLimit, maxStartDepth, timeoutMicros);
                const count = getValue(TRANSFER_BUFFER, "i32");
                const startAddress = getValue(TRANSFER_BUFFER + SIZE_OF_INT, "i32");
                const didExceedMatchLimit = getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
                const result = [];
                this.exceededMatchLimit = Boolean(didExceedMatchLimit);
                const captures = [];
                let address = startAddress;
                for (let i2 = 0; i2 < count; i2++) {
                  const pattern = getValue(address, "i32");
                  address += SIZE_OF_INT;
                  const captureCount = getValue(address, "i32");
                  address += SIZE_OF_INT;
                  const captureIndex = getValue(address, "i32");
                  address += SIZE_OF_INT;
                  captures.length = captureCount;
                  address = unmarshalCaptures(this, node.tree, address, captures);
                  if (this.textPredicates[pattern].every((p) => p(captures))) {
                    const capture = captures[captureIndex];
                    const setProperties = this.setProperties[pattern];
                    if (setProperties) capture.setProperties = setProperties;
                    const assertedProperties = this.assertedProperties[pattern];
                    if (assertedProperties) capture.assertedProperties = assertedProperties;
                    const refutedProperties = this.refutedProperties[pattern];
                    if (refutedProperties) capture.refutedProperties = refutedProperties;
                    result.push(capture);
                  }
                }
                C._free(startAddress);
                return result;
              }
              predicatesForPattern(patternIndex) {
                return this.predicates[patternIndex];
              }
              disableCapture(captureName) {
                const captureNameLength = lengthBytesUTF8(captureName);
                const captureNameAddress = C._malloc(captureNameLength + 1);
                stringToUTF8(captureName, captureNameAddress, captureNameLength + 1);
                C._ts_query_disable_capture(this[0], captureNameAddress, captureNameLength);
                C._free(captureNameAddress);
              }
              didExceedMatchLimit() {
                return this.exceededMatchLimit;
              }
            }
            function getText(tree, startIndex, endIndex) {
              const length = endIndex - startIndex;
              let result = tree.textCallback(startIndex, null, endIndex);
              startIndex += result.length;
              while (startIndex < endIndex) {
                const string = tree.textCallback(startIndex, null, endIndex);
                if (string && string.length > 0) {
                  startIndex += string.length;
                  result += string;
                } else {
                  break;
                }
              }
              if (startIndex > endIndex) {
                result = result.slice(0, length);
              }
              return result;
            }
            function unmarshalCaptures(query, tree, address, result) {
              for (let i2 = 0, n = result.length; i2 < n; i2++) {
                const captureIndex = getValue(address, "i32");
                address += SIZE_OF_INT;
                const node = unmarshalNode(tree, address);
                address += SIZE_OF_NODE;
                result[i2] = {
                  name: query.captureNames[captureIndex],
                  node
                };
              }
              return address;
            }
            function assertInternal(x) {
              if (x !== INTERNAL) throw new Error("Illegal constructor");
            }
            function isPoint(point) {
              return point && typeof point.row === "number" && typeof point.column === "number";
            }
            function marshalNode(node) {
              let address = TRANSFER_BUFFER;
              setValue(address, node.id, "i32");
              address += SIZE_OF_INT;
              setValue(address, node.startIndex, "i32");
              address += SIZE_OF_INT;
              setValue(address, node.startPosition.row, "i32");
              address += SIZE_OF_INT;
              setValue(address, node.startPosition.column, "i32");
              address += SIZE_OF_INT;
              setValue(address, node[0], "i32");
            }
            function unmarshalNode(tree, address = TRANSFER_BUFFER) {
              const id = getValue(address, "i32");
              address += SIZE_OF_INT;
              if (id === 0) return null;
              const index = getValue(address, "i32");
              address += SIZE_OF_INT;
              const row = getValue(address, "i32");
              address += SIZE_OF_INT;
              const column = getValue(address, "i32");
              address += SIZE_OF_INT;
              const other = getValue(address, "i32");
              const result = new Node(INTERNAL, tree);
              result.id = id;
              result.startIndex = index;
              result.startPosition = {
                row,
                column
              };
              result[0] = other;
              return result;
            }
            function marshalTreeCursor(cursor, address = TRANSFER_BUFFER) {
              setValue(address + 0 * SIZE_OF_INT, cursor[0], "i32");
              setValue(address + 1 * SIZE_OF_INT, cursor[1], "i32");
              setValue(address + 2 * SIZE_OF_INT, cursor[2], "i32");
              setValue(address + 3 * SIZE_OF_INT, cursor[3], "i32");
            }
            function unmarshalTreeCursor(cursor) {
              cursor[0] = getValue(TRANSFER_BUFFER + 0 * SIZE_OF_INT, "i32");
              cursor[1] = getValue(TRANSFER_BUFFER + 1 * SIZE_OF_INT, "i32");
              cursor[2] = getValue(TRANSFER_BUFFER + 2 * SIZE_OF_INT, "i32");
              cursor[3] = getValue(TRANSFER_BUFFER + 3 * SIZE_OF_INT, "i32");
            }
            function marshalPoint(address, point) {
              setValue(address, point.row, "i32");
              setValue(address + SIZE_OF_INT, point.column, "i32");
            }
            function unmarshalPoint(address) {
              const result = {
                row: getValue(address, "i32") >>> 0,
                column: getValue(address + SIZE_OF_INT, "i32") >>> 0
              };
              return result;
            }
            function marshalRange(address, range) {
              marshalPoint(address, range.startPosition);
              address += SIZE_OF_POINT;
              marshalPoint(address, range.endPosition);
              address += SIZE_OF_POINT;
              setValue(address, range.startIndex, "i32");
              address += SIZE_OF_INT;
              setValue(address, range.endIndex, "i32");
              address += SIZE_OF_INT;
            }
            function unmarshalRange(address) {
              const result = {};
              result.startPosition = unmarshalPoint(address);
              address += SIZE_OF_POINT;
              result.endPosition = unmarshalPoint(address);
              address += SIZE_OF_POINT;
              result.startIndex = getValue(address, "i32") >>> 0;
              address += SIZE_OF_INT;
              result.endIndex = getValue(address, "i32") >>> 0;
              return result;
            }
            function marshalEdit(edit) {
              let address = TRANSFER_BUFFER;
              marshalPoint(address, edit.startPosition);
              address += SIZE_OF_POINT;
              marshalPoint(address, edit.oldEndPosition);
              address += SIZE_OF_POINT;
              marshalPoint(address, edit.newEndPosition);
              address += SIZE_OF_POINT;
              setValue(address, edit.startIndex, "i32");
              address += SIZE_OF_INT;
              setValue(address, edit.oldEndIndex, "i32");
              address += SIZE_OF_INT;
              setValue(address, edit.newEndIndex, "i32");
              address += SIZE_OF_INT;
            }
            for (const name2 of Object.getOwnPropertyNames(ParserImpl.prototype)) {
              Object.defineProperty(Parser.prototype, name2, {
                value: ParserImpl.prototype[name2],
                enumerable: false,
                writable: false
              });
            }
            Parser.Language = Language;
            Module.onRuntimeInitialized = () => {
              ParserImpl.init();
              resolveInitPromise();
            };
          });
        }
      }
      return Parser;
    })();
    if (typeof exports === "object") {
      module.exports = TreeSitter;
    }
  }
});

// src/native/code-compressor.ts
var code_compressor_exports = {};
__export(code_compressor_exports, {
  DEFAULT_CODE_COMPRESSOR_CONFIG: () => DEFAULT_CODE_COMPRESSOR_CONFIG,
  compressCode: () => compressCode,
  detectLanguage: () => detectLanguage,
  initCodeCompressor: () => initCodeCompressor
});
import { createRequire } from "node:module";
function grammarWasmDir() {
  const pkgJsonPath = nodeRequire.resolve("tree-sitter-wasms/package.json");
  return pkgJsonPath.slice(0, -"package.json".length) + "out";
}
async function ensureInit() {
  if (!initPromise2) {
    initPromise2 = import_web_tree_sitter.default.init();
  }
  return initPromise2;
}
async function getLanguage(lang) {
  if (lang === "unknown") return null;
  await ensureInit();
  let language = languageCache.get(lang);
  if (!language) {
    const wasmPath = `${grammarWasmDir()}/tree-sitter-${lang}.wasm`;
    language = await import_web_tree_sitter.default.Language.load(wasmPath);
    languageCache.set(lang, language);
  }
  return language;
}
async function getParser(lang) {
  const language = await getLanguage(lang);
  if (!language) return null;
  let parser = parserCache.get(lang);
  if (!parser) {
    parser = new import_web_tree_sitter.default();
    parserCache.set(lang, parser);
  }
  parser.setLanguage(language);
  return parser;
}
async function parseCode(code, language) {
  const parser = await getParser(language);
  if (!parser) return null;
  return parser.parse(code) ?? null;
}
async function initCodeCompressor(languages = ALL_LANGUAGES) {
  await ensureInit();
  await Promise.all(languages.map((l) => getLanguage(l)));
}
function getLangConfig(language) {
  return language === "unknown" ? null : LANG_CONFIGS[language];
}
function emptyStructure() {
  return {
    imports: [],
    typeDefinitions: [],
    classDefinitions: [],
    functionSignatures: [],
    functionBodies: [],
    topLevelCode: [],
    other: []
  };
}
function emptyAnalysis() {
  return { scores: [], calls: [], bareNames: /* @__PURE__ */ new Map(), bodyLineCounts: /* @__PURE__ */ new Map() };
}
function getDefinitionName(node) {
  for (const child of node.children) {
    if (!child) continue;
    const k = child.type;
    if (k === "identifier" || k === "name" || k === "type_identifier" || k === "property_identifier") {
      return child.text;
    }
  }
  return void 0;
}
function findExportedFunctionValue(declNode) {
  const declarators = declNode.children.filter(
    (c) => c !== null && c.type === "variable_declarator"
  );
  if (declarators.length !== 1) return void 0;
  const declarator = declarators[0];
  let name2;
  let valueNode;
  for (const child of declarator.children) {
    if (!child) continue;
    if (child.type === "identifier" && name2 === void 0) name2 = child.text;
    if (child.type === "arrow_function" || child.type === "function_expression") valueNode = child;
  }
  return valueNode ? { name: name2, valueNode } : void 0;
}
function queryContextTokens(context) {
  if (context === "") return [/* @__PURE__ */ new Set(), "", false];
  const lowered = context.toLowerCase();
  const words = new Set(lowered.split(CONTEXT_DELIMS).filter((s) => s.length > 0));
  const hasCjk = CJK_CHARS.test(lowered);
  return [words, lowered, hasCjk];
}
function symbolInContext(nameLower, words, contextLower, hasCjk) {
  if (words.size === 0 || nameLower === "") return false;
  if (words.has(nameLower)) return true;
  return contextLower.includes(nameLower) && ([...nameLower].length > 3 || hasCjk);
}
function isUppercaseChar(ch) {
  return ch !== "" && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}
function isPublicSymbol(name2, language) {
  if (name2 === "") return false;
  if (language === "go") return isUppercaseChar(name2.charAt(0));
  return !name2.startsWith("_");
}
function getBodyLimit(funcName, bodyLimits, maxBodyLines) {
  if (funcName !== void 0 && bodyLimits.size > 0) {
    const v = bodyLimits.get(funcName);
    if (v !== void 0) return Math.min(v, maxBodyLines);
  }
  return maxBodyLines;
}
function leadingWs(line) {
  const m = line.match(/^\s*/);
  return m ? m[0] : "";
}
function detectIndent(lines) {
  for (const line of lines) {
    if (line.trim() !== "") return leadingWs(line);
  }
  return "    ";
}
function makeOmittedComment(funcName, omittedCount, indent, commentPrefix, analysis) {
  let callsInfo = "";
  if (funcName !== void 0) {
    const suffix = `.${funcName}`;
    const candidates = [funcName];
    for (const [k] of analysis.calls) {
      if (k.endsWith(suffix)) candidates.push(k);
    }
    for (const key of candidates) {
      const entry = analysis.calls.find(([k]) => k === key);
      if (entry) {
        const called = entry[1];
        if (called.size > 0) {
          const sorted = [...called].sort();
          const shown = sorted.slice(0, 5);
          callsInfo = `; calls: ${shown.join(", ")}`;
          if (called.size > 5) callsInfo += ` +${called.size - 5} more`;
        }
        break;
      }
    }
  }
  return `${indent}${commentPrefix} [${omittedCount} lines omitted${callsInfo}]`;
}
function countErrorNodes(node) {
  let count = node.type === "ERROR" || node.isMissing ? 1 : 0;
  for (const child of node.children) {
    if (child) count += countErrorNodes(child);
  }
  return count;
}
function hasSyntaxIssues(node) {
  if (node.type === "ERROR" || node.isMissing) return true;
  for (const child of node.children) {
    if (child && hasSyntaxIssues(child)) return true;
  }
  return false;
}
function pyRoundInt(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
function pyRound3(x) {
  return Number(x.toFixed(3));
}
function estimateTokens(text) {
  const count = [...text].length;
  return Math.max(1, Math.floor(count / 4));
}
function charPrefix(s, n) {
  if (s.length <= n) return s;
  let out2 = "";
  let count = 0;
  for (const ch of s) {
    if (count >= n) break;
    out2 += ch;
    count++;
  }
  return out2;
}
function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}
function normalizeLanguage(input) {
  const lower = input.toLowerCase();
  return VALID_LANGUAGES.has(lower) ? lower : void 0;
}
function countMatches(re, sample) {
  const matches = sample.match(re);
  return matches ? matches.length : 0;
}
async function detectLanguage(code) {
  if (code.trim() === "") return ["unknown", 0];
  const sample = charPrefix(code, 5e3);
  const candidates = [];
  for (const { lang, patterns } of PREFILTER) {
    let score = 0;
    for (const pat of patterns) score += countMatches(pat, sample);
    if (score > 0) candidates.push([lang, score]);
  }
  if (candidates.length === 0) return ["unknown", 0];
  const get = (cs, l) => cs.find(([x]) => x === l)?.[1];
  const tsScore = get(candidates, "typescript");
  const jsScore = get(candidates, "javascript");
  if (tsScore !== void 0 && jsScore !== void 0 && tsScore >= 2) {
    const jsEntry = candidates.find(([x]) => x === "javascript");
    if (jsEntry) jsEntry[1] = 0;
  }
  const cppScore = get(candidates, "cpp");
  const cScore = get(candidates, "c");
  if (cppScore !== void 0 && cScore !== void 0 && cppScore >= 2) {
    const cEntry = candidates.find(([x]) => x === "c");
    if (cEntry) cEntry[1] = 0;
  }
  const codeSample10k = charPrefix(code, 1e4);
  let bestLang = "unknown";
  let minErrors = Infinity;
  let bestNodeCount = 0;
  const sortedCandidates = [...candidates].sort((a, b) => b[1] - a[1]);
  for (const [lang] of sortedCandidates) {
    if (lang === "unknown" || get(candidates, lang) === 0) continue;
    const tree = await parseCode(codeSample10k, lang);
    if (!tree) continue;
    const root = tree.rootNode;
    const errorCount = countErrorNodes(root);
    const nodeCount = root.childCount;
    if (errorCount < minErrors || errorCount === minErrors && nodeCount > bestNodeCount) {
      minErrors = errorCount;
      bestLang = lang;
      bestNodeCount = nodeCount;
    }
  }
  if (bestLang !== "unknown") {
    const totalLines = Math.max(1, code.trim().split("\n").length);
    const errorRatio = minErrors / totalLines;
    const confidence2 = clamp(1 - errorRatio, 0.3, 1);
    return [bestLang, confidence2];
  }
  let best = candidates[0];
  for (const cand of candidates.slice(1)) {
    if (cand[1] > best[1]) best = cand;
  }
  if (best[1] === 0) return ["unknown", 0];
  const confidence = Math.min(1, 0.3 + best[1] * 0.1);
  return [best[0], confidence];
}
function collectDefinitions(node, parentName, isDef, decoratorNode, definitions, bareNames) {
  const nt = node.type;
  if (isDef(nt)) {
    const short = getDefinitionName(node);
    if (short !== void 0) {
      const qualified = parentName === "" ? short : `${parentName}.${short}`;
      definitions.set(qualified, node);
      bareNames.set(qualified, short);
      for (const child of node.children) {
        if (child) collectDefinitions(child, qualified, isDef, decoratorNode, definitions, bareNames);
      }
      return;
    }
  }
  if (decoratorNode !== null && nt === decoratorNode) {
    for (const child of node.children) {
      if (!child) continue;
      if (isDef(child.type)) {
        const short = getDefinitionName(child);
        if (short !== void 0) {
          const qualified = parentName === "" ? short : `${parentName}.${short}`;
          definitions.set(qualified, child);
          bareNames.set(qualified, short);
          for (const grandchild of child.children) {
            if (grandchild) {
              collectDefinitions(grandchild, qualified, isDef, decoratorNode, definitions, bareNames);
            }
          }
          return;
        }
      }
    }
  }
  for (const child of node.children) {
    if (child) collectDefinitions(child, parentName, isDef, decoratorNode, definitions, bareNames);
  }
}
function collectIdentifiers(node, out2) {
  const k = node.type;
  if (k === "identifier" || k === "property_identifier" || k === "type_identifier") {
    out2.set(node.text, (out2.get(node.text) ?? 0) + 1);
  }
  for (const child of node.children) {
    if (child) collectIdentifiers(child, out2);
  }
}
function collectCalls(node, definedShortNames, funcShort, calls) {
  const k = node.type;
  if (k === "identifier" || k === "property_identifier") {
    const name2 = node.text;
    if (definedShortNames.has(name2) && name2 !== funcShort) calls.add(name2);
  }
  for (const child of node.children) {
    if (child) collectCalls(child, definedShortNames, funcShort, calls);
  }
}
function analyzeSymbolImportance(root, language, context, config) {
  if (!config.semanticAnalysis) return emptyAnalysis();
  const lang = getLangConfig(language);
  if (!lang) return emptyAnalysis();
  const isDef = (k) => lang.functionNodes.includes(k) || lang.classNodes.includes(k);
  const definitions = /* @__PURE__ */ new Map();
  const bareNames = /* @__PURE__ */ new Map();
  collectDefinitions(root, "", isDef, lang.decoratorNode, definitions, bareNames);
  if (definitions.size === 0) return emptyAnalysis();
  const allIdentifiers = /* @__PURE__ */ new Map();
  collectIdentifiers(root, allIdentifiers);
  const definedShortNames = new Set(bareNames.values());
  const functionCalls = [];
  const bodyLineCounts = /* @__PURE__ */ new Map();
  for (const [qname, node] of definitions) {
    const funcShort = bareNames.get(qname) ?? "";
    const calls = /* @__PURE__ */ new Set();
    collectCalls(node, definedShortNames, funcShort, calls);
    functionCalls.push([qname, calls]);
    const lineCount = node.text.split("\n").length;
    bodyLineCounts.set(qname, Math.max(1, lineCount - 2));
  }
  const shortNameDefCount = /* @__PURE__ */ new Map();
  for (const short of bareNames.values()) {
    shortNameDefCount.set(short, (shortNameDefCount.get(short) ?? 0) + 1);
  }
  const refCounts = /* @__PURE__ */ new Map();
  for (const qname of definitions.keys()) {
    const short = bareNames.get(qname);
    const count = allIdentifiers.get(short) ?? 0;
    const defCount = shortNameDefCount.get(short) ?? 1;
    refCounts.set(qname, Math.max(0, count - defCount));
  }
  const [contextWords, contextLower, contextHasCjk] = queryContextTokens(context);
  const rawSignals = [];
  for (const qname of definitions.keys()) {
    const short = bareNames.get(qname);
    const refs = refCounts.get(qname) ?? 0;
    const callsEntry = functionCalls.find(([k]) => k === qname);
    const fanOut = callsEntry ? callsEntry[1].size : 0;
    const isPublic = isPublicSymbol(short, language);
    let raw = refs;
    raw += isPublic ? 1 : 0;
    raw += fanOut * 0.5;
    if (language === "python" && short.startsWith("__") && short.endsWith("__")) {
      raw += 2;
    } else if (language === "go" && isUppercaseChar(short.charAt(0))) {
      raw += 1;
    }
    if (symbolInContext(short.toLowerCase(), contextWords, contextLower, contextHasCjk)) {
      raw += 3;
    }
    rawSignals.push([qname, raw]);
  }
  const values = rawSignals.map(([, v]) => v);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const rangeVal = maxVal - minVal;
  const scores = [];
  if (rangeVal > 0) {
    for (const [name2, v] of rawSignals) {
      scores.push([name2, pyRound3((v - minVal) / rangeVal)]);
    }
  } else {
    for (const [name2] of rawSignals) scores.push([name2, 0.5]);
  }
  return { scores, calls: functionCalls, bareNames, bodyLineCounts };
}
function allocateBodyBudget(analysis, code, config) {
  if (analysis.scores.length === 0 || analysis.bodyLineCounts.size === 0) return /* @__PURE__ */ new Map();
  const targetRate = config.targetCompressionRate;
  const totalLines = code.trim().split("\n").length;
  let totalBodyLines = 0;
  for (const v of analysis.bodyLineCounts.values()) totalBodyLines += v;
  const fixedLines = Math.max(0, totalLines - totalBodyLines);
  const targetTotal = totalLines * targetRate;
  const bodyBudget = Math.max(0, targetTotal - fixedLines);
  if (totalBodyLines === 0) return /* @__PURE__ */ new Map();
  const scoreFloor = 0.05;
  const weights = [];
  for (const [name2, score] of analysis.scores) {
    const s = Math.max(score, scoreFloor);
    const size = analysis.bodyLineCounts.get(name2) ?? 0;
    weights.push([name2, s * size]);
  }
  let totalWeight = 0;
  for (const [, w] of weights) totalWeight += w;
  const limits = /* @__PURE__ */ new Map();
  if (totalWeight === 0) {
    const perFunc = Math.max(0, Math.trunc(bodyBudget / Math.max(1, analysis.scores.length)));
    for (const [name2] of analysis.scores) {
      const size = analysis.bodyLineCounts.get(name2) ?? 0;
      limits.set(name2, Math.min(perFunc, size));
    }
    return limits;
  }
  for (const [qname] of analysis.scores) {
    const weight = weights.find(([k]) => k === qname)?.[1] ?? 0;
    const allocation = bodyBudget * weight / totalWeight;
    const maxLines = analysis.bodyLineCounts.get(qname) ?? 0;
    const limit = Math.min(pyRoundInt(allocation), maxLines);
    limits.set(qname, limit);
    const short = analysis.bareNames.get(qname) ?? qname;
    const existing = limits.get(short);
    if (existing === void 0 || limit > existing) {
      limits.set(short, limit);
    }
  }
  return limits;
}
function rangeKey(node) {
  return `${node.startIndex}:${node.endIndex}`;
}
function extractStructure(ctx, root) {
  const structure = emptyStructure();
  const captured = /* @__PURE__ */ new Set();
  visit(ctx, root, structure, captured);
  for (const child of root.children) {
    if (!child) continue;
    if (!captured.has(rangeKey(child))) {
      const text = child.text.trim();
      if (text !== "") structure.topLevelCode.push(text);
    }
  }
  return structure;
}
function visit(ctx, node, structure, captured) {
  const nt = node.type;
  const key = rangeKey(node);
  if (ctx.lang.packageNode === nt) {
    structure.imports.unshift(node.text);
    captured.add(key);
    return;
  }
  if (ctx.lang.importNodes.includes(nt)) {
    structure.imports.push(node.text);
    captured.add(key);
    return;
  }
  if (nt === "export_statement") {
    const text = node.text;
    let hasFuncOrClass = false;
    for (const child of node.children) {
      if (!child) continue;
      if (ctx.lang.functionNodes.includes(child.type)) {
        hasFuncOrClass = true;
        const compressed = compressFunctionAst(ctx, child, { clipToOwnSpan: true });
        const exportPrefix = ctx.code.slice(node.startIndex, child.startIndex);
        const exportSuffix = ctx.code.slice(child.endIndex, node.endIndex);
        structure.functionSignatures.push(`${exportPrefix}${compressed}${exportSuffix}`);
        break;
      }
      if (ctx.lang.classNodes.includes(child.type)) {
        hasFuncOrClass = true;
        const compressed = compressClassAst(ctx, child, true);
        const exportPrefix = ctx.code.slice(node.startIndex, child.startIndex);
        const exportSuffix = ctx.code.slice(child.endIndex, node.endIndex);
        structure.classDefinitions.push(`${exportPrefix}${compressed}${exportSuffix}`);
        break;
      }
      if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
        const found = findExportedFunctionValue(child);
        if (found) {
          hasFuncOrClass = true;
          const compressed = compressFunctionAst(ctx, found.valueNode, {
            nameOverride: found.name,
            clipToOwnSpan: true
          });
          const exportPrefix = ctx.code.slice(node.startIndex, found.valueNode.startIndex);
          const exportSuffix = ctx.code.slice(found.valueNode.endIndex, node.endIndex);
          structure.functionSignatures.push(`${exportPrefix}${compressed}${exportSuffix}`);
          break;
        }
      }
    }
    if (!hasFuncOrClass) structure.imports.push(text);
    captured.add(key);
    return;
  }
  if (ctx.lang.decoratorNode !== null && nt === ctx.lang.decoratorNode) {
    const decoratorText = [];
    let definitionCompressed;
    let hasClassChild = false;
    for (const child of node.children) {
      if (!child) continue;
      const ck = child.type;
      if (ck === "decorator") {
        decoratorText.push(child.text);
      } else if (ctx.lang.functionNodes.includes(ck)) {
        definitionCompressed = compressFunctionAst(ctx, child);
      } else if (ctx.lang.classNodes.includes(ck)) {
        definitionCompressed = compressClassAst(ctx, child);
      }
      if (ctx.lang.classNodes.includes(ck)) hasClassChild = true;
    }
    if (definitionCompressed !== void 0 && decoratorText.length > 0) {
      const fullDef = `${decoratorText.join("\n")}
${definitionCompressed}`;
      if (hasClassChild) structure.classDefinitions.push(fullDef);
      else structure.functionSignatures.push(fullDef);
    } else if (definitionCompressed !== void 0) {
      structure.functionSignatures.push(definitionCompressed);
    }
    captured.add(key);
    return;
  }
  if (ctx.lang.functionNodes.includes(nt)) {
    structure.functionSignatures.push(compressFunctionAst(ctx, node));
    captured.add(key);
    return;
  }
  if (ctx.lang.classNodes.includes(nt)) {
    structure.classDefinitions.push(compressClassAst(ctx, node));
    captured.add(key);
    return;
  }
  if (ctx.lang.typeNodes.includes(nt)) {
    structure.typeDefinitions.push(node.text);
    captured.add(key);
    return;
  }
  for (const child of node.children) {
    if (child) visit(ctx, child, structure, captured);
  }
}
function firstLineDocstring(firstDsLine, bodyLines, dsStartRel) {
  const dsIndent = leadingWs(firstDsLine);
  const stripped = firstDsLine.trim();
  const OPENERS = ['r"""', "r'''", '"""', "'''"];
  let quote = '"""';
  let contentStart = 0;
  for (const opener of OPENERS) {
    if (stripped.startsWith(opener)) {
      quote = opener.slice(-3);
      contentStart = opener.length;
      break;
    }
  }
  let firstContent = stripped.slice(contentStart).trim();
  for (const q of ['"""', "'''"]) {
    if (firstContent.endsWith(q)) firstContent = firstContent.slice(0, -q.length).trim();
  }
  if (firstContent !== "") {
    const prefixPart = stripped.slice(0, contentStart);
    return `${dsIndent}${prefixPart}${firstContent}${quote}`;
  }
  if (dsStartRel + 1 < bodyLines.length) {
    let secondLine = bodyLines[dsStartRel + 1].trim();
    for (const q of ['"""', "'''"]) {
      if (secondLine.endsWith(q)) secondLine = secondLine.slice(0, -q.length).trim();
    }
    if (secondLine !== "") return `${dsIndent}${quote}${secondLine}${quote}`;
    return firstDsLine;
  }
  return firstDsLine;
}
function clipRowsToNodeSpan(rawLines, node, clip) {
  if (!clip) return [...rawLines];
  const nodeLines = [...rawLines];
  if (nodeLines.length === 0) return nodeLines;
  const lastIdx = nodeLines.length - 1;
  if (lastIdx === 0) {
    const line = rawLines[0];
    const prefix = line.slice(0, node.startPosition.column);
    const suffix = line.slice(node.endPosition.column);
    const start2 = prefix.trim() !== "" ? node.startPosition.column : 0;
    const end = suffix.trim() !== "" ? node.endPosition.column : line.length;
    nodeLines[0] = line.slice(start2, end);
  } else {
    const firstLine = rawLines[0];
    const firstLinePrefix = firstLine.slice(0, node.startPosition.column);
    if (firstLinePrefix.trim() !== "") {
      nodeLines[0] = firstLine.slice(node.startPosition.column);
    }
    const lastLine = rawLines[lastIdx];
    const lastLineSuffix = lastLine.slice(node.endPosition.column);
    if (lastLineSuffix.trim() !== "") {
      nodeLines[lastIdx] = lastLine.slice(0, node.endPosition.column);
    }
  }
  return nodeLines;
}
function compressFunctionAst(ctx, node, opts) {
  const startRow = node.startPosition.row;
  const endRow = node.endPosition.row;
  const rawLines = ctx.codeLines.slice(startRow, endRow + 1);
  const nodeLines = clipRowsToNodeSpan(rawLines, node, opts?.clipToOwnSpan ?? false);
  const nodeText = nodeLines.join("\n");
  const funcName = opts?.nameOverride ?? getDefinitionName(node);
  const bodyLimit = getBodyLimit(funcName, ctx.bodyLimits, ctx.config.maxBodyLines);
  if (nodeLines.length <= bodyLimit + 2) return nodeText;
  let bodyNode;
  for (const child of node.children) {
    if (child && ctx.lang.bodyNodeTypes.includes(child.type)) {
      bodyNode = child;
      break;
    }
  }
  if (!bodyNode) return nodeText;
  const nodeStartLine = startRow;
  const bodyStartLine = bodyNode.startPosition.row;
  const bodyEndLine = bodyNode.endPosition.row;
  const sigEnd = bodyStartLine - nodeStartLine;
  const bodyEndRel = bodyEndLine - nodeStartLine + 1;
  let signatureLines;
  let bodyLines;
  let afterLines;
  let braceInSignature;
  if (sigEnd === 0 && !ctx.lang.usesColonAfterSignature) {
    signatureLines = [nodeLines[0].replace(/\s+$/, "")];
    bodyLines = nodeLines.slice(1, bodyEndRel);
    afterLines = nodeLines.slice(bodyEndRel);
    braceInSignature = true;
  } else {
    signatureLines = nodeLines.slice(0, sigEnd);
    bodyLines = nodeLines.slice(sigEnd, bodyEndRel);
    afterLines = nodeLines.slice(bodyEndRel);
    braceInSignature = false;
  }
  let openingBraceLine;
  let closingBraceLine;
  if (!ctx.lang.usesColonAfterSignature) {
    if (!braceInSignature && bodyLines.length > 0 && bodyLines[0].trimStart().startsWith("{")) {
      openingBraceLine = bodyLines[0];
      bodyLines = bodyLines.slice(1);
    }
    if (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trimEnd().endsWith("}")) {
      closingBraceLine = bodyLines[bodyLines.length - 1];
      bodyLines = bodyLines.slice(0, -1);
    }
  }
  let docstringText = "";
  let dsSkipLines = 0;
  if (ctx.language === "python" && bodyNode.childCount > 0) {
    const firstChild = bodyNode.child(0);
    let dsNode;
    if (firstChild) {
      const isDirectString = firstChild.type === "string";
      const isWrappedString = firstChild.type === "expression_statement" && firstChild.childCount > 0 && firstChild.child(0)?.type === "string";
      if (isDirectString || isWrappedString) {
        dsNode = firstChild;
      }
    }
    if (dsNode) {
      const dsLinesCount = dsNode.endPosition.row - dsNode.startPosition.row + 1;
      const dsStartRel = dsNode.startPosition.row - bodyNode.startPosition.row;
      if (ctx.config.docstringMode === "full") {
        const endi = Math.min(dsStartRel + dsLinesCount, bodyLines.length);
        if (dsStartRel < bodyLines.length) docstringText = bodyLines.slice(dsStartRel, endi).join("\n");
      } else if (ctx.config.docstringMode === "first_line") {
        if (dsLinesCount === 1) {
          if (dsStartRel < bodyLines.length) docstringText = bodyLines[dsStartRel];
        } else if (dsStartRel < bodyLines.length) {
          docstringText = firstLineDocstring(bodyLines[dsStartRel], bodyLines, dsStartRel);
        }
      }
      dsSkipLines = dsStartRel + dsLinesCount;
    }
  }
  const indent = bodyLines.length > 0 ? detectIndent(bodyLines) : "    ";
  let dsEndRow = -1;
  if (dsSkipLines > 0 && bodyNode.childCount > 0) {
    dsEndRow = bodyNode.startPosition.row + dsSkipLines - 1;
  }
  const bodyStmts = [];
  for (const child of bodyNode.children) {
    if (!child) continue;
    if (child.startPosition.row <= dsEndRow) continue;
    if (SKIP_BODY_STMT_TYPES.has(child.type)) continue;
    if (!child.isNamed) continue;
    bodyStmts.push([child.startPosition.row, child.endPosition.row]);
  }
  let totalBodyLinesCount = 0;
  for (const [s, e] of bodyStmts) totalBodyLinesCount += e - s + 1;
  const keptLines = [];
  let keptLineCount = 0;
  for (const [sRow, eRow] of bodyStmts) {
    const stmtLines = ctx.codeLines.slice(sRow, eRow + 1);
    const stmtLineCount = stmtLines.length;
    if (keptLineCount + stmtLineCount > bodyLimit && keptLines.length > 0) break;
    keptLines.push(...stmtLines);
    keptLineCount += stmtLineCount;
  }
  const omittedLines = totalBodyLinesCount - keptLineCount;
  const resultParts = [];
  if (signatureLines.length > 0) {
    resultParts.push(...signatureLines);
  } else {
    resultParts.push(ctx.code.slice(node.startIndex, bodyNode.startIndex).replace(/\s+$/, ""));
  }
  if (openingBraceLine !== void 0) resultParts.push(openingBraceLine);
  if (docstringText !== "" && ctx.config.docstringMode !== "none" && ctx.config.docstringMode !== "remove") {
    resultParts.push(docstringText);
  }
  if (keptLines.length > 0) resultParts.push(...keptLines);
  if (omittedLines > 0) {
    resultParts.push(makeOmittedComment(funcName, omittedLines, indent, ctx.lang.commentPrefix, ctx.analysis));
    if (ctx.lang.usesColonAfterSignature) resultParts.push(`${indent}pass`);
  }
  if (closingBraceLine !== void 0) {
    resultParts.push(closingBraceLine);
  } else if (afterLines.length > 0) {
    resultParts.push(...afterLines);
  }
  return resultParts.join("\n");
}
function compressClassAst(ctx, node, clipToOwnSpan = false) {
  const startRow = node.startPosition.row;
  const endRow = node.endPosition.row;
  const rawLines = ctx.codeLines.slice(startRow, endRow + 1);
  const nodeLines = clipRowsToNodeSpan(rawLines, node, clipToOwnSpan);
  const nodeText = nodeLines.join("\n");
  let bodyNode;
  for (const child of node.children) {
    if (child && ctx.lang.bodyNodeTypes.includes(child.type)) {
      bodyNode = child;
      break;
    }
  }
  if (!bodyNode) return nodeText;
  const nodeStartLine = startRow;
  const bodyStartLine = bodyNode.startPosition.row;
  const sigEnd = bodyStartLine - nodeStartLine;
  const headerLines = sigEnd > 0 ? nodeLines.slice(0, sigEnd) : [nodeLines[0]];
  const bodyParts = [];
  for (const child of bodyNode.children) {
    if (!child) continue;
    if (!child.isNamed) continue;
    const ck = child.type;
    const childText = ctx.codeLines.slice(child.startPosition.row, child.endPosition.row + 1).join("\n");
    if (ctx.lang.functionNodes.includes(ck)) {
      bodyParts.push(compressFunctionAst(ctx, child));
    } else if (ctx.lang.decoratorNode !== null && ck === ctx.lang.decoratorNode) {
      const decoratorLines = [];
      let methodCompressed;
      for (const decoChild of child.children) {
        if (!decoChild) continue;
        if (decoChild.type === "decorator") {
          decoratorLines.push(decoChild.text);
        } else if (ctx.lang.functionNodes.includes(decoChild.type)) {
          methodCompressed = compressFunctionAst(ctx, decoChild);
        }
      }
      if (methodCompressed !== void 0 && decoratorLines.length > 0) {
        bodyParts.push(`${decoratorLines.join("\n")}
${methodCompressed}`);
      } else if (methodCompressed !== void 0) {
        bodyParts.push(methodCompressed);
      } else {
        bodyParts.push(childText);
      }
    } else if (ctx.lang.classNodes.includes(ck)) {
      bodyParts.push(compressClassAst(ctx, child));
    } else if (childText.trim() !== "") {
      bodyParts.push(childText);
    }
  }
  const resultParts = [...headerLines, ...bodyParts];
  const bodyEndLine = bodyNode.endPosition.row;
  const bodyEndRel = bodyEndLine - nodeStartLine + 1;
  const afterLines = nodeLines.slice(bodyEndRel);
  if (afterLines.length > 0) {
    resultParts.push(...afterLines);
  } else if (!ctx.lang.usesColonAfterSignature) {
    const lastBodyLine = nodeLines[nodeLines.length - 1] ?? "";
    if (lastBodyLine.trim() === "}") resultParts.push(lastBodyLine);
  }
  return resultParts.join("\n");
}
function assembleCompressed(structure) {
  const parts2 = [];
  const pushSection = (section) => {
    if (section.length > 0) {
      parts2.push(...section);
      parts2.push("");
    }
  };
  pushSection(structure.imports);
  pushSection(structure.typeDefinitions);
  pushSection(structure.classDefinitions);
  pushSection(structure.functionSignatures);
  pushSection(structure.topLevelCode);
  if (structure.other.length > 0) parts2.push(...structure.other);
  while (parts2.length > 0 && parts2[parts2.length - 1].trim() === "") parts2.pop();
  return parts2.join("\n");
}
function extractGenericStructure(code) {
  return { ...emptyStructure(), other: code.split("\n") };
}
function passthroughResult(code, originalTokens, language, confidence) {
  return {
    compressed: code,
    original: code,
    originalTokens,
    compressedTokens: originalTokens,
    compressionRatio: 1,
    language,
    languageConfidence: confidence,
    preservedImports: 0,
    preservedSignatures: 0,
    compressedBodies: 0,
    syntaxValid: true,
    cacheKey: null,
    symbolScores: {},
    wasModified: false
  };
}
async function verifySyntax(code, language) {
  const tree = await parseCode(code, language);
  if (!tree) return false;
  return !hasSyntaxIssues(tree.rootNode);
}
async function compressWithAst(code, language, context, config) {
  const tree = await parseCode(code, language);
  if (!tree) return null;
  const root = tree.rootNode;
  const analysis = analyzeSymbolImportance(root, language, context, config);
  const bodyLimits = allocateBodyBudget(analysis, code, config);
  const langConfig = getLangConfig(language);
  let structure;
  let symbolScores;
  if (langConfig) {
    const ctx = {
      code,
      codeLines: code.split("\n"),
      language,
      lang: langConfig,
      bodyLimits,
      analysis,
      config
    };
    structure = extractStructure(ctx, root);
    const dedup = /* @__PURE__ */ new Map();
    for (const [qname, score] of analysis.scores) {
      const short = analysis.bareNames.get(qname) ?? qname;
      const existing = dedup.get(short);
      if (existing === void 0 || score > existing) dedup.set(short, score);
    }
    symbolScores = Object.fromEntries(dedup);
  } else {
    structure = extractGenericStructure(code);
    symbolScores = {};
  }
  const compressed = assembleCompressed(structure);
  return { compressed, structure, symbolScores };
}
async function compressCode(code, opts = {}) {
  const config = { ...DEFAULT_CODE_COMPRESSOR_CONFIG, ...opts.config };
  const context = opts.queryContext ?? "";
  if (code.trim() === "") return passthroughResult(code, 0, "unknown", 0);
  const originalTokens = estimateTokens(code);
  if (originalTokens < config.minTokensForCompression) {
    return passthroughResult(code, originalTokens, "unknown", 0);
  }
  let detectedLang;
  let confidence;
  if (opts.language) {
    detectedLang = normalizeLanguage(opts.language) ?? "unknown";
    confidence = 1;
  } else if (config.languageHint) {
    detectedLang = normalizeLanguage(config.languageHint) ?? "unknown";
    confidence = 1;
  } else {
    [detectedLang, confidence] = await detectLanguage(code);
  }
  if (detectedLang === "unknown") {
    return { ...passthroughResult(code, originalTokens, "unknown", 0) };
  }
  const astResult = await compressWithAst(code, detectedLang, context, config);
  if (!astResult) {
    return passthroughResult(code, originalTokens, detectedLang, confidence);
  }
  const { compressed, structure, symbolScores } = astResult;
  const compressedTokens = estimateTokens(compressed);
  const syntaxValid = await verifySyntax(compressed, detectedLang);
  if (!syntaxValid) {
    return passthroughResult(code, originalTokens, detectedLang, confidence);
  }
  const ratio = compressedTokens / Math.max(1, originalTokens);
  if (ratio < 0.05) {
    return passthroughResult(code, originalTokens, detectedLang, confidence);
  }
  return {
    compressed,
    original: code,
    originalTokens,
    compressedTokens,
    compressionRatio: ratio,
    language: detectedLang,
    languageConfidence: confidence,
    preservedImports: structure.imports.length,
    preservedSignatures: structure.functionSignatures.length,
    compressedBodies: structure.functionBodies.length,
    syntaxValid,
    cacheKey: null,
    symbolScores,
    wasModified: compressed !== code
  };
}
var import_web_tree_sitter, nodeRequire, DEFAULT_CODE_COMPRESSOR_CONFIG, ALL_LANGUAGES, initPromise2, languageCache, parserCache, LANG_CONFIGS, CONTEXT_DELIMS, CJK_CHARS, VALID_LANGUAGES, PREFILTER, SKIP_BODY_STMT_TYPES;
var init_code_compressor = __esm({
  "src/native/code-compressor.ts"() {
    "use strict";
    import_web_tree_sitter = __toESM(require_tree_sitter(), 1);
    nodeRequire = createRequire(import.meta.url);
    DEFAULT_CODE_COMPRESSOR_CONFIG = {
      preserveImports: true,
      preserveSignatures: true,
      preserveTypeAnnotations: true,
      preserveDecorators: true,
      docstringMode: "first_line",
      targetCompressionRate: 0.2,
      maxBodyLines: 5,
      compressComments: true,
      minTokensForCompression: 100,
      languageHint: null,
      fallbackToKompress: true,
      semanticAnalysis: true,
      enableCcr: true,
      ccrTtl: 300
    };
    ALL_LANGUAGES = [
      "python",
      "javascript",
      "typescript",
      "go",
      "rust",
      "java",
      "c",
      "cpp"
    ];
    initPromise2 = null;
    languageCache = /* @__PURE__ */ new Map();
    parserCache = /* @__PURE__ */ new Map();
    LANG_CONFIGS = {
      python: {
        importNodes: ["import_statement", "import_from_statement"],
        functionNodes: ["function_definition"],
        classNodes: ["class_definition"],
        typeNodes: ["type_alias_statement"],
        bodyNodeTypes: ["block"],
        decoratorNode: "decorated_definition",
        commentPrefix: "#",
        usesColonAfterSignature: true,
        packageNode: null
      },
      javascript: {
        importNodes: ["import_statement", "import_declaration"],
        functionNodes: ["function_declaration", "method_definition"],
        classNodes: ["class_declaration"],
        typeNodes: [],
        // `class_body` (a class's own body container) is a distinct node type
        // from `statement_block` (a function/method's) in this grammar, unlike
        // Python/Go/Rust/Java/C/C++ where the Rust reference's shared
        // `body_node_types` config already covers both shapes with one node
        // type. Without it, `compressClassAst`'s body-node lookup never
        // matches for JS/TS, so no class (bare or exported) ever gets its
        // methods truncated -- listed here (not as a separate "classBodyNode"
        // field) because `compressFunctionAst`'s own body lookup only ever
        // walks a function/method node's direct children, which never include
        // a `class_body`, so sharing the list is safe.
        bodyNodeTypes: ["statement_block", "class_body"],
        decoratorNode: null,
        commentPrefix: "//",
        usesColonAfterSignature: false,
        packageNode: null
      },
      typescript: {
        importNodes: ["import_statement", "import_declaration"],
        functionNodes: ["function_declaration", "method_definition"],
        classNodes: ["class_declaration"],
        typeNodes: ["interface_declaration", "type_alias_declaration"],
        bodyNodeTypes: ["statement_block", "class_body"],
        decoratorNode: null,
        commentPrefix: "//",
        usesColonAfterSignature: false,
        packageNode: null
      },
      go: {
        importNodes: ["import_declaration"],
        functionNodes: ["function_declaration", "method_declaration"],
        classNodes: [],
        typeNodes: ["type_declaration"],
        bodyNodeTypes: ["block"],
        decoratorNode: null,
        commentPrefix: "//",
        usesColonAfterSignature: false,
        packageNode: "package_clause"
      },
      rust: {
        importNodes: ["use_declaration"],
        functionNodes: ["function_item"],
        classNodes: ["impl_item"],
        typeNodes: ["struct_item", "enum_item", "type_item", "trait_item"],
        bodyNodeTypes: ["block"],
        decoratorNode: null,
        commentPrefix: "//",
        usesColonAfterSignature: false,
        packageNode: null
      },
      java: {
        importNodes: ["import_declaration"],
        functionNodes: ["method_declaration", "constructor_declaration"],
        classNodes: ["class_declaration", "interface_declaration"],
        typeNodes: ["enum_declaration"],
        bodyNodeTypes: ["block"],
        decoratorNode: null,
        commentPrefix: "//",
        usesColonAfterSignature: false,
        packageNode: "package_declaration"
      },
      c: {
        importNodes: ["preproc_include"],
        functionNodes: ["function_definition"],
        classNodes: [],
        typeNodes: ["struct_specifier", "enum_specifier", "type_definition"],
        bodyNodeTypes: ["compound_statement"],
        decoratorNode: null,
        commentPrefix: "//",
        usesColonAfterSignature: false,
        packageNode: null
      },
      cpp: {
        importNodes: ["preproc_include"],
        functionNodes: ["function_definition"],
        classNodes: ["class_specifier"],
        typeNodes: ["struct_specifier", "enum_specifier", "type_definition"],
        bodyNodeTypes: ["compound_statement"],
        decoratorNode: null,
        commentPrefix: "//",
        usesColonAfterSignature: false,
        packageNode: null
      }
    };
    CONTEXT_DELIMS = /[\s,;:.()[\]{}"'，、；：。．！？（）【】「」『』《》〈〉·…—　]+/gm;
    CJK_CHARS = /[　-鿿가-힯＀-￯]/;
    VALID_LANGUAGES = /* @__PURE__ */ new Set([
      "python",
      "javascript",
      "typescript",
      "go",
      "rust",
      "java",
      "c",
      "cpp",
      "unknown"
    ]);
    PREFILTER = [
      {
        lang: "python",
        patterns: [
          /^\s*(def|class|import|from|async def)\s+\w+/gm,
          /^\s*@\w+/gm,
          /^\s*"""/gm,
          /^\s*if __name__\s*==/gm
        ]
      },
      {
        lang: "javascript",
        patterns: [
          /^\s*(function|const|let|var|class|export)\s+\w+/gm,
          /^\s*async\s+(function|=>)/gm,
          /^\s*module\.exports/gm,
          /^\s*(import|export)\s+.*\s+from\s+['"]/gm
        ]
      },
      {
        lang: "typescript",
        patterns: [/^\s*(interface|type|enum|namespace)\s+\w+/gm, /:\s*(string|number|boolean|any|void|Promise)\b/gm]
      },
      {
        lang: "go",
        patterns: [/^\s*(func|type|package|import)\s+/gm, /^\s*func\s+\([^)]+\)\s+\w+/gm, /\bstruct\s*\{/gm]
      },
      {
        lang: "rust",
        patterns: [/^\s*(fn|struct|enum|impl|mod|use|pub)\s+/gm, /^\s*#\[/gm]
      },
      {
        lang: "java",
        patterns: [/^\s*(public|private|protected)\s+(class|interface|enum)/gm, /^\s*package\s+[\w.]+;/gm]
      },
      {
        lang: "c",
        patterns: [
          /^\s*#include\s*[<"]/gm,
          /^\s*(int|void|char|float|double)\s+\w+\s*\(/gm,
          /^\s*typedef\s+/gm
        ]
      },
      {
        lang: "cpp",
        patterns: [/^\s*#include\s*[<"]/gm, /\bnamespace\s+\w+/gm, /::\w+/gm]
      }
    ];
    SKIP_BODY_STMT_TYPES = /* @__PURE__ */ new Set(["{", "}", ";", ",", "comment", "line_comment", "block_comment"]);
  }
});

// src/optimizer/hooks/pretooluse.ts
import { readFileSync as readFileSync7 } from "node:fs";
import { pathToFileURL } from "node:url";

// src/core/hook-io.ts
var DEFAULT_OUTPUT_CAP_CHARS = 1e4;
async function readHookInput(stdin = process.stdin) {
  try {
    const chunks = [];
    for await (const chunk of stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (raw.length === 0) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function findLongestStringPath(value, currentPath = [], best = {
  path: null,
  len: -1
}) {
  if (typeof value === "string") {
    if (value.length > best.len) {
      best.len = value.length;
      best.path = currentPath.slice();
    }
  } else if (Array.isArray(value)) {
    value.forEach(
      (item, index) => findLongestStringPath(item, [...currentPath, index], best)
    );
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      findLongestStringPath(
        value[key],
        [...currentPath, key],
        best
      );
    }
  }
  return best.path;
}
function getAtPath(obj, pathParts) {
  return pathParts.reduce((acc, key) => {
    if (acc === null || typeof acc !== "object") return void 0;
    return acc[key];
  }, obj);
}
function setAtPath(obj, pathParts, value) {
  if (pathParts.length === 0) return;
  const parentPath = pathParts.slice(0, -1);
  const lastKey = pathParts[pathParts.length - 1];
  const parent = parentPath.length === 0 ? obj : getAtPath(obj, parentPath);
  if (parent && typeof parent === "object") {
    parent[lastKey] = value;
  }
}
function toCappedJson(value, capChars = DEFAULT_OUTPUT_CAP_CHARS) {
  const full = JSON.stringify(value);
  if (full.length <= capChars) return full;
  const clone = JSON.parse(full);
  const targetPath = findLongestStringPath(clone);
  if (!targetPath) {
    return full;
  }
  const originalStr = String(getAtPath(clone, targetPath));
  let str = originalStr;
  let serialized = full;
  for (let attempt = 0; attempt < 15; attempt++) {
    const omitted = originalStr.length - str.length;
    const marker = `...[truncated, ${omitted} chars omitted]`;
    setAtPath(clone, targetPath, omitted > 0 ? str + marker : str);
    serialized = JSON.stringify(clone);
    if (serialized.length <= capChars) break;
    const over = serialized.length - capChars;
    const trimBy = Math.ceil(over * 1.1) + marker.length + 10;
    const nextLen = Math.max(0, str.length - trimBy);
    if (nextLen === str.length) {
      str = "";
      break;
    }
    str = str.slice(0, nextLen);
    if (str.length === 0) break;
  }
  if (serialized.length > capChars) {
    const marker = `...[truncated, ${originalStr.length} chars omitted]`;
    setAtPath(clone, targetPath, marker);
    serialized = JSON.stringify(clone);
  }
  return serialized;
}
function writeHookOutput(output, capChars = DEFAULT_OUTPUT_CAP_CHARS, stdout = process.stdout) {
  stdout.write(toCappedJson(output, capChars));
}
function allow(hookEventName, reason) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      ...reason ? { permissionDecisionReason: reason } : {}
    }
  };
}
function deny(hookEventName, reason) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}
function allowWithContext(hookEventName, context) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
      additionalContext: context
    }
  };
}
function denyWithSubstitute(hookEventName, reason, context) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      additionalContext: context
    }
  };
}

// src/optimizer/hooks/lib/policy.ts
import {
  statSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

// src/optimizer/hooks/lib/paths.ts
import { isAbsolute } from "node:path";
var MSYS = /^\/([A-Za-z])\/(.*)$/;
function normaliseOnce(input, cwd) {
  if (typeof input !== "string" || !input) return input;
  let path3 = input.trim();
  if (!path3) return input;
  if (path3.length >= 2 && (path3.startsWith('"') && path3.endsWith('"') || path3.startsWith("'") && path3.endsWith("'"))) {
    path3 = path3.slice(1, -1);
  }
  path3 = path3.replace(/\\/g, "/");
  if (!isAbsolute(path3) && !/^[A-Za-z]:/.test(path3)) {
    if (cwd) {
      const base = canonicalPath(cwd);
      path3 = `${base.endsWith("/") ? base.slice(0, -1) : base}/${path3}`;
    }
  }
  const unc = path3.startsWith("//");
  path3 = (unc ? path3.slice(2) : path3).replace(/\/{2,}/g, "/");
  const segments = [];
  for (const segment of path3.split("/")) {
    if (segment === "." || segment === "") {
      if (segments.length === 0 && segment === "") segments.push("");
      continue;
    }
    if (segment === ".." && segments.length && segments[segments.length - 1] !== "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  path3 = (unc ? "//" : "") + segments.join("/");
  if (path3 === "" && segments.length === 1 && segments[0] === "") path3 = "/";
  path3 = path3.trim();
  const msys = MSYS.exec(path3);
  if (msys) path3 = `${msys[1].toUpperCase()}:/${msys[2]}`;
  path3 = path3.replace(/^([A-Za-z]):/, (_, drive) => `${drive.toUpperCase()}:`);
  if (path3.length > 3 && path3.endsWith("/")) path3 = path3.slice(0, -1);
  return path3;
}
function isFsSafePath(input) {
  if (typeof input !== "string") return false;
  for (const character of input) {
    if (character.codePointAt(0) === 1114111) return false;
  }
  return true;
}
function canonicalPath(input, cwd) {
  let path3 = normaliseOnce(input, cwd);
  for (let i2 = 0; i2 < 8; i2++) {
    const next = normaliseOnce(path3, cwd);
    if (next === path3) return path3;
    path3 = next;
  }
  return path3;
}
function resolvableCandidates(input, cwd) {
  const seen = /* @__PURE__ */ new Set();
  const out2 = [];
  const add = (p) => {
    if (p && !seen.has(p)) {
      seen.add(p);
      out2.push(p);
    }
  };
  add(canonicalPath(input, cwd));
  if (typeof input === "string") add(input);
  if (cwd && typeof input === "string" && !isAbsolute(input) && !/^[A-Za-z]:/.test(input)) {
    add(`${cwd}/${input}`);
  }
  return out2;
}

// src/optimizer/hooks/lib/policy.ts
var MODE_ENFORCE = "enforce";
var MODE_ADVISE = "advise";
var MODE_OFF = "off";
function mode(env = process.env) {
  const raw = (env.TOKEN_OPTIMIZER_MODE || "").trim().toLowerCase();
  if (raw === MODE_OFF) return MODE_OFF;
  if (raw === MODE_ADVISE) return MODE_ADVISE;
  return MODE_ENFORCE;
}
function intEnv(env, name2, fallback) {
  const parsed = Number(env[name2]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function largeFileBytes(env = process.env) {
  return intEnv(env, "TOKEN_OPTIMIZER_LARGE_READ_BYTES", 25600);
}
function refusalFloorBytes(env = process.env) {
  return intEnv(env, "TOKEN_OPTIMIZER_REFUSAL_FLOOR_BYTES", 1024);
}
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".mp3",
  ".mp4",
  ".wav",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot"
]);
function isBinaryPath(path3) {
  const dot = path3.lastIndexOf(".");
  return dot !== -1 && BINARY_EXTENSIONS.has(path3.slice(dot).toLowerCase());
}
var MACHINE_OWNED = /(?:^|[/\\])(?:\.git|\.hg|\.svn|node_modules|\.venv|__pycache__|\.next|\.turbo|dist|obj|bin)(?:[/\\]|$)/i;
function normalizeSegments(p) {
  const drive = /^[a-z]:/i.test(p) ? p.slice(0, 2) : "";
  const rest = drive ? p.slice(2) : p;
  const rooted = rest.startsWith("/");
  const out2 = [];
  for (const seg of rest.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out2.length && out2[out2.length - 1] !== "..") out2.pop();
      else if (!rooted && !drive) out2.push("..");
      continue;
    }
    out2.push(seg);
  }
  return drive + (rooted || drive ? "/" : "") + out2.join("/");
}
function isMachineOwned(path3) {
  return MACHINE_OWNED.test(
    normalizeSegments(String(path3 || "").split("\\").join("/"))
  );
}
function fileSize(path3) {
  if (!isFsSafePath(path3)) return -1;
  try {
    const st = statSync(path3);
    return st.isFile() ? st.size : -1;
  } catch {
    return -1;
  }
}
var stateRoot = (env = process.env) => env.TOKEN_OPTIMIZER_STATE_DIR || join(tmpdir(), "token-optimizer-hooks");
function statePath(sessionId, agent, env = process.env) {
  const safe = String(sessionId || "default").replace(/[^A-Za-z0-9_-]/g, "");
  const scope = agent ? `-${createHash("sha256").update(String(agent)).digest("hex").slice(0, 12)}` : "";
  return join(stateRoot(env), `${safe || "default"}${scope}.json`);
}
function emptyState() {
  return {
    seen: {},
    denied: {},
    injected: [],
    actCounts: {},
    forecast: null,
    edits: 0,
    editedFiles: [],
    harvestedEdits: 0,
    recordingNudged: false,
    optimizerTools: [],
    optimizerToolsObservedAt: 0
  };
}
function loadState(sessionId, agent, env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(sessionId, agent, env), "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyState();
    return {
      seen: parsed.seen && typeof parsed.seen === "object" ? parsed.seen : {},
      denied: parsed.denied && typeof parsed.denied === "object" ? parsed.denied : {},
      injected: Array.isArray(parsed.injected) ? parsed.injected : [],
      actCounts: parsed.actCounts && typeof parsed.actCounts === "object" && !Array.isArray(parsed.actCounts) ? parsed.actCounts : {},
      forecast: parsed.forecast && typeof parsed.forecast === "object" && !Array.isArray(parsed.forecast) && Number.isFinite(parsed.forecast.checkedAt) ? parsed.forecast : null,
      edits: Number.isFinite(parsed.edits) ? parsed.edits : 0,
      editedFiles: Array.isArray(parsed.editedFiles) ? parsed.editedFiles : [],
      harvestedEdits: Number.isFinite(parsed.harvestedEdits) ? parsed.harvestedEdits : 0,
      recordingNudged: parsed.recordingNudged === true,
      optimizerTools: Array.isArray(parsed.optimizerTools) ? parsed.optimizerTools.filter((name2) => typeof name2 === "string") : [],
      optimizerToolsObservedAt: Number.isFinite(parsed.optimizerToolsObservedAt) ? parsed.optimizerToolsObservedAt : 0
    };
  } catch {
    return emptyState();
  }
}
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
  }
}
function takeLock(sessionId, agent, env, { attempts = 20, staleMs = 5e3, waitMs = 15 } = {}) {
  const path3 = `${statePath(sessionId, agent, env)}.lock`;
  for (let i2 = 0; i2 < attempts; i2++) {
    try {
      const fd = openSync(path3, "wx", 384);
      closeSync(fd);
      return path3;
    } catch {
      try {
        if (Date.now() - statSync(path3).mtimeMs > staleMs) {
          unlinkSync(path3);
          continue;
        }
      } catch {
        continue;
      }
      if (i2 < attempts - 1) sleepSync(waitMs);
    }
  }
  return null;
}
function saveState(sessionId, state, agent, env = process.env) {
  let lock = null;
  try {
    mkdirSync(stateRoot(env), { recursive: true, mode: 448 });
    lock = takeLock(sessionId, agent, env);
    if (!lock) return false;
    const current = loadState(sessionId, agent, env);
    const merged = {
      seen: { ...current.seen, ...state.seen },
      denied: { ...current.denied, ...state.denied },
      injected: [.../* @__PURE__ */ new Set([...current.injected || [], ...state.injected || []])],
      actCounts: (() => {
        const out2 = { ...current.actCounts || {} };
        for (const [k, v] of Object.entries(state.actCounts || {})) {
          out2[k] = Math.max(Number(out2[k]) || 0, Number(v) || 0);
        }
        return out2;
      })(),
      edits: Math.max(Number(current.edits) || 0, Number(state.edits) || 0),
      editedFiles: [.../* @__PURE__ */ new Set([...state.editedFiles || [], ...current.editedFiles || []])].slice(0, 20),
      harvestedEdits: Math.max(Number(current.harvestedEdits) || 0, Number(state.harvestedEdits) || 0),
      recordingNudged: Boolean(current.recordingNudged || state.recordingNudged),
      ...(() => {
        const mineAt = Number(state.optimizerToolsObservedAt) || 0;
        const theirsAt = Number(current.optimizerToolsObservedAt) || 0;
        const mineWins = mineAt >= theirsAt && mineAt > 0;
        return {
          optimizerTools: mineWins ? [...state.optimizerTools || []] : [...current.optimizerTools || []],
          optimizerToolsObservedAt: mineWins ? mineAt : theirsAt
        };
      })(),
      forecast: (() => {
        const mine = state.forecast || null;
        const theirs = current.forecast || null;
        const stamp = (f) => Number.isFinite(f?.checkedAt) ? f.checkedAt : null;
        if (stamp(mine) === null) return theirs;
        if (stamp(theirs) === null) return mine;
        return stamp(mine) >= stamp(theirs) ? mine : theirs;
      })()
    };
    const target = statePath(sessionId, agent, env);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(merged), { mode: 384 });
    renameSync(temporary, target);
    return true;
  } catch {
    return false;
  } finally {
    if (lock) {
      try {
        unlinkSync(lock);
      } catch {
      }
    }
  }
}
function alreadyDenied(state, key) {
  const seen = Boolean(state.denied[key]);
  state.denied[key] = true;
  return seen;
}
function withEscape(reason) {
  const text = String(reason || "");
  if (text.includes("TOKEN_OPTIMIZER_MODE")) return text;
  return `${text} (Not what you wanted? TOKEN_OPTIMIZER_MODE=off disables enforcement.)`;
}
function enforceVerdict(reason, deniedBefore, currentMode = mode(), substitute) {
  if (currentMode === MODE_OFF) return { kind: "allow" };
  if (currentMode === MODE_ADVISE || deniedBefore) {
    return { kind: "allowWithContext", context: reason };
  }
  if (substitute) return { kind: "denyWithSubstitute", reason: withEscape(reason), substitute };
  return { kind: "deny", reason: withEscape(reason) };
}

// src/optimizer/hooks/lib/decide.ts
import { statSync as statSync3 } from "node:fs";
import { join as join4 } from "node:path";

// src/optimizer/hooks/lib/remedy.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
function rulesPath(dir) {
  return join2(dir, "rules.json");
}
function activeRules(dir) {
  try {
    const parsed = JSON.parse(readFileSync2(rulesPath(dir), "utf8"));
    return Array.isArray(parsed?.rules) ? parsed.rules.filter((r) => !r.revertedAt) : [];
  } catch {
    return [];
  }
}

// src/optimizer/hooks/lib/wiki.ts
import {
  appendFileSync,
  readFileSync as readFileSync3,
  existsSync,
  mkdirSync as mkdirSync2,
  chmodSync,
  openSync as openSync2,
  closeSync as closeSync2,
  unlinkSync as unlinkSync2,
  statSync as statSync2,
  writeFileSync as writeFileSync2,
  renameSync as renameSync2
} from "node:fs";
import { join as join3, dirname } from "node:path";
import { createHash as createHash2 } from "node:crypto";

// src/optimizer/paths.ts
import path2 from "node:path";

// src/core/paths.ts
import { homedir } from "node:os";
import path from "node:path";
function getOptiflowHome() {
  const override = process.env.OPTIFLOW_HOME;
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return path.join(homedir(), ".optiflow");
}

// src/optimizer/paths.ts
function getOptimizerHome() {
  return path2.join(getOptiflowHome(), "optimizer");
}
function getOptimizerUnrootedDir() {
  return path2.join(getOptimizerHome(), "unrooted");
}

// src/optimizer/hooks/lib/wiki.ts
var GRAPH_VERSION = 1;
var NODE_KINDS = ["file", "symbol", "task", "finding"];
var EDGE_KINDS = [
  "derived_from",
  "contains",
  "imports",
  "calls",
  "supersedes",
  "contradicts",
  "answers",
  "related"
];
function wikiDir(cwd) {
  return process.env.TOKEN_OPTIMIZER_WIKI_DIR || join3(cwd || process.cwd(), ".token-optimizer", "wiki");
}
function unrootedRoot() {
  return process.env.TOKEN_OPTIMIZER_UNROOTED_DIR || getOptimizerUnrootedDir();
}
function projectRootFor(filePath, fallback) {
  if (!isFsSafePath(filePath)) return fallback ? canonicalPath(fallback) : null;
  const MARKERS = [".git", ".hg", ".svn"];
  let dir = dirname(canonicalPath(filePath));
  for (let depth = 0; depth < 40 && dir; depth += 1) {
    for (const marker of MARKERS) {
      if (existsSync(join3(dir, marker))) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return unrootedRoot();
}
var logPath = (dir) => join3(dir, "graph.jsonl");
var snapshotsPath = (dir) => join3(dir, "snapshots.jsonl");
var markerPath = (dir) => join3(dir, "graph.compact.json");
function nodeId(kind, key) {
  return `${kind}:${createHash2("sha256").update(canonicalKey(kind, key)).digest("hex").slice(0, 16)}`;
}
function canonicalKey(kind, key) {
  const raw = String(key);
  if (kind === "file") return canonicalPath(raw);
  if (kind === "symbol") {
    const hash = raw.indexOf("#");
    return hash === -1 ? canonicalPath(raw) : `${canonicalPath(raw.slice(0, hash))}#${raw.slice(hash + 1)}`;
  }
  return raw;
}
function contentHash(path3, text) {
  if (text === void 0 && !isFsSafePath(path3)) return null;
  try {
    return createHash2("sha256").update(text === void 0 ? readFileSync3(path3) : text).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}
function withLock(dir, write) {
  const lockPath = join3(dir, ".graph.lock");
  let held = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      closeSync2(openSync2(lockPath, "wx", 384));
      held = true;
      break;
    } catch {
      try {
        if (Date.now() - statSync2(lockPath).mtimeMs > 5e3) unlinkSync2(lockPath);
      } catch {
      }
    }
  }
  try {
    write();
  } finally {
    if (held) {
      try {
        unlinkSync2(lockPath);
      } catch {
      }
    }
  }
}
function ignoreSelf(dir) {
  const marker = join3(dir, ".gitignore");
  try {
    if (existsSync(marker)) return;
    appendFileSync(
      marker,
      "# Written by the optiflow optimizer. Findings are unreviewed agent output;\n# keeping them out of git history is the default. Delete this file to\n# opt in to committing them.\n*\n"
    );
  } catch {
  }
}
var compactFloorBytes = () => Number(process.env.TOKEN_OPTIMIZER_GRAPH_COMPACT_BYTES) || 8e6;
var SNAPSHOT_DEPENDENT = /* @__PURE__ */ new Set(["finding", "map"]);
var snapshotBudgetBytes = () => Number(process.env.TOKEN_OPTIMIZER_GRAPH_SNAPSHOT_BYTES) || 8e6;
function compactionBaseline(dir) {
  try {
    const raw = JSON.parse(readFileSync3(markerPath(dir), "utf8"));
    const n = Number(raw.sizeAfter);
    return Number.isFinite(n) && n > 0 ? n : compactFloorBytes();
  } catch {
    return compactFloorBytes();
  }
}
function readSnapshots(dir) {
  const out2 = [];
  try {
    for (const line of readFileSync3(snapshotsPath(dir), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if ((rec.v ?? 0) === GRAPH_VERSION && rec.id) out2.push(rec);
      } catch {
      }
    }
  } catch {
  }
  return out2;
}
function compactIfWasteful(dir) {
  const path3 = logPath(dir);
  let size = 0;
  try {
    size = statSync2(path3).size;
  } catch {
    return;
  }
  try {
    size += statSync2(snapshotsPath(dir)).size;
  } catch {
  }
  if (size < compactFloorBytes() || size < compactionBaseline(dir) * 2) return;
  try {
    const nodes = /* @__PURE__ */ new Map();
    const edges = /* @__PURE__ */ new Map();
    const snaps = /* @__PURE__ */ new Map();
    for (const rec of readSnapshots(dir)) {
      if (typeof rec.snapshot === "string" && rec.snapshot) {
        snaps.set(rec.id, { at: rec.at || 0, snapshot: rec.snapshot });
      }
    }
    for (const line of readFileSync3(path3, "utf8").split("\n")) {
      if (!line) continue;
      let record2;
      try {
        record2 = JSON.parse(line);
      } catch {
        continue;
      }
      if ((record2.v ?? 0) !== GRAPH_VERSION) {
        edges.set("raw:" + edges.size, line);
        continue;
      }
      if (record2.t === "n") {
        if (typeof record2.snapshot === "string" && record2.snapshot) {
          const { snapshot, ...rest } = record2;
          nodes.set(record2.id, JSON.stringify(rest));
          snaps.set(record2.id, { at: record2.at || 0, snapshot });
        } else {
          nodes.set(record2.id, line);
        }
      } else if (record2.t === "s") {
        if (typeof record2.snapshot === "string" && record2.snapshot) {
          snaps.set(record2.id, { at: record2.at || 0, snapshot: record2.snapshot });
        }
      } else if (record2.t === "e") {
        edges.set(`${record2.from}|${record2.edge}|${record2.to}`, line);
      } else edges.set("raw:" + edges.size, line);
    }
    const needed = /* @__PURE__ */ new Set();
    for (const line of edges.values()) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.t !== "e" || e.edge !== "derived_from") continue;
      const from = nodes.get(e.from);
      if (!from) continue;
      let f;
      try {
        f = JSON.parse(from);
      } catch {
        continue;
      }
      if (f.kind === "finding" && SNAPSHOT_DEPENDENT.has(f.type || "finding")) {
        needed.add(e.to);
      }
    }
    const carriers = [...snaps.entries()].map(([id, v]) => ({ id, at: v.at, size: v.snapshot.length })).sort((a, b) => b.at - a.at);
    let spent = 0;
    const budget = snapshotBudgetBytes();
    const keep = /* @__PURE__ */ new Map();
    for (const c of carriers) {
      if (!needed.has(c.id) && spent + c.size > budget) continue;
      spent += c.size;
      keep.set(c.id, snaps.get(c.id));
    }
    const out2 = [...edges.values(), ...nodes.values()].join("\n") + "\n";
    const tmp = path3 + ".compact";
    writeFileSync2(tmp, out2, { mode: 384 });
    renameSync2(tmp, path3);
    const snapOut = [...keep.entries()].map(([id, v]) => JSON.stringify({ t: "s", v: GRAPH_VERSION, id, snapshot: v.snapshot, at: v.at })).join("\n") + (keep.size ? "\n" : "");
    const snapTmp = snapshotsPath(dir) + ".compact";
    writeFileSync2(snapTmp, snapOut, { mode: 384 });
    renameSync2(snapTmp, snapshotsPath(dir));
    writeFileSync2(
      markerPath(dir),
      JSON.stringify({ sizeAfter: out2.length + snapOut.length, at: Date.now() }),
      { mode: 384 }
    );
  } catch {
  }
}
function appendAll(dir, records) {
  if (!records.length) return true;
  try {
    mkdirSync2(dir, { recursive: true, mode: 448 });
    try {
      chmodSync(dir, 448);
    } catch {
    }
    ignoreSelf(dir);
    const payload = records.map((record2) => JSON.stringify(record2) + "\n").join("");
    withLock(dir, () => {
      appendFileSync(logPath(dir), payload);
      compactIfWasteful(dir);
    });
    return true;
  } catch {
    return false;
  }
}
function append(dir, record2) {
  return appendAll(dir, [record2]);
}
function putNode(dir, { kind, key, ...rest }) {
  if (!NODE_KINDS.includes(kind)) throw new Error(`unknown node kind: ${kind}`);
  const id = nodeId(kind, key);
  const { snapshot, ...fields } = rest;
  const at = Date.now();
  const records = [{ ...fields, t: "n", v: GRAPH_VERSION, id, kind, key: canonicalKey(kind, key), at }];
  appendAll(dir, records);
  if (typeof snapshot === "string" && snapshot) {
    appendSnapshotRecord(dir, { t: "s", v: GRAPH_VERSION, id, snapshot, at });
  }
  return id;
}
function putEdge(dir, from, edge, to) {
  if (!EDGE_KINDS.includes(edge)) throw new Error(`unknown edge kind: ${edge}`);
  append(dir, { t: "e", v: GRAPH_VERSION, from, edge, to, at: Date.now() });
}
function appendSnapshotRecord(dir, record2) {
  try {
    appendFileSync(snapshotsPath(dir), JSON.stringify(record2) + "\n");
  } catch {
  }
}
function load(dir, { snapshots = false } = {}) {
  const nodes = /* @__PURE__ */ new Map();
  const edges = [];
  const path3 = logPath(dir);
  if (!existsSync(path3)) return { nodes, edges };
  const pending = snapshots ? /* @__PURE__ */ new Map() : null;
  for (const line of readFileSync3(path3, "utf8").split("\n")) {
    if (!line) continue;
    if (line.startsWith('{"t":"s"')) {
      if (!snapshots) continue;
      try {
        const rec = JSON.parse(line);
        if ((rec.v ?? 0) === GRAPH_VERSION) pending.set(rec.id, rec.snapshot);
      } catch {
      }
      continue;
    }
    let record2;
    try {
      record2 = JSON.parse(line);
    } catch {
      continue;
    }
    if ((record2.v ?? 0) !== GRAPH_VERSION) continue;
    if (record2.t === "n") nodes.set(record2.id, record2);
    else if (record2.t === "e") edges.push(record2);
  }
  if (pending) {
    for (const rec of readSnapshots(dir)) pending.set(rec.id, rec.snapshot);
    for (const [id, snapshot] of pending) {
      const node = nodes.get(id);
      if (node) nodes.set(id, { ...node, snapshot });
    }
  }
  return { nodes, edges };
}
function harvest(dir, { filePath, sessionId, action, hash: precomputed }) {
  if (!filePath) return null;
  const hash = precomputed ?? contentHash(filePath);
  if (hash === null) return null;
  const fileNode = putNode(dir, { kind: "file", key: filePath, hash, lastAction: action });
  if (sessionId) {
    const taskNode = putNode(dir, { kind: "task", key: sessionId });
    putEdge(dir, taskNode, "derived_from", fileNode);
  }
  return fileNode;
}

// src/optimizer/hooks/lib/decide.ts
var KB = (bytes) => Math.round(bytes / 1024);
function isDirectory(path3) {
  if (!isFsSafePath(path3)) return false;
  try {
    return statSync3(path3).isDirectory();
  } catch {
    return false;
  }
}
var DUMP_COMMANDS = /\b(?:cat|bat|head|tail|more|less|type|Get-Content|gc)\b/;
var DUMP_HEAD = /^(?:cat|bat|head|tail|more|less|type|Get-Content|gc)$/i;
var RECURSIVE_SEARCH = /\b(?:grep|egrep|fgrep|rg|ag|ack|findstr|Select-String|sls)\b/;
var SEARCH_TOOL = /^(?:grep|egrep|fgrep|rg|ag|ack|findstr|Select-String|sls)$/i;
var RECURSES_BY_DEFAULT = /^(?:rg|ag|ack)$/i;
var COMMAND_PREFIX = /^(?:sudo|time|env|command|nice|ionice|nohup|xargs)$/;
function stripHeredocs(command) {
  const lines = String(command).split("\n");
  const out2 = [];
  let delimiter = null;
  for (const line of lines) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      continue;
    }
    out2.push(line);
    const opener = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (opener) delimiter = opener[2];
  }
  return out2.join("\n");
}
function segmentsOf(command) {
  return String(command).split(/\|\||&&|[|;&\n]/).map((s) => s.trim()).filter(Boolean);
}
function redirectsStdoutToFile(segment) {
  return /(?:^|[^0-9&2])>>?\s*(?!&)\S+/.test(String(segment));
}
function isContentDump(command) {
  if (typeof command !== "string") return false;
  const runnable = stripHeredocs(command);
  if (RECURSIVE_SEARCH.test(runnable)) return true;
  if (!DUMP_COMMANDS.test(runnable)) return false;
  return segmentsOf(runnable).some(
    (segment) => DUMP_COMMANDS.test(segment) && !redirectsStdoutToFile(segment)
  );
}
function shellSegments(command) {
  const out2 = [];
  let current = "";
  let quote = null;
  for (let i2 = 0; i2 < command.length; i2++) {
    const c = command[i2];
    if (quote) {
      if (c === quote && command[i2 - 1] !== "\\") quote = null;
      current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&") {
      if ((c === "|" || c === "&") && command[i2 + 1] === c) i2++;
      out2.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  out2.push(current);
  return out2;
}
function isRecursiveSearch(command) {
  if (typeof command !== "string") return false;
  for (const segment of shellSegments(stripHeredocs(command))) {
    const tokens = segment.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g) || [];
    let i2 = 0;
    while (i2 < tokens.length && (/^\w+=/.test(tokens[i2]) || COMMAND_PREFIX.test(tokens[i2]))) i2++;
    if (i2 >= tokens.length) continue;
    let head = tokens[i2].replace(/^.*[/\\]/, "");
    if (head === "git" && tokens[i2 + 1] === "grep") {
      head = "grep";
      i2++;
    }
    if (!SEARCH_TOOL.test(head)) continue;
    if (RECURSES_BY_DEFAULT.test(head)) return true;
    const flags2 = tokens.slice(i2 + 1);
    if (flags2.some((t) => t === "--recursive" || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(t))) return true;
  }
  return false;
}
function fileOperands(command) {
  const operands = [];
  const segment = command.split("|")[0];
  const tokens = segment.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g) || [];
  for (let i2 = 1; i2 < tokens.length; i2++) {
    const token = tokens[i2].replace(/^['"]|['"]$/g, "");
    if (token.startsWith("-")) {
      if (/^-[a-zA-Z]$/.test(token) && /^\d+$/.test(tokens[i2 + 1] || "")) i2++;
      continue;
    }
    if (token.includes("*") || token.includes("$") || token.startsWith("<")) continue;
    operands.push(token);
  }
  return operands;
}
function candidatePaths(operand, cwd) {
  return resolvableCandidates(operand, cwd);
}
function commandProjectRoot(payload, fallback) {
  const raw = payload?.tool_input?.command;
  const base = payload?.cwd ?? fallback;
  if (typeof raw === "string") {
    const command = stripHeredocs(raw);
    const cd = /(?:^|\n|;|&&)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(command);
    if (cd) {
      const target = canonicalPath(cd[1].replace(/^['"]|['"]$/g, ""), base);
      if (isDirectory(target)) return projectRootFor(join4(target, "__command__"), base);
    }
  }
  return projectRootFor(join4(base || process.cwd(), "__command__"), base);
}
function touchedFiles(payload) {
  const input = payload?.tool_input || {};
  const out2 = /* @__PURE__ */ new Map();
  const command = typeof input.command === "string" ? stripHeredocs(input.command) : "";
  const cd = /(?:^|\n|;|&&)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(command);
  const cdTarget = cd ? canonicalPath(cd[1].replace(/^['"]|['"]$/g, ""), payload?.cwd) : null;
  const cwd = cdTarget && isDirectory(cdTarget) ? cdTarget : payload?.cwd;
  const add = (candidate) => {
    if (!candidate || typeof candidate !== "string") return;
    for (const spelling of resolvableCandidates(candidate, cwd)) {
      if (!isFsSafePath(spelling)) continue;
      const size = fileSize(spelling);
      if (size >= 0) {
        if (!isMachineOwned(spelling)) out2.set(canonicalPath(spelling, cwd), size);
        return;
      }
    }
  };
  add(input.file_path);
  add(input.path);
  add(input.notebook_path);
  for (const match of command.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm)) {
    add(match[1].trim().replace(/^['"]|['"]$/g, ""));
  }
  for (const match of command.matchAll(/^\*\*\* Move to:\s*(.+)$/gm)) {
    add(match[1].trim().replace(/^['"]|['"]$/g, ""));
  }
  for (const segment of command.split("|")) {
    for (const operand of fileOperands(segment)) add(operand);
  }
  return [...out2].map(([path3, size]) => ({ path: path3, size }));
}
function largeDumpedOperand(command, cwd) {
  const threshold = largeFileBytes();
  for (const segment of shellSegments(stripHeredocs(command))) {
    const tokens = segment.match(/(?:"[^"]*"|'[^']*'|[^\s]+)/g) || [];
    let i2 = 0;
    while (i2 < tokens.length && (/^\w+=/.test(tokens[i2]) || COMMAND_PREFIX.test(tokens[i2]))) i2++;
    if (i2 >= tokens.length) continue;
    if (!DUMP_HEAD.test(tokens[i2].replace(/^.*[/\\]/, ""))) continue;
    for (const operand of fileOperands(tokens.slice(i2).join(" "))) {
      for (const path3 of candidatePaths(operand, cwd)) {
        const size = fileSize(path3);
        if (size >= threshold && !isBinaryPath(path3) && !isMachineOwned(path3)) {
          return { path: operand, size };
        }
      }
    }
  }
  return null;
}
function largeOperand(command, cwd) {
  const threshold = largeFileBytes();
  for (const operand of fileOperands(command)) {
    for (const path3 of candidatePaths(operand, cwd)) {
      const size = fileSize(path3);
      if (size >= threshold && !isBinaryPath(path3) && !isMachineOwned(path3)) {
        return { path: operand, size };
      }
    }
  }
  return null;
}
var TOOL_ALIASES = new Map(
  Object.entries({
    read: "Read",
    read_file: "Read",
    view_file: "Read",
    readfile: "Read",
    view: "Read",
    str_replace_editor_view: "Read",
    open_file: "Read",
    grep: "Grep",
    search_file_content: "Grep",
    grep_search: "Grep",
    ripgrep_search: "Grep",
    codebase_search: "Grep",
    search: "Grep",
    glob: "Glob",
    find_files: "Glob",
    file_search: "Glob",
    list_dir: "Glob",
    glob_file_search: "Glob",
    edit: "Edit",
    edit_file: "Edit",
    replace: "Edit",
    apply_patch: "Edit",
    str_replace: "Edit",
    multiedit: "Edit",
    search_replace: "Edit",
    write: "Write",
    write_file: "Write",
    create_file: "Write",
    bash: "Bash",
    powershell: "Bash",
    pwsh: "Bash",
    shell: "Bash",
    run_command: "Bash",
    execute_command: "Bash",
    run_shell_command: "Bash",
    run_terminal_cmd: "Bash",
    terminal: "Bash"
  })
);
function normalizeTool(name2) {
  if (!name2) return null;
  if (["Read", "Grep", "Glob", "Edit", "MultiEdit", "Write", "Bash"].includes(String(name2))) {
    return String(name2);
  }
  return TOOL_ALIASES.get(String(name2).toLowerCase()) || null;
}
function normalizePayload(raw) {
  const rawInput = raw.tool_input ?? raw.toolInput ?? raw.tool_args ?? raw.toolArgs ?? raw.arguments ?? raw.args ?? raw.parameters ?? {};
  let input = rawInput;
  if (typeof rawInput === "string") {
    try {
      input = JSON.parse(rawInput);
    } catch {
      input = {};
    }
  }
  const filePath = input.file_path ?? input.path ?? input.absolute_path ?? input.filePath ?? input.target_file;
  const command = input.command ?? input.cmd ?? input.script;
  const cwd = raw.cwd ?? raw.workspace_root ?? process.cwd();
  return {
    session_id: String(raw.session_id ?? raw.sessionId ?? raw.conversation_id ?? "default"),
    transcript_path: raw.transcript_path ?? raw.transcriptPath ?? null,
    cwd,
    tool_name: normalizeTool(raw.tool_name ?? raw.toolName ?? raw.tool),
    tool_input: {
      ...input,
      ...filePath !== void 0 ? { file_path: canonicalPath(filePath, cwd) } : {},
      ...filePath !== void 0 ? { raw_file_path: filePath } : {},
      ...command !== void 0 ? { command: String(command) } : {},
      ...input.start_line !== void 0 ? { offset: input.start_line } : {},
      ...input.end_line !== void 0 ? { limit: input.end_line } : {}
    }
  };
}
function matchingRule(cwd, path3) {
  const canonical2 = canonicalPath(path3);
  for (const rule of activeRules(wikiDir(cwd))) {
    if (rule.type !== "skip" && rule.type !== "skeleton-only") continue;
    if (rule.anchor && rule.anchor === canonical2) return rule;
  }
  return null;
}
function replacementAvailable(availableTools, name2) {
  if (availableTools === void 0) return true;
  return availableTools instanceof Set ? availableTools.has(name2) : availableTools.includes(name2);
}
function decide(payload, state, availableTools) {
  const tool = payload.tool_name;
  const input = payload.tool_input || {};
  const threshold = largeFileBytes();
  if (tool === "Read") {
    const path3 = input.file_path;
    const shown = input.raw_file_path ?? path3;
    if (!path3 || isBinaryPath(path3) || isMachineOwned(path3)) return null;
    if (input.offset != null || input.limit != null) return null;
    const size = fileSize(path3);
    if (size < 0) return null;
    if (size < refusalFloorBytes()) return null;
    const rule = matchingRule(payload.cwd, path3);
    if (rule && replacementAvailable(availableTools, "smart_read")) {
      return {
        key: `read:${path3}`,
        reason: `${shown} is covered by a fix applied on ${new Date(rule.appliedAt).toISOString().slice(0, 10)}: ${rule.why}. Call smart_read with path="${shown}" for its structure, or revert the rule with id "${rule.id}" if it is wrong.`
      };
    }
    if (state.seen[path3] && replacementAvailable(availableTools, "smart_read")) {
      return {
        key: `read:${path3}`,
        reason: `You already read ${shown} earlier in this session. Call the token-optimizer MCP tool smart_read with path="${shown}" instead -- it returns only a diff of what changed since that read, typically a few tokens rather than the whole file.`
      };
    }
    if (size >= threshold && replacementAvailable(availableTools, "smart_read")) {
      return {
        key: `read:${path3}`,
        reason: `${shown} is ${KB(size)} KB, large enough to cost a meaningful share of the context window. Call the token-optimizer MCP tool smart_read with path="${shown}" instead -- it caches the content and returns diffs on later reads.`
      };
    }
    return null;
  }
  if (tool === "Grep") {
    if (input.output_mode && input.output_mode !== "content") return null;
    if (!replacementAvailable(availableTools, "smart_grep")) return null;
    const pattern = input.pattern || "";
    return {
      key: `grep:${pattern}:${input.path || ""}`,
      reason: `Call the token-optimizer MCP tool smart_grep instead of the built-in Grep (pattern="${pattern}"). It returns deduplicated, context-trimmed matches rather than every raw hit.`
    };
  }
  if (tool === "Glob") {
    if (!replacementAvailable(availableTools, "smart_glob")) return null;
    const pattern = input.pattern || "";
    return {
      key: `glob:${pattern}`,
      reason: `Call the token-optimizer MCP tool smart_glob instead of the built-in Glob (pattern="${pattern}"). It returns filtered, paginated paths rather than an unbounded match list.`
    };
  }
  if (tool === "Edit" || tool === "MultiEdit") {
    if (!replacementAvailable(availableTools, "smart_edit")) return null;
    const path3 = input.file_path;
    if (!path3) return null;
    const size = fileSize(path3);
    if (size < threshold) return null;
    return {
      key: `edit:${path3}`,
      reason: `${path3} is ${KB(size)} KB. Call the token-optimizer MCP tool smart_edit with path="${path3}" instead -- it applies the change and returns a compact unified diff rather than echoing the file.`
    };
  }
  if (tool === "Write") {
    if (!replacementAvailable(availableTools, "smart_write")) return null;
    const path3 = input.file_path;
    const content = input.content || "";
    if (!path3 || content.length < threshold) return null;
    return {
      key: `write:${path3}`,
      reason: `You are writing ${KB(content.length)} KB to ${path3}. Call the token-optimizer MCP tool smart_write instead -- it stores the content through the cache so later reads of this file diff against it.`
    };
  }
  if (tool === "Bash") {
    const command = input.command || "";
    {
      const hit = largeDumpedOperand(command, payload.cwd);
      if (hit && replacementAvailable(availableTools, "smart_read")) {
        return {
          key: `bash:${hit.path}`,
          reason: `This command prints ${hit.path} (${KB(hit.size)} KB) into the context. Call the token-optimizer MCP tool smart_read with path="${hit.path}" instead -- same content, cached and diffed.`
        };
      }
    }
    if (isRecursiveSearch(command) && replacementAvailable(availableTools, "smart_grep")) {
      if (!largeOperand(command, payload.cwd)) {
        return {
          key: `bash:search:${command.slice(0, 80)}`,
          reason: `Recursive shell searches return unbounded output. Call the token-optimizer MCP tool smart_grep instead -- it caps and deduplicates results before they reach the context window.`
        };
      }
    }
  }
  return null;
}
function remember(payload, state) {
  const path3 = payload.tool_input?.file_path;
  if (path3 && payload.tool_name === "Read") {
    state.seen[path3] = true;
  }
}
function readCostBytes(payload) {
  if (payload.tool_name !== "Read") return 0;
  const path3 = payload.tool_input?.file_path;
  if (!path3 || isBinaryPath(path3)) return 0;
  const size = fileSize(path3);
  return size > 0 ? size : 0;
}

// src/optimizer/hooks/lib/metrics.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync3, chmodSync as chmodSync2, statSync as statSync4, existsSync as existsSync2, readFileSync as readFileSync4 } from "node:fs";
import { join as join5 } from "node:path";
import { randomBytes } from "node:crypto";
var metricsPath = (dir) => join5(dir, "metrics.jsonl");
function fingerprint(path3) {
  try {
    const st = statSync4(path3);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return null;
  }
}
var idCounter = 0;
function nextId() {
  idCounter += 1;
  return `${idCounter.toString(36)}-${randomBytes(4).toString("hex")}`;
}
function record(dir, event) {
  try {
    mkdirSync3(dir, { recursive: true, mode: 448 });
    try {
      chmodSync2(dir, 448);
    } catch {
    }
    const id = event.id || nextId();
    const complete = {
      schemaVersion: event.schemaVersion || 2,
      id,
      ...event,
      at: event.at ?? Date.now()
    };
    appendFileSync2(metricsPath(dir), `${JSON.stringify(complete)}
`);
    return complete;
  } catch {
    return null;
  }
}
function recordRead(dir, { anchor, sessionId, bytes, fp = null }) {
  if (!anchor || !bytes) return;
  record(dir, { kind: "read", anchor, sessionId, tokens: Math.ceil(bytes / 4), fp });
}
var MAX_BYTES = Number(process.env.TOKEN_OPTIMIZER_METRICS_BYTES) || 2e6;

// src/optimizer/hooks/lib/surface.ts
function maybeSurface(_dir, options = {}) {
  return { text: null, state: options.state?.forecast ?? null };
}

// src/optimizer/hooks/lib/recording.ts
import { readFileSync as readFileSync5, existsSync as existsSync3 } from "node:fs";
import { join as join6 } from "node:path";
var NUDGE_AFTER_EDITS = Number(process.env.TOKEN_OPTIMIZER_NUDGE_AFTER) || 8;
var SUBSTANTIVE = /* @__PURE__ */ new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
function isSubstantive(toolName) {
  return SUBSTANTIVE.has(String(toolName || ""));
}
function findingCount(dir) {
  const path3 = join6(dir, "graph.jsonl");
  if (!existsSync3(path3)) return 0;
  let text;
  try {
    text = readFileSync5(path3, "utf8");
  } catch {
    return 0;
  }
  const seen = /* @__PURE__ */ new Set();
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const node = JSON.parse(line);
      if (node?.kind === "finding" && node.id) seen.add(node.id);
    } catch {
    }
  }
  return seen.size;
}
function recordingNudge(dir, { state = {}, edits = 0, files = [] } = {}) {
  if (state.recordingNudged) return null;
  if (edits < NUDGE_AFTER_EDITS) return null;
  if (findingCount(dir) > 0) return null;
  const named = [...new Set(files)].slice(0, 3);
  const subject = named.length ? named.map((f) => f.split(/[\\/]/).pop()).join(", ") : "this project";
  return `You have made ${edits} edits this session (${subject}) and this project's graph holds no findings at all -- so the next session starts from nothing and re-derives whatever you have worked out. Call wiki_write for anything durable you concluded: a dead end and why, a decision and what you rejected, a command that finally worked. Anchor it to the file it is about. Not worth recording: what the code plainly says.`;
}

// src/optimizer/hooks/lib/inject.ts
function forTouch(_dir, _graph, _rawPath, _options = {}) {
  return null;
}
function forCommand(_dir, _graph, _command, _options = {}) {
  return null;
}
function forSharedCommand(_projectDir, _command, _options = {}) {
  return null;
}
function noteActClasses(_state, _command) {
  return /* @__PURE__ */ new Set();
}
function forRepeatedAct(_projectDir, _command, _crossedClasses, _options = {}) {
  return null;
}
function refusalPayload(_graph, _rawPath, _options = {}) {
  return null;
}
function substitutionFor(_dir, _graph, _rawPath, _source, _options = {}) {
  return null;
}

// src/optimizer/hooks/lib/staleness.ts
function indexFile(_dir, _path, _source) {
}

// src/optimizer/hooks/lib/transcript.ts
function isArchived(path3) {
  return /[\\/]\.token-optimizer[\\/]wiki[\\/]transcripts[\\/]/.test(String(path3));
}

// src/optimizer/hooks/lib/experiment.ts
var EXPERIMENT_ARMS = ["baseline", "optimizer", "retrieval", "full"];
var FEATURES = {
  baseline: { routing: false, retrieval: false, capture: false, harvest: false },
  optimizer: { routing: true, retrieval: false, capture: false, harvest: false },
  retrieval: { routing: true, retrieval: true, capture: true, harvest: false },
  full: { routing: true, retrieval: true, capture: true, harvest: true }
};
function experimentArm(env = process.env) {
  const requested = String(env.TOKEN_OPTIMIZER_EXPERIMENT_ARM || "").trim().toLowerCase();
  return EXPERIMENT_ARMS.includes(requested) ? requested : "full";
}
function featuresForArm(arm = experimentArm()) {
  return FEATURES[arm] || FEATURES.full;
}
var first = (...values) => values.find((value) => value !== void 0 && value !== null && value !== "");
function episodeMeta({
  client,
  raw = {},
  payload = {},
  env = process.env
} = {}) {
  const sessionId = String(
    first(
      payload.session_id,
      raw.session_id,
      raw.sessionId,
      raw.conversation_id,
      raw.conversationId,
      raw.taskId,
      raw.task_id,
      raw.trajectory_id,
      "default"
    )
  );
  const episodeId = String(first(env.TOKEN_OPTIMIZER_EPISODE_ID, raw.episode_id, raw.episodeId, sessionId));
  const toolCallId = first(
    raw.tool_use_id,
    raw.toolUseId,
    raw.tool_call_id,
    raw.toolCallId,
    raw.call_id,
    raw.callId,
    raw.postToolUse?.toolUseId,
    raw.preToolUse?.toolUseId
  );
  const model = first(payload.model, raw.model?.slug, raw.model, raw.model_name, env.TOKEN_OPTIMIZER_MODEL);
  const clientVersion = first(raw.client_version, raw.clientVersion, raw.version, env.TOKEN_OPTIMIZER_CLIENT_VERSION);
  const modelVersion = first(raw.model_version, raw.modelVersion, env.TOKEN_OPTIMIZER_MODEL_VERSION);
  return {
    schemaVersion: 2,
    episodeId,
    sessionId,
    turnId: first(raw.turn_id, raw.turnId, raw.message_id, raw.messageId) ?? null,
    toolCallId: toolCallId == null ? null : String(toolCallId),
    taskId: first(env.TOKEN_OPTIMIZER_TASK_ID, raw.task_id, raw.taskId) ?? null,
    pairId: first(env.TOKEN_OPTIMIZER_PAIR_ID, raw.pair_id, raw.pairId) ?? null,
    arm: experimentArm(env),
    client: String(client || first(raw.client, raw.client_name, "unknown")),
    clientVersion: clientVersion == null ? null : String(clientVersion),
    model: model == null ? null : String(model),
    modelVersion: modelVersion == null ? null : String(modelVersion)
  };
}

// src/optimizer/hooks/lib/capabilities.ts
var HOOK_MCP_TOOLS = [
  "smart_read",
  "smart_write",
  "smart_edit",
  "smart_glob",
  "smart_grep",
  "optimize_session",
  "get_optimization_report",
  "wiki_write"
];
var HOOK_MCP_TOOL_SET = new Set(HOOK_MCP_TOOLS);
function optimizerToolsForHook(_raw = {}, _state = {}, env = process.env) {
  const override = env.TOKEN_OPTIMIZER_MCP_CAPABILITIES;
  if (override !== void 0) {
    const names = /* @__PURE__ */ new Set();
    let parsed = null;
    if (/^\s*\[/.test(override)) {
      try {
        parsed = JSON.parse(override);
      } catch {
        parsed = null;
      }
    }
    const items = Array.isArray(parsed) ? parsed : override.split(/[\s,]+/);
    for (const item of items) {
      const name2 = String(item).trim();
      if (HOOK_MCP_TOOL_SET.has(name2)) names.add(name2);
    }
    return { proven: true, names };
  }
  return { proven: true, names: new Set(HOOK_MCP_TOOLS) };
}
function rememberOptimizerTools(state, _evidence, _observedAt = Date.now()) {
  return state;
}

// src/optimizer/hooks/lib/ucr-guard.ts
import { appendFileSync as appendFileSync3, existsSync as existsSync4, readFileSync as readFileSync6, statSync as statSync5 } from "node:fs";
import { createHash as createHash3 } from "node:crypto";
import { join as join7, resolve } from "node:path";
var MAX_INDEX_BYTES = 1e6;
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value) {
  return createHash3("sha256").update(canonical(value)).digest("hex");
}
function indexRoot() {
  return process.env.TOKEN_OPTIMIZER_UCR_DIR ? resolve(process.env.TOKEN_OPTIMIZER_UCR_DIR) : resolve(process.cwd(), ".token-optimizer", "ucr");
}
function loadActiveUcrGuards() {
  const path3 = join7(indexRoot(), "active-guards.json");
  if (!existsSync4(path3) || statSync5(path3).size > MAX_INDEX_BYTES) return [];
  try {
    const parsed = JSON.parse(readFileSync6(path3, "utf8"));
    const { indexHash, ...body2 } = parsed;
    if (parsed.schemaVersion !== "ucr.active-guards/1") return [];
    if (digest(body2) !== indexHash) return [];
    return Array.isArray(parsed.guards) ? parsed.guards.filter((guard) => guard?.id && guard.state === "active" && guard.scope) : [];
  } catch {
    return [];
  }
}
function valueAtPath(value, field) {
  return String(field || "").split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}
function conditionMatches(condition, action) {
  const actual = valueAtPath(action, condition.field);
  const expected = condition.value;
  if (condition.operator === "equals") return actual === expected;
  if (condition.operator === "contains") return String(actual || "").includes(String(expected));
  if (condition.operator === "startsWith") return String(actual || "").startsWith(String(expected));
  if (condition.operator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (condition.operator === "matches") {
    try {
      return new RegExp(String(expected), condition.flags || "").test(String(actual || ""));
    } catch {
      return false;
    }
  }
  return false;
}
function scoped(guard, context) {
  for (const field of ["taskId", "projectId", "workspaceId"]) {
    if (guard.scope?.[field] && guard.scope[field] !== context[field]) return false;
  }
  return true;
}
function audit(record2) {
  try {
    appendFileSync3(join7(indexRoot(), "guard-audit.jsonl"), `${JSON.stringify(record2)}
`, {
      encoding: "utf8",
      mode: 384
    });
  } catch {
  }
}
function evaluateUcrGuards(payload, paths = []) {
  const context = {
    taskId: process.env.TOKEN_OPTIMIZER_TASK_ID || null,
    projectId: process.env.TOKEN_OPTIMIZER_PROJECT_ID || null,
    workspaceId: process.env.TOKEN_OPTIMIZER_WORKSPACE_ID || null
  };
  const candidates = [
    payload?.tool_input || {},
    ...paths.map((path3) => ({ ...payload?.tool_input || {}, path: path3 }))
  ];
  for (const guard of loadActiveUcrGuards()) {
    if (!scoped(guard, context)) continue;
    const matched = candidates.some(
      (action) => guard.triggers.every((condition) => conditionMatches(condition, action))
    );
    if (!matched) continue;
    const record2 = {
      at: Date.now(),
      guardId: guard.id,
      taskId: context.taskId,
      toolName: payload?.tool_name || null,
      actionHash: digest({ tool: payload?.tool_name, input: payload?.tool_input }),
      decision: "deny",
      executed: false
    };
    audit(record2);
    return {
      key: `ucr-guard:${guard.id}:${record2.actionHash}`,
      guardId: guard.id,
      reason: [
        "Verified prior correction blocked this repeated action before execution.",
        `Use instead: ${JSON.stringify(guard.replacementAction)}`,
        `Evidence: ${(guard.evidence || []).join(", ")}`
      ].join(" "),
      replacementAction: guard.replacementAction,
      persistent: true
    };
  }
  return null;
}

// src/optimizer/hooks/lib/observability.ts
function hookDeadlineMs(env = process.env) {
  const parsed = Number(env.TOKEN_OPTIMIZER_HOOK_DEADLINE_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4200;
}

// src/optimizer/hooks/pretooluse.ts
var HARVEST_MAX_BYTES = Number(process.env.TOKEN_OPTIMIZER_HARVEST_MAX_BYTES) || 4e6;
var SUBSTITUTE_PREFACE = '[optiflow: structure-preserving compression of this file -- imports/exports, signatures, and types are kept verbatim, but most function/method bodies are elided (see the inline "lines omitted" markers). Call the token-optimizer MCP tool smart_read with the same path if you need the full, uncompressed contents.]';
function verdictToHookOutput(verdict) {
  if (verdict.kind === "allow") return {};
  if (verdict.kind === "allowWithContext") return allowWithContext("PreToolUse", verdict.context);
  if (verdict.kind === "denyWithSubstitute") {
    return denyWithSubstitute("PreToolUse", verdict.reason, verdict.substitute);
  }
  return deny("PreToolUse", verdict.reason);
}
async function decidePreToolUse(raw) {
  if (!raw) return {};
  try {
    const currentMode = mode();
    if (currentMode === MODE_OFF) return {};
    const payload = normalizePayload(raw);
    if (!payload.tool_name) return {};
    const features = featuresForArm();
    const episode = episodeMeta({ client: "claude-code", raw });
    const agentScope = payload.transcript_path || null;
    const state = loadState(payload.session_id, agentScope);
    const toolEvidence = optimizerToolsForHook(raw, state);
    rememberOptimizerTools(state, toolEvidence);
    const ucrVerdict = evaluateUcrGuards(payload, touchedFiles(payload).map((item) => item.path));
    const verdict = ucrVerdict || (features.routing ? decide(payload, state, toolEvidence.names) : null);
    const dirFor = (path3) => wikiDir(projectRootFor(path3, payload.cwd) ?? payload.cwd);
    if (!verdict) {
      remember(payload, state);
      saveState(payload.session_id, state, agentScope);
      const touched = touchedFiles(payload);
      const bytes = readCostBytes(payload);
      if (bytes && payload.tool_input.file_path) {
        recordRead(dirFor(payload.tool_input.file_path), {
          anchor: payload.tool_input.file_path,
          sessionId: payload.session_id,
          bytes,
          fp: fingerprint(payload.tool_input.file_path)
        });
      } else if (isContentDump(payload.tool_input.command)) {
        for (const { path: path3, size } of touched) {
          if (size > 0) {
            recordRead(dirFor(path3), {
              anchor: path3,
              sessionId: payload.session_id,
              bytes: size,
              fp: fingerprint(path3)
            });
          }
        }
      }
      let context = null;
      if (features.retrieval) {
        try {
          state.injected = state.injected || [];
          const alreadyInjected = new Set(state.injected);
          const before = alreadyInjected.size;
          const parts2 = [];
          let actsChanged = false;
          for (const { path: path3 } of touched) {
            const dir = dirFor(path3);
            const note = forTouch(dir, load(dir), path3, {
              sessionId: payload.session_id,
              alreadyInjected,
              episode
            });
            if (note) parts2.push(note);
          }
          const command = payload.tool_input?.command;
          if (command) {
            const root = commandProjectRoot(payload, payload.cwd);
            const dir = wikiDir(root ?? payload.cwd);
            const note = forCommand(dir, load(dir), command, {
              sessionId: payload.session_id,
              alreadyInjected,
              episode
            });
            if (note) parts2.push(note);
            const shared = forSharedCommand(dir, command, {
              sessionId: payload.session_id,
              alreadyInjected,
              projectRoot: root,
              episode
            });
            if (shared) parts2.push(shared);
            const crossed = noteActClasses(state, command);
            if (crossed !== null) actsChanged = true;
            const repeat2 = forRepeatedAct(dir, command, crossed, {
              sessionId: payload.session_id,
              projectRoot: root,
              episode
            });
            if (repeat2) parts2.push(repeat2);
          }
          if (alreadyInjected.size !== before || actsChanged) {
            state.injected = [...alreadyInjected];
            saveState(payload.session_id, state, agentScope);
          }
          if (parts2.length) context = parts2.join("\n\n");
        } catch {
        }
      }
      try {
        if (features.harvest && toolEvidence.names.has("wiki_write") && isSubstantive(payload.tool_name)) {
          state.edits = (state.edits || 0) + 1;
          const edited = payload.tool_input?.file_path;
          if (edited) state.editedFiles = [edited, ...state.editedFiles || []].slice(0, 20);
          const nudge = recordingNudge(dirFor(edited || payload.cwd || process.cwd()), {
            state,
            edits: state.edits,
            files: state.editedFiles
          });
          if (nudge) {
            state.recordingNudged = true;
            context = context ? `${context}

${nudge}` : nudge;
          }
          saveState(payload.session_id, state, agentScope);
        }
      } catch {
      }
      try {
        const surfaced = maybeSurface(dirFor(payload.cwd || process.cwd()), {
          state
        });
        if (surfaced.state !== state.forecast) {
          state.forecast = surfaced.state;
          saveState(payload.session_id, state, agentScope);
        }
        if (surfaced.text) context = context ? `${context}

${surfaced.text}` : surfaced.text;
      } catch {
      }
      if (features.capture) {
        for (const { path: path3, size } of touched) {
          try {
            if (isArchived(path3)) continue;
            if (size > HARVEST_MAX_BYTES) continue;
            const dir = dirFor(path3);
            if (!isFsSafePath(path3)) continue;
            const source = readFileSync7(path3, "utf8");
            harvest(dir, {
              filePath: path3,
              sessionId: payload.session_id,
              action: payload.tool_name ?? void 0,
              hash: contentHash(path3, source)
            });
            indexFile(dir, path3, source);
          } catch {
          }
        }
      }
      return context ? allowWithContext("PreToolUse", context) : {};
    }
    const repeat = verdict.persistent ? false : alreadyDenied(state, verdict.key);
    const seenThisSession = Boolean(state.seen?.[payload.tool_input?.file_path ?? ""]);
    remember(payload, state);
    saveState(payload.session_id, state, agentScope);
    let reason = verdict.reason;
    let substitute;
    if (!repeat && payload.tool_name === "Read" && payload.tool_input.file_path) {
      try {
        const filePath = payload.tool_input.file_path;
        const dir = wikiDir(projectRootFor(filePath, payload.cwd) ?? payload.cwd);
        const graph = load(dir, { snapshots: true });
        const carried = refusalPayload(graph, filePath, { seenThisSession });
        if (carried) {
          reason = carried;
        } else {
          const source = readFileSync7(filePath, "utf8");
          indexFile(dir, filePath, source);
          const substitution = substitutionFor(
            dir,
            load(dir),
            payload.tool_input.raw_file_path ?? filePath,
            source,
            {
              sessionId: payload.session_id,
              client: episode.client,
              clientVersion: episode.clientVersion,
              model: episode.model,
              modelVersion: episode.modelVersion
            }
          );
          if (substitution) reason = substitution;
          if (currentMode === MODE_ENFORCE && Buffer.byteLength(source, "utf8") <= HARVEST_MAX_BYTES) {
            const { compressCode: compressCode2 } = await Promise.resolve().then(() => (init_code_compressor(), code_compressor_exports));
            const codeResult = await compressCode2(source);
            if (codeResult.language !== "unknown" && codeResult.wasModified && codeResult.compressed.length < source.length && codeResult.compressedTokens < codeResult.originalTokens) {
              substitute = `${SUBSTITUTE_PREFACE}

${codeResult.compressed}`;
            }
          }
        }
      } catch {
      }
    }
    return verdictToHookOutput(enforceVerdict(reason, repeat, currentMode, substitute));
  } catch {
    return {};
  }
}
async function runPreToolUse(readInput) {
  const raw = await readInput();
  return decidePreToolUse(raw);
}
async function main() {
  const deadline = new Promise((resolve2) => {
    setTimeout(() => resolve2({}), hookDeadlineMs()).unref?.();
  });
  const output = await Promise.race([
    runPreToolUse(() => readHookInput()),
    deadline
  ]);
  writeHookOutput(output);
}
var entryArg = process.argv[1];
var isDirectRun = typeof entryArg === "string" && import.meta.url === pathToFileURL(entryArg).href;
if (isDirectRun) {
  main();
}
export {
  decidePreToolUse,
  allow as hookAllow,
  runPreToolUse
};
//# sourceMappingURL=pretooluse-optimizer.mjs.map
