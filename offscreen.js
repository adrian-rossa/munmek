import initGaruWasm, { GaruWasm } from './lib/garu/garu_wasm.js';

let garuInstance = null;
let isInitializing = false;

async function initGaru() {
  if (garuInstance) return garuInstance;
  if (isInitializing) {
    while (!garuInstance) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return garuInstance;
  }

  isInitializing = true;
  try {
    const wasmUrl = chrome.runtime.getURL('lib/garu/garu_wasm_bg.wasm');
    const modelUrl = chrome.runtime.getURL('lib/garu/base.gmdl');

    const [wasmRes, modelRes] = await Promise.all([
      fetch(wasmUrl),
      fetch(modelUrl)
    ]);

    if (!wasmRes.ok || !modelRes.ok) {
      throw new Error(`Failed to fetch Garu assets: WASM HTTP ${wasmRes.status}, Model HTTP ${modelRes.status}`);
    }

    const wasmBytes = await wasmRes.arrayBuffer();
    const modelBytes = new Uint8Array(await modelRes.arrayBuffer());

    await initGaruWasm(wasmBytes);
    garuInstance = new GaruWasm(modelBytes, false);
    console.log('[Munmek Offscreen] Garu-ko WASM morphological analyzer initialized successfully.');
    return garuInstance;
  } catch (err) {
    console.error('[Munmek Offscreen] Garu-ko WASM initialization error:', err);
    isInitializing = false;
    throw err;
  }
}

function mapPosToCategory(pos) {
  if (!pos) return 'other';
  if (pos === 'VV' || pos === 'VX' || pos === 'XSV') return 'verb';
  if (pos === 'VA' || pos === 'XSA') return 'adjective';
  if (pos === 'NNG' || pos === 'NNP' || pos === 'NNB' || pos === 'NP') return 'noun';
  if (pos === 'MAG' || pos === 'MAJ') return 'adverb';
  if (pos.startsWith('JK') || pos === 'JX' || pos === 'JC') return 'particle';
  return 'other';
}

function deriveCandidatesFromTokens(tokens) {
  const candidates = [];
  const addCand = (text, reason, score, posHint) => {
    if (!text || text.length < 1) return;
    if (!candidates.some((c) => c.text === text)) {
      candidates.push({ text, reason, score, posHint });
    }
  };

  for (const token of tokens) {
    const text = token.text;
    const pos = token.pos;
    const cat = mapPosToCategory(pos);

    if (cat === 'verb' || cat === 'adjective') {
      const baseForm = text.endsWith('다') ? text : text + '다';
      addCand(baseForm, `Garu WASM ${pos} stem (${text} -> ${baseForm})`, 95, cat);

      // Handle ㄷ-irregular stems (e.g. stem 들 -> candidate 듣다)
      if (text.endsWith('들')) {
        const digeutForm = text.slice(0, -1) + '듣다';
        addCand(digeutForm, `Garu WASM ㄷ-irregular (${text} -> ${digeutForm})`, 94, cat);
      }
      if (text.endsWith('걸')) {
        const digeutForm = text.slice(0, -1) + '걷다';
        addCand(digeutForm, `Garu WASM ㄷ-irregular (${text} -> ${digeutForm})`, 94, cat);
      }
      if (text.endsWith('물')) {
        const digeutForm = text.slice(0, -1) + '묻다';
        addCand(digeutForm, `Garu WASM ㄷ-irregular (${text} -> ${digeutForm})`, 94, cat);
      }
    } else if (cat === 'noun') {
      addCand(text, `Garu WASM noun (${text})`, 92, 'noun');
    }
  }

  return candidates;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'OFFSCREEN_ANALYZE_KOREAN') {
    (async () => {
      try {
        const engine = await initGaru();
        const rawResult = engine.analyze(request.text || '');
        const tokens = Array.isArray(rawResult?.tokens) ? rawResult.tokens : (Array.isArray(rawResult) ? rawResult : []);
        let candidates = deriveCandidatesFromTokens(tokens);
        if (typeof globalThis.OnnxReranker !== 'undefined' && globalThis.OnnxReranker.rerankCandidates) {
          candidates = globalThis.OnnxReranker.rerankCandidates(candidates, request.text || '');
        }
        sendResponse({ ok: true, tokens, candidates });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.type === 'OFFSCREEN_RERANK_CANDIDATES') {
    (async () => {
      try {
        let reranked = request.candidates || [];
        if (typeof globalThis.OnnxReranker !== 'undefined' && globalThis.OnnxReranker.rerankCandidatesAsync) {
          reranked = await globalThis.OnnxReranker.rerankCandidatesAsync(reranked, request.sentenceContext || '');
        } else if (typeof globalThis.OnnxReranker !== 'undefined' && globalThis.OnnxReranker.rerankCandidates) {
          reranked = globalThis.OnnxReranker.rerankCandidates(reranked, request.sentenceContext || '');
        }
        sendResponse({ ok: true, candidates: reranked });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});

// Pre-initialize WASM engine when offscreen document is opened
initGaru().catch((err) => console.warn('[Munmek Offscreen] Pre-init error:', err));
