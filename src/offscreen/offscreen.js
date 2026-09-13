/**
 * Munmek Offscreen Document Controller
 * Hosts Kiwi WASM Morphological Analyzer and Multilingual E5 ONNX Sense Reranker.
 */

async function handleOffscreenAnalyzeKorean(request, sendResponse) {
  try {
    const text = request.text || '';
    const targetWord = request.targetWord || request.word || text;

    if (typeof globalThis.KiwiBridge !== 'undefined' && globalThis.KiwiBridge.initKiwiEngine) {
      const kiwi = await globalThis.KiwiBridge.initKiwiEngine();
      const candidates = globalThis.KiwiBridge.analyzeWithKiwi(kiwi, text, targetWord);
      const tokens = kiwi.tokenize(text) || [];
      sendResponse({ ok: true, engine: 'kiwi', tokens, candidates });
      return;
    }

    throw new Error('Kiwi WASM engine not available');
  } catch (err) {
    console.error('[Munmek Offscreen] Kiwi analysis error:', err);
    sendResponse({ ok: false, error: err.message });
  }
}
globalThis.handleOffscreenAnalyzeKorean = handleOffscreenAnalyzeKorean;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PING_OFFSCREEN') {
    sendResponse({ ok: true, pong: true });
    return true;
  }

  if (request.type === 'OFFSCREEN_ANALYZE_KOREAN' || request.type === 'analyzeKoreanTextWasm' || request.type === 'OFFSCREEN_ANALYZE_KOREAN_KIWI') {
    handleOffscreenAnalyzeKorean(request, sendResponse);
    return true;
  }

  if (request.type === 'OFFSCREEN_RERANK_CANDIDATES') {
    // Kiwi already performs candidate disambiguation statistically; return candidates directly
    sendResponse({ ok: true, candidates: request.candidates || [] });
    return true;
  }

  if (request.type === 'OFFSCREEN_RERANK_DICTIONARY_ENTRIES') {
    (async () => {
      const tOffscreenStart = performance.now();
      const tOffscreenRecv = Date.now();
      try {
        let reranked = request.entries || [];
        if (typeof globalThis.OnnxReranker !== 'undefined' && globalThis.OnnxReranker.rerankDictionaryEntriesAsync) {
          reranked = await globalThis.OnnxReranker.rerankDictionaryEntriesAsync(reranked, request.sentenceContext || '', request.word || '', request.enableWebGpu);
        } else if (typeof globalThis.OnnxReranker !== 'undefined' && globalThis.OnnxReranker.rerankDictionaryEntries) {
          reranked = globalThis.OnnxReranker.rerankDictionaryEntries(reranked, request.sentenceContext || '', request.word || '');
        }
        const tOffscreenEnd = performance.now();
        const offscreenMs = Number((tOffscreenEnd - tOffscreenStart).toFixed(2));
        const timingInfo = reranked[0]?._timing || {};
        sendResponse({
          ok: true,
          entries: reranked,
          offscreenMs,
          t_offscreen_recv: tOffscreenRecv,
          t_offscreen_resp: Date.now(),
          queryMs: timingInfo.queryMs || 0,
          passageMs: timingInfo.passageMs || 0,
          passageCount: timingInfo.passageCount || 0,
          precomputedHits: timingInfo.precomputedHits || 0,
          activeProvider: timingInfo.activeProvider || 'WASM'
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});

// Pre-initialize Kiwi WASM engine on startup
if (typeof globalThis.KiwiBridge !== 'undefined' && globalThis.KiwiBridge.initKiwiEngine) {
  globalThis.KiwiBridge.initKiwiEngine()
    .then(() => console.log('[Munmek Offscreen] Kiwi WASM engine pre-initialized successfully.'))
    .catch((err) => console.warn('[Munmek Offscreen] Kiwi pre-init notice:', err));
}
