/**
 * Korean Jamo (Hangul Alphabet) Decomposition and Composition Utilities
 */
(function (global) {
  'use strict';

  const HANGUL_START = 0xac00;
  const HANGUL_END = 0xd7a3;

  const INITIALS = [
    'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
    'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
  ];

  const VOWELS = [
    'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ',
    'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
  ];

  const FINALS = [
    '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ',
    'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ',
    'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
  ];

  function isHangulSyllable(char) {
    if (!char || char.length !== 1) return false;
    const code = char.charCodeAt(0);
    return code >= HANGUL_START && code <= HANGUL_END;
  }

  function decomposeChar(char) {
    if (!isHangulSyllable(char)) {
      return { initial: char, vowel: '', final: '', original: char, isHangul: false };
    }

    const code = char.charCodeAt(0) - HANGUL_START;
    const initialIndex = Math.floor(code / (21 * 28));
    const vowelIndex = Math.floor((code % (21 * 28)) / 28);
    const finalIndex = code % 28;

    return {
      initial: INITIALS[initialIndex],
      vowel: VOWELS[vowelIndex],
      final: FINALS[finalIndex],
      initialIndex,
      vowelIndex,
      finalIndex,
      original: char,
      isHangul: true
    };
  }

  function composeChar(initial, vowel, final = '') {
    const initialIndex = INITIALS.indexOf(initial);
    const vowelIndex = VOWELS.indexOf(vowel);
    const finalIndex = typeof final === 'number' ? final : FINALS.indexOf(final || '');

    if (initialIndex === -1 || vowelIndex === -1 || finalIndex === -1) {
      return null;
    }

    const code = HANGUL_START + (initialIndex * 21 * 28) + (vowelIndex * 28) + finalIndex;
    return String.fromCharCode(code);
  }

  function hasBatchim(char) {
    if (!isHangulSyllable(char)) return false;
    const code = char.charCodeAt(0) - HANGUL_START;
    return (code % 28) > 0;
  }

  function getBatchim(char) {
    if (!isHangulSyllable(char)) return '';
    const code = char.charCodeAt(0) - HANGUL_START;
    return FINALS[code % 28];
  }

  function setBatchim(char, newFinal) {
    const dec = decomposeChar(char);
    if (!dec.isHangul) return char;
    return composeChar(dec.initial, dec.vowel, newFinal) || char;
  }

  function decomposeText(text) {
    return Array.from(text || '').map(decomposeChar);
  }

  const KoreanJamo = {
    INITIALS,
    VOWELS,
    FINALS,
    isHangulSyllable,
    decomposeChar,
    composeChar,
    hasBatchim,
    getBatchim,
    setBatchim,
    decomposeText
  };

  const targetGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : global);
  targetGlobal.KoreanJamo = KoreanJamo;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = KoreanJamo;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
