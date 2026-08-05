/**
 * Korean Morphological Segmenter & Lemmatizer Pipeline
 * Coordinates candidate generation, confidence scoring, POS estimation, and pluggable external providers.
 */
(function (global) {
  'use strict';

  const Jamo = typeof module !== 'undefined' && module.exports ? require('./korean_jamo') : global.KoreanJamo;
  const Lemmatizer = typeof module !== 'undefined' && module.exports ? require('./korean_lemmatizer') : global.KoreanLemmatizer;

  const externalProviders = [];
  const wasmAnalysisCache = new Map();
  const pendingWasmRequests = new Map();

  function registerProvider(providerFn) {
    if (typeof providerFn === 'function' && !externalProviders.includes(providerFn)) {
      externalProviders.push(providerFn);
    }
  }

  function registerWasmCacheProvider() {
    registerProvider((surfaceText, sentenceContext) => {
      const cached = wasmAnalysisCache.get(surfaceText);
      if (cached) {
        return cached;
      }

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && !pendingWasmRequests.has(surfaceText)) {
        pendingWasmRequests.set(surfaceText, true);
        chrome.runtime.sendMessage(
          { type: 'analyzeKoreanTextWasm', text: surfaceText },
          (response) => {
            pendingWasmRequests.delete(surfaceText);
            if (response && response.ok && Array.isArray(response.candidates)) {
              wasmAnalysisCache.set(surfaceText, response.candidates);
              if (typeof window !== 'undefined' && window.dispatchEvent) {
                window.dispatchEvent(new CustomEvent('munmekWasmAnalysisReady', { detail: { surfaceText } }));
              }
            }
          }
        );
      }

      return [];
    });
  }

  if (typeof window !== 'undefined') {
    registerWasmCacheProvider();
  }

  function analyzeKoreanWord(surfaceText, sentenceContext = '') {
    const rawSurface = (surfaceText || '').trim();
    if (!rawSurface) return [];

    const candidates = [];
    const addCandidate = (text, reason, score, meta = {}) => {
      const normalized = (text || '').trim();
      if (!normalized) return;

      const existingIndex = candidates.findIndex(c => c.text === normalized);
      if (existingIndex !== -1) {
        if (score > candidates[existingIndex].score) {
          candidates[existingIndex].score = score;
          candidates[existingIndex].reason = reason;
          candidates[existingIndex].meta = { ...candidates[existingIndex].meta, ...meta };
        }
        return;
      }

      candidates.push({
        text: normalized,
        reason,
        score,
        posHint: meta.posHint || guessPos(normalized, meta),
        meta
      });
    };

    // 1. Surface form as top priority candidate
    addCandidate(rawSurface, 'surface form', 100, { posHint: 'surface' });

    // 2. Direct verbal / adjectival de-conjugation
    const directLemmas = Lemmatizer.deconjugateVerbAdjective(rawSurface);
    for (const item of directLemmas) {
      addCandidate(item.lemma, item.rule, item.confidence, { posHint: 'verb/adjective', rule: item.rule });
    }

    // 3. Particle stripping (조사 탈락)
    const particleStrips = Lemmatizer.stripParticles(rawSurface);
    for (const p of particleStrips) {
      addCandidate(p.stem, `removed ${p.rule} (${p.particle})`, p.score, { posHint: 'noun/stem', particle: p.particle });

      // Try de-conjugating the particle-stripped stem
      const stemLemmas = Lemmatizer.deconjugateVerbAdjective(p.stem);
      for (const item of stemLemmas) {
        addCandidate(item.lemma, `${item.rule} after ${p.particle}`, Math.min(p.score, item.confidence - 5), { posHint: 'verb/adjective' });
      }
    }

    // 4. Run external providers if registered (e.g. WASM or ML rerankers)
    for (const provider of externalProviders) {
      try {
        const externalHits = provider(rawSurface, sentenceContext) || [];
        for (const hit of externalHits) {
          if (hit && hit.text) {
            addCandidate(hit.text, hit.reason || 'external analyzer', hit.score || 80, hit.meta || {});
          }
        }
      } catch (err) {
        console.warn('KoreanPipeline external provider error:', err);
      }
    }

    // 5. Final sorting by score descending, then length
    candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    return candidates;
  }

  function guessPos(word, meta = {}) {
    if (meta.posHint) return meta.posHint;
    if (word.endsWith('다')) return 'verb/adjective';
    if (word.endsWith('하다')) return 'verb';
    if (word.endsWith('롭다') || word.endsWith('스럽다')) return 'adjective';
    return 'noun/other';
  }

  const KoreanPipeline = {
    analyzeKoreanWord,
    registerProvider,
    Jamo,
    Lemmatizer
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = KoreanPipeline;
  } else {
    global.KoreanPipeline = KoreanPipeline;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
