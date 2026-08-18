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

  function boundedMapSet(map, key, value, maxSize = 500) {
    if (map.size >= maxSize) {
      const firstKey = map.keys().next().value;
      map.delete(firstKey);
    }
    map.set(key, value);
  }

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
              boundedMapSet(wasmAnalysisCache, surfaceText, response.candidates, 500);
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

    // 4. Subword prefix / compound decomposition (e.g. 매운라면 -> 매운 (맵다) + 라면, 얼음컵 -> 얼음 + 컵)
    if (rawSurface.length >= 2) {
      for (let len = 1; len <= rawSurface.length - 1; len++) {
        const prefix = rawSurface.slice(0, len);
        const suffix = rawSurface.slice(len);

        // Deconjugate prefix modifier (e.g. 매운 -> 맵다, 맛있는 -> 맛있다, 예쁜 -> 예쁘다)
        const prefixLemmas = Lemmatizer.deconjugateVerbAdjective(prefix);
        for (const item of prefixLemmas) {
          if (item.lemma !== prefix) {
            addCandidate(item.lemma, `modifier prefix ${prefix} (${item.rule})`, Math.min(78, item.confidence - 10), { posHint: 'verb/adjective' });
          }
        }

        if (prefix.length >= 1) {
          addCandidate(prefix, `prefix subword (${prefix})`, 75, { posHint: 'noun/stem' });
        }

        if (suffix.length >= 1) {
          addCandidate(suffix, `suffix subword (${suffix})`, 70, { posHint: 'noun/stem' });
          const suffixLemmas = Lemmatizer.deconjugateVerbAdjective(suffix);
          for (const item of suffixLemmas) {
            if (item.lemma !== suffix) {
              addCandidate(item.lemma, `suffix deconjugation ${suffix} (${item.rule})`, Math.min(68, item.confidence - 20), { posHint: 'verb/adjective' });
            }
          }
        }
      }
    }

    // 5. Run external providers if registered (e.g. WASM or ML rerankers)
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

    // 6. Final sorting by score descending, then length
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
