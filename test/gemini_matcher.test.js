import { describe, it, expect } from 'vitest';

function autoSelectBestDefinitionFromGemini(state, analysisData) {
  if (!state || !analysisData || !Array.isArray(state.dictionaryEntries) || state.dictionaryEntries.length === 0) return;

  const textFragments = [];
  let geminiPos = '';
  let geminiBase = '';

  if (typeof analysisData === 'object') {
    if (analysisData.translation) textFragments.push(String(analysisData.translation));
    if (analysisData.definition) textFragments.push(String(analysisData.definition));
    if (analysisData.notes) textFragments.push(String(analysisData.notes));
    if (analysisData.grammar) textFragments.push(String(analysisData.grammar));

    Object.keys(analysisData).forEach((k) => {
      const v = analysisData[k];
      if (v && typeof v === 'string') textFragments.push(v);
    });

    const wordsAnalysis = Array.isArray(analysisData.words_analysis)
      ? analysisData.words_analysis
      : (Array.isArray(analysisData.words) ? analysisData.words : (Array.isArray(analysisData.analysis) ? analysisData.analysis : null));

    if (Array.isArray(wordsAnalysis) && wordsAnalysis.length > 0) {
      const cleanW = (state.word || '').normalize().trim().replace(/(은|는|이|가|을|를|의|에|에서|와|과|도|만|으로|로)$/, '');
      const targetItem = wordsAnalysis.find((item) => {
        const s = (item.surface || item.word || '').normalize().trim().replace(/(은|는|이|가|을|를|의|에|에서|와|과|도|만|으로|로)$/, '');
        const b = (item.base || '').normalize().trim();
        return (s && (s === cleanW || cleanW.startsWith(s))) || (b && b === cleanW);
      }) || wordsAnalysis[0];

      if (targetItem) {
        if (targetItem.pos) geminiPos = String(targetItem.pos).toLowerCase();
        if (targetItem.base) geminiBase = (targetItem.base || '').normalize().trim();
        if (Array.isArray(targetItem.definitions)) textFragments.push(...targetItem.definitions.map(String));
        if (targetItem.definition) textFragments.push(String(targetItem.definition));
        if (targetItem.notes) textFragments.push(String(targetItem.notes));
        if (targetItem.grammar_notes) textFragments.push(String(targetItem.grammar_notes));
        Object.keys(targetItem).forEach((k) => {
          const v = targetItem[k];
          if (v && typeof v === 'string') textFragments.push(v);
        });
      }
    }
  }

  const geminiFullText = textFragments.join(' ').toLowerCase();
  if (!geminiFullText.trim()) return;

  const extractTokens = (str) => {
    return (String(str || '').toLowerCase().match(/[a-zA-Z0-9\u00C0-\u024F\u3040-\u30ff\u4e00-\u9faf\uac00-\ud7a3]{2,}/g) || []);
  };

  const geminiTokens = new Set(extractTokens(geminiFullText));

  let bestScore = -1;
  let bestItemIndex = 0;
  let bestDefIndex = 0;

  state.dictionaryEntries.forEach((item, itemIdx) => {
    const itemPos = String(item.pos || '').toLowerCase();
    const itemBase = (item.base || item.surface || '').normalize().trim();
    const rawDefs = Array.isArray(item.definitions) ? item.definitions : [];

    let posBonus = 0;
    if (geminiPos && itemPos) {
      if (itemPos.includes(geminiPos) || geminiPos.includes(itemPos)) posBonus += 4;
    }

    let baseBonus = 0;
    if (geminiBase && itemBase) {
      if (geminiBase === itemBase) baseBonus += 5;
    }

    rawDefs.forEach((defText, defIdx) => {
      const tokens = extractTokens(defText);
      let tokenScore = 0;
      tokens.forEach((t) => {
        if (geminiTokens.has(t) || geminiFullText.includes(t)) tokenScore += t.length >= 4 ? 2 : 1;
      });

      const totalScore = tokenScore + posBonus + baseBonus;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestItemIndex = itemIdx;
        bestDefIndex = defIdx;
      }
    });
  });

  if (bestScore > 0) {
    state.geminiMatchedItemIndex = bestItemIndex;
    state.geminiMatchedDefIndex = bestDefIndex;
    state[`selectedDefIndex_${bestItemIndex}`] = bestDefIndex;
    state.selectedDefinitionIndex = bestDefIndex;
  }
}

describe('Gemini Definition Auto-Matcher', () => {
  it('automatically selects the definition tab that best matches Gemini analysis in English', () => {
    const state = {
      word: '들어요',
      dictionaryEntries: [
        {
          surface: '들어요',
          definitions: [
            '1. to hold; to carry (something in hands)',
            '2. to listen; to hear (a sound or song)',
            '3. to enter; to join (a group)'
          ]
        }
      ]
    };

    const analysisData = {
      words_analysis: [
        {
          surface: '들어요',
          base: '듣다',
          definitions: ['to listen to music or hear a voice']
        }
      ]
    };

    autoSelectBestDefinitionFromGemini(state, analysisData);

    expect(state.geminiMatchedItemIndex).toBe(0);
    expect(state.geminiMatchedDefIndex).toBe(1);
  });

  it('correctly scopes match to a single homonym card among multiple entries (e.g. 제)', () => {
    const state = {
      word: '제',
      dictionaryEntries: [
        { surface: '제', pos: 'affix', definitions: ['-je A suffix used to mean a system or a method.'] },
        { surface: '제', pos: 'pronoun', base: '저', definitions: ['je An abbreviated word for 저의, my'] },
        { surface: '제', pos: 'bound noun', definitions: ['je unit for medicine'] }
      ]
    };

    const analysisData = {
      words_analysis: [
        {
          surface: '제',
          base: '저',
          pos: 'pronoun',
          definitions: ['my (humble form)']
        }
      ]
    };

    autoSelectBestDefinitionFromGemini(state, analysisData);

    // Entry index 1 is the pronoun "my", not 0 or 2!
    expect(state.geminiMatchedItemIndex).toBe(1);
    expect(state.geminiMatchedDefIndex).toBe(0);
  });
});
