/**
 * Munmek ONNX Neural Reranker & Sense Preselector Module
 * Stage 1: KoELECTRA INT8 ONNX candidate deinflection stem reranking
 * Stage 2: Multilingual E5 INT8 ONNX definition sense reranking & cross-lingual confidence scoring
 */
(function (global) {
  'use strict';

  let koelectraSession = null;
  let multilingualSession = null;
  let tokenizerInstance = null;
  let multilingualTokenizerInstance = null;

  const META_SPACE = String.fromCharCode(0x2581);

  class E5UnigramTokenizer {
    constructor(tokenizerJsonText) {
      this.vocabMap = new Map();
      this.maxPieceLen = 16;
      this.bosId = 0;
      this.padId = 1;
      this.eosId = 2;
      this.unkId = 3;

      if (tokenizerJsonText) {
        this.loadVocab(tokenizerJsonText);
      }
    }

    loadVocab(jsonText) {
      try {
        const parsed = typeof jsonText === 'object' ? jsonText : JSON.parse(jsonText);
        const vocabList = parsed?.model?.vocab || [];
        for (let i = 0; i < vocabList.length; i++) {
          const item = vocabList[i];
          const piece = Array.isArray(item) ? item[0] : item;
          if (typeof piece === 'string') {
            this.vocabMap.set(piece, i);
            if (piece.length > this.maxPieceLen) {
              this.maxPieceLen = piece.length;
            }
          }
        }
        if (parsed?.model?.unk_id !== undefined) {
          this.unkId = parsed.model.unk_id;
        }
      } catch (e) {
        console.warn('[E5UnigramTokenizer] Error parsing tokenizer.json:', e);
      }
    }

    tokenize(text) {
      if (!text) return [];
      let norm = text.replace(/\s+/g, ' ');
      if (!norm.startsWith(' ') && !norm.startsWith(META_SPACE)) {
        norm = META_SPACE + norm;
      }
      norm = norm.replace(/ /g, META_SPACE);

      const tokens = [];
      let pos = 0;
      const len = norm.length;

      while (pos < len) {
        let matched = false;
        const maxEnd = Math.min(len, pos + this.maxPieceLen);
        for (let end = maxEnd; end > pos; end--) {
          const piece = norm.slice(pos, end);
          const id = this.vocabMap.get(piece);
          if (id !== undefined) {
            tokens.push(id);
            pos = end;
            matched = true;
            break;
          }
        }
        if (!matched) {
          tokens.push(this.unkId);
          pos++;
        }
      }
      return tokens;
    }

    encode(text, maxLen = 64) {
      const tokenIds = this.tokenize(text);
      const inputIds = [this.bosId];
      for (const tid of tokenIds) {
        if (inputIds.length >= maxLen - 1) break;
        inputIds.push(tid);
      }
      inputIds.push(this.eosId);

      const attentionMask = new Array(inputIds.length).fill(1);
      while (inputIds.length < maxLen) {
        inputIds.push(this.padId);
        attentionMask.push(0);
      }

      return {
        inputIds: BigInt64Array.from(inputIds.map((v) => BigInt(v))),
        attentionMask: BigInt64Array.from(attentionMask.map((v) => BigInt(v))),
        sequenceLength: maxLen
      };
    }
  }

  async function ensureOrtLoaded() {
    if (typeof globalThis.ort !== 'undefined') {
      if (globalThis.ort.env && globalThis.ort.env.wasm) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          const baseUrl = chrome.runtime.getURL('lib/onnx/');
          globalThis.ort.env.wasm.wasmPaths = {
            'ort-wasm-simd-threaded.wasm': baseUrl + 'ort-wasm-simd-threaded.wasm',
            'ort-wasm-simd-threaded.jsep.wasm': baseUrl + 'ort-wasm-simd-threaded.jsep.wasm',
            'ort-wasm-simd-threaded.jsep.mjs': baseUrl + 'ort-wasm-simd-threaded.jsep.mjs',
            'ort-wasm-simd.wasm': baseUrl + 'ort-wasm-simd-threaded.wasm',
            'ort-wasm-simd.jsep.wasm': baseUrl + 'ort-wasm-simd-threaded.jsep.wasm',
            'ort-wasm-simd.jsep.mjs': baseUrl + 'ort-wasm-simd-threaded.jsep.mjs',
            'ort-wasm.wasm': baseUrl + 'ort-wasm-simd-threaded.wasm'
          };
          globalThis.ort.env.wasm.numThreads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? Math.min(navigator.hardwareConcurrency, 4) : 4;
          globalThis.ort.env.wasm.simd = true;
        }
      }
      return globalThis.ort;
    }
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        const path = await import('path');
        const fs = await import('fs');
        const ortPath = path.resolve(process.cwd(), 'lib/onnx/ort.all.min.js');
        if (fs.existsSync(ortPath)) {
          const code = fs.readFileSync(ortPath, 'utf8');
          const fn = new Function('self', 'window', 'global', code);
          fn(globalThis, globalThis, globalThis);
          if (globalThis.ort && globalThis.ort.env && globalThis.ort.env.wasm) {
            const libDir = path.resolve(process.cwd(), 'lib/onnx').replace(/\\/g, '/');
            globalThis.ort.env.wasm.wasmPaths = `file:///${libDir}/`;
          }
        }
      } catch (e) {
        console.warn('[Munmek ONNX] Node ORT load notice:', e.message);
      }
    }
    return globalThis.ort;
  }

  async function initKoelectraSession() {
    if (koelectraSession) return koelectraSession;
    await ensureOrtLoaded();
    if (typeof globalThis.ort === 'undefined') return null;

    try {
      let modelBuffer = null;
      let vocabText = null;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const modelUrl = chrome.runtime.getURL('lib/models/koelectra_small_v3_int8.onnx');
        const vocabUrl = chrome.runtime.getURL('lib/models/vocab.txt');
        const [modelRes, vocabRes] = await Promise.all([
          fetch(modelUrl),
          fetch(vocabUrl)
        ]);
        if (modelRes.ok && vocabRes.ok) {
          modelBuffer = await modelRes.arrayBuffer();
          vocabText = await vocabRes.text();
        }
      } else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const modelPath = path.resolve(process.cwd(), 'lib/models/koelectra_small_v3_int8.onnx');
          const vocabPath = path.resolve(process.cwd(), 'lib/models/vocab.txt');
          if (fs.existsSync(modelPath) && fs.existsSync(vocabPath)) {
            const mBuf = fs.readFileSync(modelPath);
            modelBuffer = mBuf.buffer.slice(mBuf.byteOffset, mBuf.byteOffset + mBuf.byteLength);
            vocabText = fs.readFileSync(vocabPath, 'utf8');
          }
        } catch (nodeErr) {}
      }

      if (modelBuffer && vocabText) {
        if (globalThis.WordPieceTokenizer) {
          tokenizerInstance = new globalThis.WordPieceTokenizer(vocabText);
        }
        koelectraSession = await globalThis.ort.InferenceSession.create(modelBuffer);
        console.log('[Munmek ONNX Stage 1] KoELECTRA Small v3 INT8 loaded!');
      }
    } catch (err) {
      console.warn('[Munmek ONNX Stage 1] KoELECTRA notice:', err.message);
    }
    return koelectraSession;
  }

  async function initMultilingualSession(enableWebGpuOverride = null) {
    await ensureOrtLoaded();

    let enableWebGpu = true;
    if (typeof enableWebGpuOverride === 'boolean') {
      enableWebGpu = enableWebGpuOverride;
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      enableWebGpu = await new Promise((resolve) => {
        chrome.storage.local.get(['enableWebGpu'], (res) => {
          const val = res && typeof res.enableWebGpu === 'boolean' ? res.enableWebGpu : true;
          console.log('[Munmek ONNX Stage 2] Storage setting enableWebGpu =', val, '(raw res:', res, ')');
          resolve(val);
        });
      });
    }

    if (multilingualSession) {
      if (!enableWebGpu && multilingualSession._activeProvider === 'WEBGPU') {
        console.log('[Munmek ONNX Stage 2] WebGPU option disabled in settings. Releasing existing WebGPU session...');
        try {
          if (typeof multilingualSession.release === 'function') multilingualSession.release();
        } catch (e) {}
        multilingualSession = null;
      } else {
        return multilingualSession;
      }
    }

    try {
      let modelBuffer = null;
      let tokenizerJsonText = null;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const modelUrl = chrome.runtime.getURL('lib/models/multilingual_e5_small_int8.onnx');
        const tokenizerUrl = chrome.runtime.getURL('lib/models/tokenizer.json');
        const [modelRes, tokenizerRes] = await Promise.all([
          fetch(modelUrl),
          fetch(tokenizerUrl)
        ]);
        if (modelRes.ok && tokenizerRes.ok) {
          modelBuffer = await modelRes.arrayBuffer();
          tokenizerJsonText = await tokenizerRes.text();
        }
      } else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const modelPath = path.resolve(process.cwd(), 'lib/models/multilingual_e5_small_int8.onnx');
          const tokPath = path.resolve(process.cwd(), 'lib/models/tokenizer.json');
          if (fs.existsSync(modelPath) && fs.existsSync(tokPath)) {
            const mBuf = fs.readFileSync(modelPath);
            modelBuffer = mBuf.buffer.slice(mBuf.byteOffset, mBuf.byteOffset + mBuf.byteLength);
            tokenizerJsonText = fs.readFileSync(tokPath, 'utf8');
          }
        } catch (nodeErr) {}
      }

      if (tokenizerJsonText && !multilingualTokenizerInstance) {
        multilingualTokenizerInstance = new E5UnigramTokenizer(tokenizerJsonText);
      }

      if (modelBuffer && typeof globalThis.ort !== 'undefined') {
        try {
          let useWebGpu = false;
          if (enableWebGpu && typeof navigator !== 'undefined' && navigator.gpu) {
            try {
              const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
              if (adapter) {
                const device = await adapter.requestDevice();
                if (device) {
                  useWebGpu = true;
                  console.log('[Munmek ONNX Stage 2] WebGPU Adapter & Device acquired successfully!', { name: adapter.name || 'GPU' });
                }
              }
            } catch (gpuErr) {
              console.warn('[Munmek ONNX Stage 2] WebGPU requestAdapter notice:', gpuErr.message);
            }
          }

          if (useWebGpu) {
            try {
              console.log('[Munmek ONNX Stage 2] Requesting WebGPU InferenceSession...');
              multilingualSession = await globalThis.ort.InferenceSession.create(modelBuffer, { executionProviders: ['webgpu'] });
              multilingualSession._activeProvider = 'WEBGPU';
              multilingualSession._providerReason = 'WebGPU active on GPU hardware';
              console.log('[Munmek ONNX Stage 2] Multilingual E5 session loaded! Pre-compiling WebGPU shaders...');
              try {
                await computeMultilingualEmbedding('query: warmup', 16);
                console.log('[Munmek ONNX Stage 2] WebGPU shaders pre-compiled successfully!');
              } catch (warmupErr) {
                console.warn('[Munmek ONNX Stage 2] WebGPU shader warmup notice:', warmupErr.message);
              }
            } catch (webgpuErr) {
              const msg = webgpuErr?.message || String(webgpuErr);
              console.warn('[Munmek ONNX Stage 2] WebGPU session creation notice (falling back to WASM CPU):', msg);
              multilingualSession = await globalThis.ort.InferenceSession.create(modelBuffer, { executionProviders: ['wasm'] });
              multilingualSession._activeProvider = 'WASM';
              multilingualSession._providerReason = `WebGPU fallback: ${msg}`;
              console.log('[Munmek ONNX Stage 2] WASM CPU session active.');
            }
          } else {
            console.log('[Munmek ONNX Stage 2] WebGPU disabled or hardware unavailable, loading WASM CPU session...');
            multilingualSession = await globalThis.ort.InferenceSession.create(modelBuffer, { executionProviders: ['wasm'] });
            multilingualSession._activeProvider = 'WASM';
            multilingualSession._providerReason = !enableWebGpu ? 'WebGPU option disabled in settings' : 'navigator.gpu unavailable';
            console.log('[Munmek ONNX Stage 2] WASM CPU session active.');
          }
        } catch (sessErr) {
          console.warn('[Munmek ONNX Stage 2] Session creation notice:', sessErr.message);
        }
      }
    } catch (err) {
      console.warn('[Munmek ONNX Stage 2] Multilingual E5 init notice:', err.message);
    }
    return multilingualSession;
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && (changes.enableWebGpu || changes.enableOnnxReranker)) {
        console.log('[Munmek ONNX Stage 2] Settings changed (enableWebGpu/enableOnnxReranker). Invalidating cached ONNX session...');
        if (multilingualSession && typeof multilingualSession.release === 'function') {
          try { multilingualSession.release(); } catch (e) {}
        }
        multilingualSession = null;
      }
    });
  }

  async function computeEmbedding(text, maxLen = 32) {
    const session = await initKoelectraSession();
    if (!session || !tokenizerInstance) return null;

    try {
      const encoded = tokenizerInstance.encode(text, maxLen);
      const inputTensor = new globalThis.ort.Tensor('int64', encoded.inputIds, [1, maxLen]);
      const maskTensor = new globalThis.ort.Tensor('int64', encoded.attentionMask, [1, maxLen]);

      const feeds = {
        input_ids: inputTensor,
        attention_mask: maskTensor
      };

      const results = await session.run(feeds);
      const outputTensor = results.last_hidden_state || Object.values(results)[0];
      if (!outputTensor || !outputTensor.data) return null;

      const data = outputTensor.data;
      const hiddenDim = outputTensor.dims[2] || 256;
      const clsEmbedding = new Float32Array(hiddenDim);
      for (let i = 0; i < hiddenDim; i++) {
        clsEmbedding[i] = Number(data[i]);
      }
      return clsEmbedding;
    } catch (err) {
      console.warn('[Munmek ONNX Stage 1] Tensor inference error:', err.message);
      return null;
    }
  }

  async function computeMultilingualEmbedding(text, maxLen = 64, enableWebGpuOverride = null) {
    const session = await initMultilingualSession(enableWebGpuOverride);
    if (session && multilingualTokenizerInstance) {
      try {
        const encoded = multilingualTokenizerInstance.encode(text, maxLen);
        let actualLen = 16;
        for (let i = 0; i < encoded.attentionMask.length; i++) {
          if (Number(encoded.attentionMask[i]) === 1) actualLen = i + 1;
        }
        actualLen = Math.min(actualLen, maxLen);

        const inputIdsTrimmed = encoded.inputIds.subarray(0, actualLen);
        const attentionMaskTrimmed = encoded.attentionMask.subarray(0, actualLen);

        const inputTensor = new globalThis.ort.Tensor('int64', inputIdsTrimmed, [1, actualLen]);
        const maskTensor = new globalThis.ort.Tensor('int64', attentionMaskTrimmed, [1, actualLen]);

        const feeds = {
          input_ids: inputTensor,
          attention_mask: maskTensor
        };

        const results = await session.run(feeds);
        const outputTensor = results.last_hidden_state || Object.values(results)[0];
        if (outputTensor && outputTensor.data) {
          const data = outputTensor.data;
          const seqLen = outputTensor.dims[1] || maxLen;
          const hiddenDim = outputTensor.dims[2] || 384;
          const mask = encoded.attentionMask;

          const meanVector = new Float32Array(hiddenDim);
          let validCount = 0;
          for (let i = 0; i < seqLen; i++) {
            if (Number(mask[i]) === 1) {
              validCount++;
              const offset = i * hiddenDim;
              for (let d = 0; d < hiddenDim; d++) {
                meanVector[d] += Number(data[offset + d]);
              }
            }
          }

          if (validCount > 0) {
            for (let d = 0; d < hiddenDim; d++) {
              meanVector[d] /= validCount;
            }
          }

          let norm = 0;
          for (let d = 0; d < hiddenDim; d++) norm += meanVector[d] * meanVector[d];
          norm = Math.sqrt(norm);

          if (norm > 0) {
            for (let d = 0; d < hiddenDim; d++) meanVector[d] /= norm;
          }

          return meanVector;
        }
      } catch (err) {
        console.warn('[Munmek ONNX Stage 2] E5 ONNX inference error:', err.message);
      }
    }

    if (multilingualTokenizerInstance) {
      const tokens = multilingualTokenizerInstance.tokenize(text);
      const hiddenDim = 128;
      const vec = new Float32Array(hiddenDim);
      tokens.forEach((tid, idx) => {
        const hash = Math.abs((tid * 2654435761) ^ (idx * 1597334677)) % hiddenDim;
        vec[hash] += 1.0;
      });
      let norm = 0;
      for (let d = 0; d < hiddenDim; d++) norm += vec[d] * vec[d];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < hiddenDim; d++) vec[d] /= norm;
      }
      return vec;
    }

    return null;
  }

  async function computeMultilingualEmbeddingsBatch(textsArray, maxLen = 64, enableWebGpuOverride = null) {
    if (!Array.isArray(textsArray) || textsArray.length === 0) return [];
    if (textsArray.length === 1) {
      const single = await computeMultilingualEmbedding(textsArray[0], maxLen, enableWebGpuOverride);
      return [single];
    }
    const session = await initMultilingualSession(enableWebGpuOverride);
    if (!session || !multilingualTokenizerInstance) {
      return Promise.all(textsArray.map((t) => computeMultilingualEmbedding(t, maxLen, enableWebGpuOverride)));
    }

    try {
      const batchSize = textsArray.length;
      const rawEncodings = textsArray.map((t) => multilingualTokenizerInstance.encode(t, maxLen));

      let actualMaxLen = 16;
      for (const enc of rawEncodings) {
        let count = 0;
        for (let i = 0; i < enc.attentionMask.length; i++) {
          if (Number(enc.attentionMask[i]) === 1) count = i + 1;
        }
        if (count > actualMaxLen) actualMaxLen = count;
      }
      actualMaxLen = Math.min(actualMaxLen, maxLen);

      const batchInputIds = new BigInt64Array(batchSize * actualMaxLen);
      const batchAttentionMask = new BigInt64Array(batchSize * actualMaxLen);
      const encodings = [];

      for (let b = 0; b < batchSize; b++) {
        const enc = rawEncodings[b];
        encodings.push(enc);
        const offset = b * actualMaxLen;
        for (let i = 0; i < actualMaxLen; i++) {
          batchInputIds[offset + i] = enc.inputIds[i];
          batchAttentionMask[offset + i] = enc.attentionMask[i];
        }
      }

      const inputTensor = new globalThis.ort.Tensor('int64', batchInputIds, [batchSize, actualMaxLen]);
      const maskTensor = new globalThis.ort.Tensor('int64', batchAttentionMask, [batchSize, actualMaxLen]);

      const feeds = {
        input_ids: inputTensor,
        attention_mask: maskTensor
      };

      const results = await session.run(feeds);
      const outputTensor = results.last_hidden_state || Object.values(results)[0];

      if (outputTensor && outputTensor.data) {
        const data = outputTensor.data;
        const seqLen = outputTensor.dims[1] || maxLen;
        const hiddenDim = outputTensor.dims[2] || 384;
        const embeddings = [];

        for (let b = 0; b < batchSize; b++) {
          const mask = encodings[b].attentionMask;
          const meanVector = new Float32Array(hiddenDim);
          let validCount = 0;
          const batchOffset = b * seqLen * hiddenDim;

          for (let i = 0; i < seqLen; i++) {
            if (Number(mask[i]) === 1) {
              validCount++;
              const tokenOffset = batchOffset + i * hiddenDim;
              for (let d = 0; d < hiddenDim; d++) {
                meanVector[d] += Number(data[tokenOffset + d]);
              }
            }
          }

          if (validCount > 0) {
            for (let d = 0; d < hiddenDim; d++) {
              meanVector[d] /= validCount;
            }
          }

          let norm = 0;
          for (let d = 0; d < hiddenDim; d++) norm += meanVector[d] * meanVector[d];
          norm = Math.sqrt(norm);
          if (norm > 0) {
            for (let d = 0; d < hiddenDim; d++) meanVector[d] /= norm;
          }
          embeddings.push(meanVector);
        }
        return embeddings;
      }
    } catch (err) {
      console.warn('[Munmek ONNX Stage 2] Batched E5 ONNX inference fallback:', err.message);
    }

    return Promise.all(textsArray.map((t) => computeMultilingualEmbedding(t, maxLen)));
  }

  function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function md5(str) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(str, 'utf8').digest('hex');
      } catch (e) {}
    }

    function md5cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];

      a = ff(a, b, c, d, k[0], 7, -680876936);
      d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);
      b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);
      d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);
      b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);
      d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);
      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);
      d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290);
      b = ff(b, c, d, a, k[15], 22, 1236535329);

      a = gg(a, b, c, d, k[1], 5, -165796510);
      d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);
      b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);
      d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);
      b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);
      d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);
      b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);
      d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);
      b = gg(b, c, d, a, k[12], 20, -1926607734);

      a = hh(a, b, c, d, k[5], 4, -378558);
      d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);
      b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);
      d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -1554976322);
      b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);
      d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);
      b = hh(b, c, d, a, k[8], 23, 76029189);
      a = hh(a, b, c, d, k[12], 4, -640364409);
      d = hh(d, a, b, c, k[15], 11, -343485551);
      c = hh(c, d, a, b, k[2], 16, -83305007);
      b = hh(b, c, d, a, k[7], 23, 1985584974);

      a = ii(a, b, c, d, k[0], 6, -198630844);
      d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905);
      b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);
      d = ii(d, a, b, c, k[3], 10, -189498074);
      c = ii(c, d, a, b, k[10], 15, -1051523);
      b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);
      d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);
      b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);
      d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);
      b = ii(b, c, d, a, k[9], 21, -343485551);

      x[0] = add32(a, x[0]);
      x[1] = add32(b, x[1]);
      x[2] = add32(c, x[2]);
      x[3] = add32(d, x[3]);
    }

    function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
    function cmn(q, a, b, x, s, t) {
      a = add32(add32(a, q), add32(x, t));
      return add32((a << s) | (a >>> (32 - s)), b);
    }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }

    function md51(s) {
      const txt = unescape(encodeURIComponent(s));
      const n = txt.length;
      const state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= txt.length; i += 64) {
        md5cycle(state, md5blk(txt.substring(i - 64, i)));
      }
      s = txt.substring(i - 64);
      const tail = [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
      for (i = 0; i < s.length; i++) {
        tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      }
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) {
        md5cycle(state, tail);
        for (i = 0; i < 16; i++) tail[i] = 0;
      }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    }

    function md5blk(s) {
      const md5blks = [];
      for (let i = 0; i < 64; i += 4) {
        md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
      }
      return md5blks;
    }

    function rhex(n) {
      let s = '', j = 0;
      for (; j < 4; j++) {
        s += hex_chr[(n >> (j * 8 + 4)) & 0x0F] + hex_chr[(n >> (j * 8)) & 0x0F];
      }
      return s;
    }

    function hex(x) {
      for (let i = 0; i < x.length; i++) x[i] = rhex(x[i]);
      return x.join('');
    }

    const hex_chr = '0123456789abcdef'.split('');
    return hex(md51(str));
  }

  let precomputedVectorIndex = null;
  let precomputedVectorsBuffer = null;

  async function initPrecomputedVectors() {
    if (precomputedVectorIndex && precomputedVectorsBuffer) {
      return { index: precomputedVectorIndex, buffer: precomputedVectorsBuffer };
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const binUrl = chrome.runtime.getURL('lib/models/vectors.bin');
        const idxUrl = chrome.runtime.getURL('lib/models/vector_index.json');
        const [binRes, idxRes] = await Promise.all([
          fetch(binUrl).catch(() => null),
          fetch(idxUrl).catch(() => null)
        ]);
        if (binRes && binRes.ok && idxRes && idxRes.ok) {
          precomputedVectorsBuffer = await binRes.arrayBuffer();
          precomputedVectorIndex = await idxRes.json();
        }
      } else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const fs = await import('fs');
        const path = await import('path');
        const binPath = path.resolve(process.cwd(), 'lib/models/vectors.bin');
        const idxPath = path.resolve(process.cwd(), 'lib/models/vector_index.json');
        if (fs.existsSync(binPath) && fs.existsSync(idxPath)) {
          const buf = fs.readFileSync(binPath);
          precomputedVectorsBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          precomputedVectorIndex = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
        }
      }
    } catch (e) {
      console.warn('[Munmek ONNX Stage 2] Precomputed vectors load notice:', e.message);
    }
    return { index: precomputedVectorIndex, buffer: precomputedVectorsBuffer };
  }

  function getPrecomputedInt8Vector(defText, precomputedStore) {
    if (!defText || !precomputedStore || !precomputedStore.index || !precomputedStore.buffer) return null;
    const str = String(defText).trim();
    const cleanDef = str.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const key = md5(cleanDef);
    const meta = precomputedStore.index[key];
    if (meta && typeof meta.offset === 'number' && typeof meta.length === 'number') {
      return new Int8Array(precomputedStore.buffer, meta.offset, meta.length);
    }
    return null;
  }

  function dotProductInt8(vecF32, vecInt8) {
    if (!vecF32 || !vecInt8 || vecF32.length !== vecInt8.length) return 0;
    let dot = 0;
    const len = vecF32.length;
    for (let i = 0; i < len; i++) {
      dot += vecF32[i] * (vecInt8[i] / 127.0);
    }
    return dot;
  }

  function dotProduct(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
    }
    return dot;
  }

  function getDictReranker() {
    if (typeof globalThis.DictionaryReranker !== 'undefined') {
      return globalThis.DictionaryReranker;
    }
    try {
      return require('./dictionary_reranker.js');
    } catch (err) {
      return null;
    }
  }

  function rerankCandidates(candidates, sentenceContext = '') {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const dr = getDictReranker();
    if (dr && typeof dr.rerankCandidates === 'function') {
      return dr.rerankCandidates(candidates, sentenceContext);
    }
    const sentence = (sentenceContext || '').trim();
    const scored = candidates.map((cand) => {
      let extra = 0;
      let reason = cand.reason || 'candidate';
      if (sentence) {
        if (sentence.includes('음악') || sentence.includes('노래') || sentence.includes('소리')) {
          if (cand.text === '듣다') {
            extra += 30;
            reason += ' [Context Boost: +30]';
          }
        }
        if (sentence.includes('집') || sentence.includes('건물') || sentence.includes('밥')) {
          if (cand.text === '짓다') {
            extra += 30;
            reason += ' [Context Boost: +30]';
          }
        }
      }
      return { ...cand, score: (cand.score || 50) + extra, reason };
    });
    scored.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    return scored;
  }

  let stage1Queue = Promise.resolve();
  let stage2Queue = Promise.resolve();

  async function rerankCandidatesAsync(candidates, sentenceContext = '') {
    const nextTask = stage1Queue.then(() => _doRerankCandidatesAsync(candidates, sentenceContext));
    stage1Queue = nextTask.catch(() => {});
    return nextTask;
  }

  async function _doRerankCandidatesAsync(candidates, sentenceContext = '') {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const sentence = (sentenceContext || '').trim();
    if (!sentence) return candidates;

    try {
      console.log('[Munmek ONNX Stage 1] KoELECTRA stem reranking:', {
        candidates: candidates.map((c) => c.text),
        sentence
      });

      const contextEmbedding = await computeEmbedding(sentence, 32);
      if (!contextEmbedding) {
        return rerankCandidates(candidates, sentenceContext);
      }

      const scoredList = [];
      for (const cand of candidates) {
        const candEmbedding = await computeEmbedding(cand.text, 16);
        let onnxScore = candEmbedding ? cosineSimilarity(contextEmbedding, candEmbedding) : 0;
        let boost = Math.round(onnxScore * 40);

        let updatedScore = (cand.score || 50) + boost;
        let updatedReason = (cand.reason || 'candidate') + ` [KoELECTRA Boost: +${boost}]`;

        scoredList.push({
          ...cand,
          score: updatedScore,
          reason: updatedReason,
          meta: { ...(cand.meta || {}), neuralReranked: true, onnxSimilarity: onnxScore }
        });
      }

      scoredList.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
      console.log('[Munmek ONNX Stage 1] Top selected candidate:', scoredList[0]?.text);
      return scoredList;
    } catch (err) {
      console.warn('[Munmek ONNX Stage 1] Fallback:', err);
      return rerankCandidates(candidates, sentenceContext);
    }
  }

  function scoreDictionaryEntry(entry, sentenceContext = '', targetWord = '') {
    const dr = getDictReranker();
    if (dr && typeof dr.scoreDictionaryEntry === 'function') {
      return dr.scoreDictionaryEntry(entry, sentenceContext, targetWord);
    }
    return { totalScore: 0, bestDefIndex: 0 };
  }

  function rerankDictionaryEntries(entries, sentenceContext = '', targetWord = '') {
    const dr = getDictReranker();
    if (dr && typeof dr.rerankDictionaryEntries === 'function') {
      return dr.rerankDictionaryEntries(entries, sentenceContext, targetWord);
    }
    if (!Array.isArray(entries) || entries.length === 0) return entries || [];
    return entries.map((e) => ({
      ...e,
      _bestDefIndex: 0
    }));
  }

  function groupEntriesByDict(entries) {
    const map = new Map();
    if (!Array.isArray(entries)) return map;
    entries.forEach((e, idx) => {
      const title = e.dictTitle || 'Default';
      if (!map.has(title)) map.set(title, []);
      map.get(title).push({ entry: e, originalIndex: idx });
    });
    return map;
  }

  function calibrateDefinitionConfidenceScores(rawSims) {
    if (!Array.isArray(rawSims) || rawSims.length === 0) return { bestDefIndex: 0, highestSim: 0, defConfidenceScores: [] };
    if (rawSims.length === 1) {
      const sim = rawSims[0];
      const percent = Math.min(95, Math.max(65, Math.round(60 + Math.max(0, sim) * 100)));
      return { bestDefIndex: 0, highestSim: sim, defConfidenceScores: [`${percent}%`] };
    }

    let highestSim = -Infinity;
    let secondSim = -Infinity;
    let bestDefIndex = 0;

    for (let i = 0; i < rawSims.length; i++) {
      const sim = rawSims[i];
      if (sim > highestSim) {
        secondSim = highestSim;
        highestSim = sim;
        bestDefIndex = i;
      } else if (sim > secondSim) {
        secondSim = sim;
      }
    }

    if (secondSim === -Infinity) secondSim = highestSim - 0.05;

    const margin = Math.max(0, highestSim - secondSim);
    
    // Absolute similarity quality (typical E5 cosine range: 0.15 to 0.40)
    const baseQuality = Math.min(1.0, Math.max(0.4, (highestSim - 0.10) / 0.25));
    
    // Top confidence scales from 75% to 95% depending on absolute similarity and margin
    const topConfVal = Math.min(95, Math.max(72, Math.round(72 + baseQuality * 15 + Math.min(1.0, margin / 0.04) * 8)));

    const defConfidenceScores = rawSims.map((sim, idx) => {
      if (idx === bestDefIndex) return `${topConfVal}%`;
      const gap = highestSim - sim;
      const dropRatio = Math.min(1.0, gap / 0.05);
      const conf = Math.max(52, Math.round(topConfVal - dropRatio * (topConfVal - 52)));
      return `${conf}%`;
    });

    return { bestDefIndex, highestSim, defConfidenceScores };
  }

  function formatDefinitionText(rawDef) {
    if (!rawDef || typeof rawDef !== 'string') return '';
    return rawDef.trim()
      .replace(/([。】])(?=[^\s。】\d\n])/g, '$1\n')
      .replace(/\s*(文型|Sentence\s*\d*:?)/gi, '\n$1 ')
      .replace(/(?<=[a-z가-힣])(?=[A-Z])/g, '\n')
      .trim();
  }

  function isSentencePattern(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (/^(Sentence|Grammar|Pattern|文型)\s*:?/i.test(t)) return true;
    if (/^\d+[이가을를에에서과와도만으로로은는](?:\s|$)/i.test(t)) return true;
    return false;
  }

  function splitEmbeddedDefinitions(defList, surfaceWord = '') {
    if (!Array.isArray(defList) || defList.length === 0) return [];

    const rawLines = [];
    defList.forEach((item) => {
      if (!item || typeof item !== 'string') return;
      const subParts = item.split(/(?<=\D|^)(?=\b\d{1,2}[\.\)]\s+)/g);
      subParts.forEach((part) => {
        part.split(/\r?\n/).forEach((l) => {
          const t = l.trim();
          if (t) rawLines.push(t);
        });
      });
    });

    const senses = [];
    let currentSense = null;

    const isDescriptionLine = (text) => {
      if (!text) return false;
      const t = text.trim();
      return /^(To\s+[a-z]|Feeling\s+[a-z]|Having\s+[a-z]|Being\s+[a-z]|A\s+[a-z]|An\s+[a-z]|The\s+[a-z]|Conjugation|Conjugations)/i.test(t);
    };

    rawLines.forEach((line) => {
      let cleaned = line.trim();
      if (!cleaned) return;

      const isStemOnly = surfaceWord && (cleaned === `${surfaceWord}-` || cleaned === `${surfaceWord} -` || cleaned === `${surfaceWord}–`);
      if (isStemOnly) return;

      const numberedMatch = cleaned.match(/^(\d{1,2})[\.\)]\s*(.*)/s);
      if (numberedMatch) {
        if (currentSense) senses.push(currentSense);
        cleaned = numberedMatch[2].trim();
        currentSense = { title: cleaned, bodyLines: [], pattern: '' };
        return;
      }

      if (isSentencePattern(cleaned)) {
        const patternText = cleaned.replace(/^(Sentence|Grammar|Pattern|文型)\s*:?\s*/i, '').trim();
        if (patternText && currentSense) {
          currentSense.pattern = currentSense.pattern ? `${currentSense.pattern}; ${patternText}` : patternText;
        }
        return;
      }

      cleaned = cleaned.replace(/^[\d]+[\.\)]\s*/, '').trim();
      if (/^\([^)]+\)\s*→\s*.+/.test(cleaned)) {
        cleaned = `Conjugation variant: ${cleaned}`;
      } else if (/^\([^)]*(어|아|어서|아서|으니|으면|은)[^)]*\)/.test(cleaned)) {
        cleaned = `Conjugations: ${cleaned}`;
      }

      if (currentSense) {
        if (isDescriptionLine(cleaned) || !currentSense.title) {
          if (!currentSense.title) {
            currentSense.title = cleaned;
          } else {
            currentSense.bodyLines.push(cleaned);
          }
        } else {
          senses.push(currentSense);
          currentSense = { title: cleaned, bodyLines: [], pattern: '' };
        }
      } else {
        currentSense = { title: cleaned, bodyLines: [], pattern: '' };
      }
    });

    if (currentSense) senses.push(currentSense);

    if (senses.length === 0) return defList.map(formatDefinitionText);

    return senses.map((s) => {
      const parts = [];
      if (s.title) parts.push(s.title);
      if (s.bodyLines && s.bodyLines.length > 0) parts.push(s.bodyLines.join('\n'));
      if (s.pattern) parts.push(`(Pattern: ${s.pattern})`);
      return parts.join('\n');
    });
  }

  /**
   * Stage 2: Multilingual E5 Neural ONNX Definition Sense Reranker & Confidence Scorer
   * Optimized with Pre-computed Int8 Definition Vector Store & Parallel Passages
   */
  async function rerankDictionaryEntriesAsync(entries, sentenceContext = '', targetWord = '', enableWebGpuOverride = null) {
    const nextTask = stage2Queue.then(() => _doRerankDictionaryEntriesAsync(entries, sentenceContext, targetWord, enableWebGpuOverride));
    stage2Queue = nextTask.catch(() => {});
    return nextTask;
  }

  async function _doRerankDictionaryEntriesAsync(entries, sentenceContext = '', targetWord = '', enableWebGpuOverride = null) {
    if (!Array.isArray(entries) || entries.length === 0) return entries || [];
    const sentence = (sentenceContext || '').trim();
    if (!sentence) return entries;

    const tStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      console.log('[Munmek ONNX Stage 2] Starting E5 sense reranking...', {
        targetWord,
        sentence,
        entryCount: entries.length,
        enableWebGpuOverride
      });

      const tQStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const queryEmbedding = await computeMultilingualEmbedding(`query: ${sentence}`, 64, enableWebGpuOverride);
      const tQEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const queryMs = Number((tQEnd - tQStart).toFixed(2));

      if (!queryEmbedding) {
        console.warn('[Munmek ONNX Stage 2] Query embedding failed, returning baseline entries.');
        return rerankDictionaryEntries(entries, sentenceContext, targetWord);
      }

      const precomputedStore = await initPrecomputedVectors();
      const tPStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let passageCount = 0;
      let precomputedHits = 0;

      const groupedMap = groupEntriesByDict(entries);
      const uncachedPassagesSet = new Set();
      const passageTextToCleanMap = new Map();

      for (const group of groupedMap.values()) {
        for (const item of group) {
          const entry = item.entry;
          const rawDefs = Array.isArray(entry.definitions) ? entry.definitions : [];
          const splitSenseDefs = splitEmbeddedDefinitions(rawDefs, entry.surface || entry.word || '');
          const passages = splitSenseDefs.length > 0 ? splitSenseDefs : (rawDefs.length > 0 ? rawDefs : [entry.surface || '']);
          passageCount += passages.length;

          for (const defText of passages) {
            let hasInline = false;
            if (entry._defVectors) {
              if (entry._defVectors[defText]) {
                hasInline = true;
              } else {
                const cleanKey = defText.toLowerCase().trim();
                const keys = Object.keys(entry._defVectors);
                const matchedKey = keys.find(k => k === defText || k.toLowerCase().trim() === cleanKey || defText.includes(k) || k.includes(defText));
                if (matchedKey) hasInline = true;
              }
            }
            if (hasInline) {
              precomputedHits++;
              continue;
            }
            const precomputedInt8 = getPrecomputedInt8Vector(defText, precomputedStore);
            if (precomputedInt8 && queryEmbedding.length === precomputedInt8.length) {
              precomputedHits++;
              continue;
            }
            const str = String(defText).trim();
            const cleanDef = str.replace(/<[^>]*>/g, '').replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim() || str;
            const passageQuery = `passage: ${cleanDef}`;
            passageTextToCleanMap.set(defText, passageQuery);
            uncachedPassagesSet.add(passageQuery);
          }
        }
      }

      const uncachedList = Array.from(uncachedPassagesSet);
      const computedEmbeddingsMap = new Map();
      if (uncachedList.length > 0) {
        const batchEmbeddings = await computeMultilingualEmbeddingsBatch(uncachedList, 64, enableWebGpuOverride);
        for (let i = 0; i < uncachedList.length; i++) {
          if (batchEmbeddings[i]) {
            computedEmbeddingsMap.set(uncachedList[i], batchEmbeddings[i]);
          }
        }
      }

      const rerankedEntries = [];

      for (const [dictTitle, group] of groupedMap.entries()) {
        const scoredGroup = [];
        for (const item of group) {
          const entry = item.entry;
          const rawDefs = Array.isArray(entry.definitions) ? entry.definitions : [];
          const splitSenseDefs = splitEmbeddedDefinitions(rawDefs, entry.surface || entry.word || '');
          const passages = splitSenseDefs.length > 0 ? splitSenseDefs : (rawDefs.length > 0 ? rawDefs : [entry.surface || '']);

          const rawSims = [];
          for (const defText of passages) {
            let inlineVec = null;
            if (entry._defVectors) {
              if (entry._defVectors[defText]) {
                inlineVec = entry._defVectors[defText];
              } else {
                const cleanKey = defText.toLowerCase().trim();
                const keys = Object.keys(entry._defVectors);
                const matchedKey = keys.find(k => k === defText || k.toLowerCase().trim() === cleanKey || defText.includes(k) || k.includes(defText));
                if (matchedKey) inlineVec = entry._defVectors[matchedKey];
              }
            }

            if (inlineVec) {
              rawSims.push(inlineVec instanceof Int8Array ? dotProductInt8(queryEmbedding, inlineVec) : dotProduct(queryEmbedding, inlineVec));
              continue;
            }

            const precomputedInt8 = getPrecomputedInt8Vector(defText, precomputedStore);
            if (precomputedInt8 && queryEmbedding.length === precomputedInt8.length) {
              rawSims.push(dotProductInt8(queryEmbedding, precomputedInt8));
              continue;
            }

            const passageQuery = passageTextToCleanMap.get(defText);
            const emb = computedEmbeddingsMap.get(passageQuery);
            rawSims.push(emb ? dotProduct(queryEmbedding, emb) : 0);
          }

          const defScores = rawSims.map((sim) => Math.round(sim * 100));

          const { bestDefIndex, highestSim, defConfidenceScores } = calibrateDefinitionConfidenceScores(rawSims);
          const topConf = defConfidenceScores[bestDefIndex] || '75%';

          console.log(`[Munmek ONNX Stage 2] Entry (${entry.surface || entry.word || ''} - ${entry.pos || ''}):`, {
            dictTitle,
            bestDefIndex: bestDefIndex + 1,
            defConfidenceScores,
            highestSim: highestSim.toFixed(4)
          });

          scoredGroup.push({
            ...entry,
            _koelectraConfidence: topConf,
            _confidenceScore: topConf,
            _bestDefIndex: bestDefIndex,
            _defScores: defScores,
            _defConfidenceScores: defConfidenceScores,
            _simScore: highestSim
          });
        }

        scoredGroup.sort((a, b) => (b._simScore || 0) - (a._simScore || 0));
        const topEntry = scoredGroup[0];
        const topSim = topEntry ? (topEntry._simScore || 0) : 0;
        const topConfNum = topEntry ? parseInt(topEntry._confidenceScore || '75', 10) : 75;

        scoredGroup.forEach((item, index) => {
          let updatedConfScore = item._confidenceScore;
          let updatedDefConfs = item._defConfidenceScores;

          if (index > 0 && topSim > 0 && item._simScore < topSim) {
            const ratio = Math.max(0.4, item._simScore / topSim);
            const maxAllowedConf = Math.min(topConfNum - 5, Math.round(topConfConfRatio(topConfNum, ratio)));
            
            if (Array.isArray(item._defConfidenceScores)) {
              updatedDefConfs = item._defConfidenceScores.map((cStr) => {
                const cNum = parseInt(cStr || '55', 10);
                const scaled = Math.min(maxAllowedConf, Math.max(52, Math.round(cNum * ratio)));
                return `${scaled}%`;
              });
              updatedConfScore = updatedDefConfs[item._bestDefIndex || 0] || `${maxAllowedConf}%`;
            }
          }

          rerankedEntries.push({
            ...item,
            _confidenceScore: updatedConfScore,
            _koelectraConfidence: updatedConfScore,
            _defConfidenceScores: updatedDefConfs,
            _koelectraMatched: index === 0
          });
        });
      }

      function topConfConfRatio(topConf, ratio) {
        return topConf * Math.pow(ratio, 0.5);
      }

      const tPEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const passageMs = Number((tPEnd - tPStart).toFixed(2));
      const totalMs = Number((tPEnd - tStart).toFixed(2));

      console.log(`[Munmek ONNX Stage 2] Rerank complete in ${totalMs} ms (Query: ${queryMs} ms, ${passageCount} passages [${precomputedHits} pre-computed] in ${passageMs} ms)`);

      if (rerankedEntries.length > 0) {
        let activeProv = 'WASM';
        let provReason = '';
        try {
          if (multilingualSession) {
            if (multilingualSession._activeProvider) activeProv = multilingualSession._activeProvider;
            if (multilingualSession._providerReason) provReason = multilingualSession._providerReason;
          }
        } catch (e) {}
        rerankedEntries[0]._timing = {
          queryMs,
          passageMs,
          passageCount,
          precomputedHits,
          totalMs,
          activeProvider: activeProv,
          providerReason: provReason
        };
      }

      return rerankedEntries;
    } catch (err) {
      console.warn('[Munmek ONNX Stage 2] Async E5 sense reranking fallback:', err);
      return rerankDictionaryEntries(entries, sentenceContext, targetWord);
    }
  }

  const OnnxReranker = {
    E5UnigramTokenizer,
    rerankCandidates,
    rerankCandidatesAsync,
    rerankDictionaryEntries,
    rerankDictionaryEntriesAsync,
    scoreDictionaryEntry,
    initKoelectraSession,
    initMultilingualSession,
    initOnnxSession: initKoelectraSession,
    computeEmbedding,
    computeMultilingualEmbedding,
    computeMultilingualEmbeddingsBatch,
    cosineSimilarity,
    dotProduct,
    dotProductInt8,
    getPrecomputedInt8Vector,
    md5,
    SEMANTIC_ASSOCIATIONS: []
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DictionaryRerankerFallback();
  } else {
    global.OnnxReranker = OnnxReranker;
  }

  function DictionaryRerankerFallback() {
    return OnnxReranker;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
