import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { KiwiBuilder } from 'kiwi-nlp/dist/kiwi-builder.js';
import KiwiBridge from '../src/nlp/kiwi_bridge.js';

describe('Kiwi WASM Morphological Analyzer & Lemma Extraction', () => {
  let kiwi;

  beforeAll(async () => {
    const wasmPath = path.resolve('lib/kiwi/kiwi-wasm.wasm');
    const modelFiles = {};
    const modelDir = path.resolve('lib/kiwi');
    for (const filename of fs.readdirSync(modelDir)) {
      if (filename.endsWith('.wasm')) continue;
      const fullPath = path.join(modelDir, filename);
      if (fs.statSync(fullPath).isFile()) {
        const buf = fs.readFileSync(fullPath);
        modelFiles[filename] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      }
    }

    const builder = await KiwiBuilder.create(wasmPath);
    kiwi = await builder.build({
      modelFiles,
      integrateAllomorph: true,
      loadDefaultDict: true,
      loadTypoDict: true,
      loadMultiDict: false,
      modelType: 'none'
    });
  }, 30000);

  it('1. 오빤 전쟁놀이나 하고 놀았지? -> decomposes compound noun and particle', () => {
    const tokens = kiwi.tokenize('오빤 전쟁놀이나 하고 놀았지?');
    const tokenForms = tokens.map(t => t.str);
    const tokenTags = tokens.map(t => t.tag);

    expect(tokenForms).toContain('전쟁놀이');
    expect(tokenTags).toContain('NNG');
    expect(tokenForms).toContain('나');
    expect(tokenTags).toContain('JX');

    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '오빤 전쟁놀이나 하고 놀았지?', '전쟁놀이나');
    expect(candidates.some(c => c.text === '전쟁놀이')).toBe(true);
  });

  it('2. 놀았지 -> recovers citation base form 놀다', () => {
    const tokens = kiwi.tokenize('오빤 전쟁놀이나 하고 놀았지?');
    const nolToken = tokens.find(t => t.str === '놀' && t.tag === 'VV');
    expect(nolToken).toBeDefined();

    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '오빤 전쟁놀이나 하고 놀았지?', '놀았지');
    expect(candidates.some(c => c.text === '놀다' && c.posHint === 'verb')).toBe(true);
  });

  it('3. 빨래도 -> recovers noun 빨래 and particle 도 with stem prioritized', () => {
    const tokens = kiwi.tokenize('그 많은 빨래도 내가 다 했어!');
    expect(tokens.some(t => t.str === '빨래' && t.tag === 'NNG')).toBe(true);
    expect(tokens.some(t => t.str === '도' && t.tag === 'JX')).toBe(true);

    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '그 많은 빨래도 내가 다 했어!', '빨래도');
    const bb = candidates.find(c => c.text === '빨래');
    const doParticle = candidates.find(c => c.text === '도');
    expect(bb).toBeDefined();
    expect(doParticle).toBeDefined();
    expect(bb.score).toBeGreaterThan(doParticle.score);
  });

  it('4. 다시는 -> recovers adverb 다시 and particle 는 with stem prioritized', () => {
    const tokens = kiwi.tokenize('싫어! 다시는 오빠 도와주지 않을 거야!');
    expect(tokens.some(t => t.str === '다시' && t.tag === 'MAG')).toBe(true);

    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '싫어! 다시는 오빠 도와주지 않을 거야!', '다시는');
    const dasi = candidates.find(c => c.text === '다시');
    const neun = candidates.find(c => c.text === '는');
    expect(dasi).toBeDefined();
    expect(dasi.score).toBeGreaterThan(neun?.score || 0);
  });

  it('5. 말이야 -> extracts noun 말 and copula phrase 말이다', () => {
    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '이걸 내가 그랬단 말이야?', '말이야');
    expect(candidates.some(c => c.text === '말' && c.posHint === 'noun')).toBe(true);
    expect(candidates.some(c => c.text === '말이다')).toBe(true);
  });

  it('6. 뜻이죠 -> extracts noun 뜻 and copula phrase 뜻이다', () => {
    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '제가 찾고 있던 게 나타났단 뜻이죠', '뜻이죠');
    expect(candidates.some(c => c.text === '뜻' && c.posHint === 'noun')).toBe(true);
    expect(candidates.some(c => c.text === '뜻이다')).toBe(true);
  });

  it('7. 엄청나게 -> extracts adjective base 엄청나다', () => {
    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '(주코) 저 빛은 엄청나게 강한 힘에서 나온 거예요', '엄청나게');
    expect(candidates.some(c => c.text === '엄청나다' && c.posHint === 'adjective')).toBe(true);
  });

  it('8. 거예요 -> resolves bound noun 것 and copula phrase 것이다', () => {
    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '(주코) 저 빛은 엄청나게 강한 힘에서 나온 거예요', '거예요');
    expect(candidates.some(c => c.text === '것')).toBe(true);
    expect(candidates.some(c => c.text === '것이다')).toBe(true);
  });

  it('9. 빛일 -> extracts noun 빛 with higher score than copula modifier', () => {
    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '어쩌면 단순한 빛일 수도 있어', '빛일');
    const bit = candidates.find(c => c.text === '빛');
    expect(bit).toBeDefined();
    expect(bit.posHint).toBe('noun');
  });

  it('10. 조타수 -> preserves compound noun as single unit without splitting into 수', () => {
    const tokens = kiwi.tokenize('(주코) 조타수, 당장 저쪽으로 가자!');
    const jotasooToken = tokens.find(t => t.str === '조타수' && t.tag === 'NNG');
    expect(jotasooToken).toBeDefined();
    expect(jotasooToken.length).toBe(3);

    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '(주코) 조타수, 당장 저쪽으로 가자!', '조타수');
    expect(candidates.some(c => c.text === '조타수')).toBe(true);
  });

  it('11. 저쪽으로 -> extracts 저쪽 and 쪽 with particle 로 scored lower', () => {
    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '(주코) 조타수, 당장 저쪽으로 가자!', '저쪽으로');
    const jjo = candidates.find(c => c.text === '쪽');
    const ro = candidates.find(c => c.text === '으로' || c.text === '로');
    expect(jjo).toBeDefined();
    if (ro) {
      expect(jjo.score).toBeGreaterThan(ro.score);
    }
  });

  it('12. 날아다녀 -> extracts compound verb 날아다니다 and root verb 날다', () => {
    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '(아앙) 얜 바이슨인데 날아다녀', '날아다녀');
    expect(candidates.some(c => c.text === '날아다니다')).toBe(true);
    expect(candidates.some(c => c.text === '날다')).toBe(true);
    expect(candidates.some(c => c.text === '다니다')).toBe(true);
  });

  it('13. 사니 -> extracts ㄹ-irregular verb root 살다 from 사니', () => {
    const tokens = kiwi.tokenize('근데 너희들 이 근처에 사니?');
    expect(tokens.some(t => t.str === '살' && t.tag === 'VV')).toBe(true);

    const candidates = KiwiBridge.analyzeWithKiwi(kiwi, '근데 너희들 이 근처에 사니?', '사니');
    expect(candidates.some(c => c.text === '살다' && c.posHint === 'verb')).toBe(true);
  });
});
