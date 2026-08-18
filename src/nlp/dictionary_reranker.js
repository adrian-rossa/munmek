/**
 * Munmek Synchronous Dictionary Reranker
 * Provides initial Frame 1 dictionary hit ordering and baseline tab scoring
 */
(function (global) {
  'use strict';



  /**
   * Frame 1 instant placeholder.
   * Returns a baseline score for the dictionary entry.
   */
  function scoreDictionaryEntry(entry, sentenceContext = '', targetWord = '') {
    const definitions = Array.isArray(entry.definitions) ? entry.definitions : [];
    const defScores = definitions.map(() => 50);
    return { totalScore: 50, bestDefIndex: 0, defScores };
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

  function rerankDictionaryEntries(entries, sentenceContext = '', targetWord = '') {
    if (!Array.isArray(entries) || entries.length === 0) {
      return entries || [];
    }

    const dictGroups = groupEntriesByDict(entries);
    const reordered = [];

    dictGroups.forEach((groupItems) => {
      if (!Array.isArray(groupItems) || groupItems.length === 0) return;

      const scored = groupItems.map((item) => {
        const res = scoreDictionaryEntry(item.entry, sentenceContext, targetWord);
        return {
          ...item,
          totalScore: Number(res.totalScore) || 0,
          bestDefIndex: Number(res.bestDefIndex) || 0,
          defScores: res.defScores || []
        };
      });

      scored.sort((a, b) => b.totalScore - a.totalScore || a.originalIndex - b.originalIndex);

      const topInGroup = scored[0];
      scored.forEach((s, idx) => {
        const isTopMatched = (idx === 0);
        const bestIdx = isTopMatched ? (topInGroup ? topInGroup.bestDefIndex : 0) : 0;
        if (s && s.entry) {
          s.entry._bestDefIndex = bestIdx;
          s.entry._defScores = s.defScores;
          // Note: Heuristic Stage 0 confidence scores (_confidenceScore, _defConfidenceScores, _koelectraMatched) are removed here.
          // They are populated exclusively by Stage 2 neural definition reranking.
          reordered.push(s.entry);
        }
      });
    });

    return reordered;
  }

  const DictionaryReranker = {

    scoreDictionaryEntry,
    rerankDictionaryEntries
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DictionaryReranker;
  } else {
    global.DictionaryReranker = DictionaryReranker;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
