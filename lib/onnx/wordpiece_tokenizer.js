/**
 * WordPiece Tokenizer for KoELECTRA in Browser / Node
 */
(function (global) {
  'use strict';

  class WordPieceTokenizer {
    constructor(vocabText) {
      this.vocab = new Map();
      this.invVocab = new Map();
      if (vocabText) {
        this.loadVocab(vocabText);
      }
    }

    loadVocab(vocabText) {
      const lines = vocabText.split(/\r?\n/);
      lines.forEach((line, index) => {
        const token = line.trim();
        if (token) {
          this.vocab.set(token, index);
          this.invVocab.set(index, token);
        }
      });
      this.unkId = this.vocab.get('[UNK]') ?? 1;
      this.clsId = this.vocab.get('[CLS]') ?? 2;
      this.sepId = this.vocab.get('[SEP]') ?? 3;
      this.padId = this.vocab.get('[PAD]') ?? 0;
    }

    tokenize(text) {
      if (!text) return [];
      const tokens = [];
      const words = text.trim().split(/\s+/);

      for (const word of words) {
        if (word.length === 0) continue;
        let start = 0;
        let subTokens = [];

        while (start < word.length) {
          let end = word.length;
          let curSubToken = null;

          while (start < end) {
            let substr = word.substring(start, end);
            if (start > 0) {
              substr = '##' + substr;
            }
            if (this.vocab.has(substr)) {
              curSubToken = substr;
              break;
            }
            end--;
          }

          if (curSubToken === null) {
            subTokens.push('[UNK]');
            break;
          }

          subTokens.push(curSubToken);
          start = end;
        }

        tokens.push(...subTokens);
      }

      return tokens;
    }

    encode(text, maxLen = 64) {
      const subTokens = this.tokenize(text);
      const inputIds = [this.clsId];

      for (const st of subTokens) {
        if (inputIds.length >= maxLen - 1) break;
        inputIds.push(this.vocab.get(st) ?? this.unkId);
      }
      inputIds.push(this.sepId);

      const attentionMask = new Array(inputIds.length).fill(1);
      while (inputIds.length < maxLen) {
        inputIds.push(this.padId);
        attentionMask.push(0);
      }

      return {
        inputIds: BigInt64Array.from(inputIds.map((v) => BigInt(v))),
        attentionMask: BigInt64Array.from(attentionMask.map((v) => BigInt(v))),
        sequenceLength: maxLen
      };
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WordPieceTokenizer;
  } else {
    global.WordPieceTokenizer = WordPieceTokenizer;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
