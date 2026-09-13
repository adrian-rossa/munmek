import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { KiwiBuilder } from 'kiwi-nlp/dist/kiwi-builder.js';
import KiwiBridge from '../src/nlp/kiwi_bridge.js';
import KoreanPipeline from '../src/nlp/korean_pipeline.js';

describe('End-to-End Extension Lookup & Kiwi Deinflection Integration', () => {
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

  it('verifies that Kiwi analyzer extracts the correct dictionary form for lookup', () => {
    // 1. Hover lookup for '사니' in '근데 너희들 이 근처에 사니?'
    const kiwiCandidates = KiwiBridge.analyzeWithKiwi(kiwi, '근데 너희들 이 근처에 사니?', '사니');
    const topVerb = kiwiCandidates.find(c => c.posHint === 'verb');
    expect(topVerb).toBeDefined();
    expect(topVerb.text).toBe('살다');
    expect(topVerb.score).toBeGreaterThanOrEqual(90);

    // 2. Hover lookup for '놀았지' in '오빤 전쟁놀이나 하고 놀았지?'
    const kiwiCandidates2 = KiwiBridge.analyzeWithKiwi(kiwi, '오빤 전쟁놀이나 하고 놀았지?', '놀았지');
    const topVerb2 = kiwiCandidates2.find(c => c.posHint === 'verb');
    expect(topVerb2).toBeDefined();
    expect(topVerb2.text).toBe('놀다');

    // 3. Hover lookup for '날아다녀' in '(아앙) 얜 바이슨인데 날아다녀'
    const kiwiCandidates3 = KiwiBridge.analyzeWithKiwi(kiwi, '(아앙) 얜 바이슨인데 날아다녀', '날아다녀');
    expect(kiwiCandidates3.some(c => c.text === '날아다니다')).toBe(true);
    expect(kiwiCandidates3.some(c => c.text === '날다')).toBe(true);

    // 4. Hover lookup for '조타수' in '(주코) 조타수, 당장 저쪽으로 가자!'
    const kiwiCandidates4 = KiwiBridge.analyzeWithKiwi(kiwi, '(주코) 조타수, 당장 저쪽으로 가자!', '조타수');
    expect(kiwiCandidates4.some(c => c.text === '조타수' && c.posHint === 'noun')).toBe(true);
  });

  it('verifies candidate pipeline registers and prioritizes Kiwi candidates over particles', () => {
    // Register a mock provider simulating Kiwi WASM response
    KoreanPipeline.registerProvider((surface, sentence) => {
      return KiwiBridge.analyzeWithKiwi(kiwi, sentence, surface);
    });

    const results = KoreanPipeline.analyzeKoreanWord('빨래도', '그 많은 빨래도 내가 다 했어!');
    const bbal = results.find(r => r.text === '빨래');
    const doParticle = results.find(r => r.text === '도');

    expect(bbal).toBeDefined();
    expect(doParticle).toBeDefined();
    expect(bbal.score).toBeGreaterThan(doParticle.score);
  });
});
