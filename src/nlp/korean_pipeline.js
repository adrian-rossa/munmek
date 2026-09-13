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
      const cacheKey = `${surfaceText}__${sentenceContext || ''}`;
      const cached = wasmAnalysisCache.get(cacheKey) || wasmAnalysisCache.get(surfaceText);
      if (cached) {
        return cached;
      }

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && !pendingWasmRequests.has(cacheKey)) {
        pendingWasmRequests.set(cacheKey, true);
        chrome.runtime.sendMessage(
          { type: 'analyzeKoreanTextWasm', text: sentenceContext || surfaceText, targetWord: surfaceText },
          (response) => {
            pendingWasmRequests.delete(cacheKey);
            if (response && response.ok && Array.isArray(response.candidates)) {
              boundedMapSet(wasmAnalysisCache, cacheKey, response.candidates, 500);
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
      if (item.grammar) {
        addCandidate(item.grammar, `grammar ending (${item.grammar})`, 80, { posHint: 'grammar' });
      }
    }

    // 3. Particle stripping (조사 탈락) - stem scores 90, particle scores 75 (stems always beat particles)
    const particleStrips = Lemmatizer.stripParticles(rawSurface);
    for (const p of particleStrips) {
      // Add stem (e.g. 빨래 from 빨래도, 세상 from 세상에서, 다시 from 다시는)
      addCandidate(p.stem, `removed ${p.rule} (${p.particle})`, Math.max(90, p.score), { posHint: 'noun/stem', particle: p.particle });

      // Emit the stripped particle with score 75 (lower than stem, but available as chip)
      addCandidate(p.particle, `particle (${p.particle})`, 75, { posHint: 'particle' });

      // Try de-conjugating the particle-stripped stem
      const stemLemmas = Lemmatizer.deconjugateVerbAdjective(p.stem);
      for (const item of stemLemmas) {
        addCandidate(item.lemma, `${item.rule} after ${p.particle}`, Math.min(88, item.confidence - 5), { posHint: 'verb/adjective' });
        if (item.grammar) {
          addCandidate(item.grammar, `grammar ending (${item.grammar})`, 78, { posHint: 'grammar' });
        }
      }

      // Also decompose compound nouns inside the stripped stem (e.g. 악당티 -> 악당 + 티, 감시탑 -> 감시 + 탑)
      if (p.stem && p.stem.length >= 2 && p.stem !== rawSurface) {
        for (let len = 1; len <= p.stem.length - 1; len++) {
          const stemPfx = p.stem.slice(0, len);
          const stemSfx = p.stem.slice(len);
          if (stemPfx.length >= 2) {
            addCandidate(stemPfx, `stem prefix subword (${stemPfx})`, 78, { posHint: 'noun' });
          }
          if (stemSfx.length >= 1) {
            addCandidate(stemSfx, `stem suffix subword (${stemSfx})`, 76, { posHint: 'noun' });
          }
        }
      }
    }

    // 4. Subword prefix / compound decomposition (e.g. 매운라면 -> 매운 (맵다) + 라면, 얼음컵 -> 얼음 + 컵)
    const modifierMatch = rawSurface.match(/^([가-힣]{1,10})(하는|되는|시키는|있는|없는|않는)$/);
    if (modifierMatch) {
      const rootNoun = modifierMatch[1];
      const modEnding = modifierMatch[2];
      if (rootNoun.length >= 1) {
        addCandidate(rootNoun, `root noun before -${modEnding}`, 90, { posHint: 'noun' });
        addCandidate(modEnding, `modifier ending (-${modEnding})`, 80, { posHint: 'grammar' });
      }
    } else if (rawSurface.length >= 2) {
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

        // Subword noun candidates (require length >= 2 for prefix to avoid spurious single Jamo/characters like '지')
        if (prefix.length >= 2) {
          addCandidate(prefix, `prefix subword (${prefix})`, 75, { posHint: 'noun/stem' });
        }

        if (suffix.length >= 2 || (rawSurface.length <= 3 && suffix.length >= 1)) {
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

    // 6. Final sorting by score descending, then longer length first (content words beat single-character particles on tie)
    candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
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
