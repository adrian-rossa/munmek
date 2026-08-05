/**
 * ONNX Progressive Context Reranker Module
 * Reranks candidate lemmas against sentence context using KoELECTRA INT8 neural model inference.
 */
(function (global) {
  'use strict';

  let onnxSession = null;
  let tokenizerInstance = null;

  async function initOnnxSession() {
    if (onnxSession) return onnxSession;
    if (typeof globalThis.ort === 'undefined') return null;

    try {
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const path = require('path');
        const fs = require('fs');
        const root = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('') : process.cwd();
        const modelPath = path.join(root, 'lib/models/koelectra_small_v3_int8.onnx');
        const vocabPath = path.join(root, 'lib/models/vocab.txt');

        if (fs.existsSync(modelPath) && fs.existsSync(vocabPath)) {
          const modelBuffer = fs.readFileSync(modelPath);
          const vocabText = fs.readFileSync(vocabPath, 'utf-8');
          if (globalThis.WordPieceTokenizer) {
            tokenizerInstance = new globalThis.WordPieceTokenizer(vocabText);
          }
          onnxSession = await globalThis.ort.InferenceSession.create(modelBuffer);
          console.log('[Munmek ONNX] KoELECTRA-small v3 INT8 ONNX Model loaded into ONNXRuntime session!');
          return onnxSession;
        }
      }

      const modelUrl = typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('lib/models/koelectra_small_v3_int8.onnx') : '';
      const vocabUrl = typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL('lib/models/vocab.txt') : '';

      if (!modelUrl || !vocabUrl) return null;

      const [modelRes, vocabRes] = await Promise.all([
        fetch(modelUrl),
        fetch(vocabUrl)
      ]);

      if (modelRes.ok && vocabRes.ok) {
        const modelBuffer = await modelRes.arrayBuffer();
        const vocabText = await vocabRes.text();
        if (globalThis.WordPieceTokenizer) {
          tokenizerInstance = new globalThis.WordPieceTokenizer(vocabText);
        }
        onnxSession = await globalThis.ort.InferenceSession.create(modelBuffer);
        console.log('[Munmek ONNX] KoELECTRA-small v3 INT8 ONNX Model loaded into ONNXRuntime-Web session!');
      }
    } catch (err) {
      console.warn('[Munmek ONNX] Real ONNX model binary not yet loaded, using fallback scorer:', err.message);
    }
    return onnxSession;
  }

  async function computeEmbedding(text, maxLen = 32) {
    const session = await initOnnxSession();
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
      console.warn('[Munmek ONNX] Tensor inference error:', err.message);
      return null;
    }
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

  // Keyword associations for semantic context matching (fallback & heuristic booster)
  const SEMANTIC_ASSOCIATIONS = [
    { target: '듣다', keywords: ['음악', '소리', '말', '라디오', '노래', '강의', '소문', '설교'], boost: 25 },
    { target: '들다', keywords: ['가방', '손', '무게', '짐', '칼', '우산', '비용', '돈', '나이'], boost: 25 },
    { target: '짓다', keywords: ['집', '농사', '밥', '미소', '죄', '시', '글', '이름'], boost: 25 },
    { target: '지다', keywords: ['해', '달', '꽃', '경기', '싸움', '책임', '빚', '짐'], boost: 25 },
    { target: '쓰다', keywords: ['글', '편지', '모자', '안경', '약', '돈', '시간', '마음'], boost: 25 },
    { target: '크다', keywords: ['키', '소리', '키가', '몸', '집', '나무', '사람'], boost: 20 },
    { target: '아프다', keywords: ['머리', '배', '다리', '몸', '마음', '손가락'], boost: 20 },
    { target: '빠르다', keywords: ['차', '속도', '걸음', '발', '시간', '비행기'], boost: 20 },
    { target: '노랗다', keywords: ['색', '노란', '개나리', '바나나', '달걀'], boost: 20 }
  ];

  /**
   * Synchronous fallback context scorer
   */
  function rerankCandidates(candidates, sentenceContext = '') {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return [];
    }

    const sentence = (sentenceContext || '').trim();
    const reranked = candidates.map((cand) => {
      let extraScore = 0;
      let rerankReason = cand.reason || 'candidate';

      if (sentence) {
        for (const assoc of SEMANTIC_ASSOCIATIONS) {
          if (cand.text === assoc.target) {
            const hasKeyword = assoc.keywords.some((kw) => sentence.includes(kw));
            if (hasKeyword) {
              extraScore += assoc.boost;
              rerankReason += ` [Context Boost: +${assoc.boost}]`;
            }
          }
        }
      }

      return {
        ...cand,
        score: (cand.score || 50) + extraScore,
        reason: rerankReason,
        meta: { ...(cand.meta || {}), reranked: true }
      };
    });

    reranked.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    return reranked;
  }

  /**
   * Real KoELECTRA Neural ONNX candidate reranker
   */
  async function rerankCandidatesAsync(candidates, sentenceContext = '') {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const sentence = (sentenceContext || '').trim();
    if (!sentence) return rerankCandidates(candidates, sentenceContext);

    try {
      const contextEmbedding = await computeEmbedding(sentence, 32);
      if (!contextEmbedding) {
        return rerankCandidates(candidates, sentenceContext);
      }

      const scoredList = await Promise.all(
        candidates.map(async (cand) => {
          const candText = `${sentence} [SEP] ${cand.text}`;
          const candEmbedding = await computeEmbedding(candText, 48);
          let onnxScore = candEmbedding ? cosineSimilarity(contextEmbedding, candEmbedding) : 0;
          let boost = Math.round(onnxScore * 30);

          let updatedScore = (cand.score || 50) + boost;
          let updatedReason = (cand.reason || 'candidate') + ` [KoELECTRA Neural Boost: +${boost}]`;

          return {
            ...cand,
            score: updatedScore,
            reason: updatedReason,
            meta: { ...(cand.meta || {}), neuralReranked: true, onnxSimilarity: onnxScore }
          };
        })
      );

      scoredList.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
      return scoredList;
    } catch (err) {
      console.warn('[Munmek ONNX] Neural rerank failed, using fallback:', err);
      return rerankCandidates(candidates, sentenceContext);
    }
  }

  const OnnxReranker = {
    rerankCandidates,
    rerankCandidatesAsync,
    initOnnxSession,
    computeEmbedding,
    cosineSimilarity,
    SEMANTIC_ASSOCIATIONS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OnnxReranker;
  } else {
    global.OnnxReranker = OnnxReranker;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
