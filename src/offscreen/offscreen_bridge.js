/**
 * Synchronous Offscreen Message Listener Bridge
 * Registers runtime message listener immediately on HTML parse.
 */
(function (global) {
  'use strict';

  console.log('[Munmek Offscreen Bridge] Registering synchronous message listener...');

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request !== 'object') return false;

    if (request.type === 'PING_OFFSCREEN') {
      sendResponse({ ok: true, pong: true });
      return true;
    }

    if (request.type === 'OFFSCREEN_RERANK_DICTIONARY_ENTRIES') {
      (async () => {
        const tOffscreenStart = performance.now();
        const tOffscreenRecv = Date.now();
        try {
          let reranked = request.entries || [];
          if (global.OnnxReranker && typeof global.OnnxReranker.rerankDictionaryEntriesAsync === 'function') {
            reranked = await global.OnnxReranker.rerankDictionaryEntriesAsync(reranked, request.sentenceContext || '', request.word || '');
          } else if (global.OnnxReranker && typeof global.OnnxReranker.rerankDictionaryEntries === 'function') {
            reranked = global.OnnxReranker.rerankDictionaryEntries(reranked, request.sentenceContext || '', request.word || '');
          }
          const tOffscreenEnd = performance.now();
          const offscreenMs = Number((tOffscreenEnd - tOffscreenStart).toFixed(2));
          const timingInfo = (reranked[0] && reranked[0]._timing) ? reranked[0]._timing : {};
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
            activeProvider: timingInfo.activeProvider || 'WASM',
            providerReason: timingInfo.providerReason || ''
          });
        } catch (err) {
          console.warn('[Munmek Offscreen Bridge] Dictionary rerank error:', err);
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    if (request.type === 'OFFSCREEN_RERANK_CANDIDATES') {
      (async () => {
        try {
          let reranked = request.candidates || [];
          if (global.OnnxReranker && typeof global.OnnxReranker.rerankCandidatesAsync === 'function') {
            reranked = await global.OnnxReranker.rerankCandidatesAsync(reranked, request.sentenceContext || '');
          } else if (global.OnnxReranker && typeof global.OnnxReranker.rerankCandidates === 'function') {
            reranked = global.OnnxReranker.rerankCandidates(reranked, request.sentenceContext || '');
          }
          sendResponse({ ok: true, candidates: reranked });
        } catch (err) {
          console.warn('[Munmek Offscreen Bridge] Candidate rerank error:', err);
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    if (request.type === 'OFFSCREEN_ANALYZE_KOREAN') {
      if (typeof global.handleOffscreenAnalyzeKorean === 'function') {
        global.handleOffscreenAnalyzeKorean(request, sendResponse);
        return true;
      }
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
