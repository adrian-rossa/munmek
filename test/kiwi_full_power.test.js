import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { KiwiBuilder } from 'kiwi-nlp/dist/kiwi-builder.js';
import KiwiBridge from '../src/nlp/kiwi_bridge.js';
import KoreanPipeline from '../src/nlp/korean_pipeline.js';
import KoreanLemmatizer from '../src/nlp/korean_lemmatizer.js';

describe('Full-Power Kiwi WASM & Structural Deinflection Engine (15 Failure Cases)', () => {
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
      loadMultiDict: true,
      modelType: 'none'
    });
  }, 30000);

  it('1. 악당티가 -> extracts 악당, 티 and ranks them above particle 가', () => {
    const sentence = '이 아이 눈에서 그런 악당티가 난다는 거지?';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '악당티가');
    expect(cands.some(c => c.text === '악당')).toBe(true);
    expect(cands.some(c => c.text === '티')).toBe(true);
    
    const pipelineRes = KoreanPipeline.analyzeKoreanWord('악당티가', sentence, 0);
    expect(pipelineRes.some(c => c.text === '악당')).toBe(true);
    expect(pipelineRes[0].text).not.toBe('가');
  });

  it('2. 난다는 -> extracts base verb 나다', () => {
    const sentence = '이 아이 눈에서 그런 악당티가 난다는 거지?';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '난다는');
    expect(cands.some(c => c.text === '나다')).toBe(true);
    
    const staticDeconj = KoreanLemmatizer.deconjugate('난다는');
    expect(staticDeconj.some(c => c.text === '나다')).toBe(true);
  });

  it('3. 보이네 -> extracts base verb 보이다 (not 보이네다)', () => {
    const sentence = '대낮부터 헛것만 보이네';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '보이네');
    expect(cands.some(c => c.text === '보이다')).toBe(true);
    expect(cands.some(c => c.text === '보이네다')).toBe(false);

    const staticDeconj = KoreanLemmatizer.deconjugate('보이네');
    expect(staticDeconj.some(c => c.text === '보이다')).toBe(true);
    expect(staticDeconj.some(c => c.text === '보이네다')).toBe(false);
  });

  it('4. 가서 -> extracts base verb 가다 (not 가서다)', () => {
    const sentence = '난 집에 가서 좀 쉬어야겠다';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '가서');
    expect(cands.some(c => c.text === '가다')).toBe(true);
    expect(cands.some(c => c.text === '가서다')).toBe(false);

    const staticDeconj = KoreanLemmatizer.deconjugate('가서');
    expect(staticDeconj.some(c => c.text === '가다')).toBe(true);
    expect(staticDeconj.some(c => c.text === '가서다')).toBe(false);
  });

  it('5. 쉬어야겠다 -> extracts base verb 쉬다 and compound intent', () => {
    const sentence = '난 집에 가서 좀 쉬어야겠다';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '쉬어야겠다');
    expect(cands.some(c => c.text === '쉬다')).toBe(true);

    const staticDeconj = KoreanLemmatizer.deconjugate('쉬어야겠다');
    expect(staticDeconj.some(c => c.text === '쉬다')).toBe(true);
  });

  it('6. 데려다줄 -> extracts compound verb 데려다주다 and sub-verb 주다', () => {
    const sentence = '그럼 오빤 다른 괴물이 와서 집에 데려다줄 때까지 기다릴 거야?';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '데려다줄');
    expect(cands.some(c => c.text === '데려다주다')).toBe(true);
    expect(cands.some(c => c.text === '주다' && c.isSubComponent)).toBe(true);
  });

  it('7. 타시는 -> extracts base verb 타다', () => {
    const sentence = '좋아요, 처음 타시는 분들 꽉 잡으세요';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '타시는');
    expect(cands.some(c => c.text === '타다')).toBe(true);

    const staticDeconj = KoreanLemmatizer.deconjugate('타시는');
    expect(staticDeconj.some(c => c.text === '타다')).toBe(true);
  });

  it('8. 감시탑이 -> extracts compound noun 감시탑 and particle 이', () => {
    const sentence = '아! 내 감시탑이…';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '감시탑이');
    expect(cands.some(c => c.text === '감시탑')).toBe(true);
    const topCand = cands.find(c => c.text === '감시탑');
    expect(topCand.posHint).toBe('noun');
  });

  it('9. 멀었어 -> extracts ㄹ-irregular / plain past 멀다', () => {
    const sentence = '아니, 넌 아직 멀었어';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '멀었어');
    expect(cands.some(c => c.text === '멀다')).toBe(true);

    const staticDeconj = KoreanLemmatizer.deconjugate('멀었어');
    expect(staticDeconj.some(c => c.text === '멀다')).toBe(true);
  });

  it('10. 데려다줄게 -> extracts compound verb 데려다주다 and sub-verb 주다', () => {
    const sentence = '아파랑 내가 널 북극으로 데려다줄게';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '데려다줄게');
    expect(cands.some(c => c.text === '데려다주다')).toBe(true);
    expect(cands.some(c => c.text === '주다' && c.isSubComponent)).toBe(true);
  });

  it('11. 있을지도 -> extracts existential verb 있다', () => {
    const sentence = '배에 폭탄이 있을지도 몰라';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '있을지도');
    expect(cands.some(c => c.text === '있다')).toBe(true);

    const staticDeconj = KoreanLemmatizer.deconjugate('있을지도');
    expect(staticDeconj.some(c => c.text === '있다')).toBe(true);
  });

  it('12. 나쁜 -> extracts adjective 나쁘다 (eu-drop irregular)', () => {
    const sentence = '아앙, 돌아가자, 기분 나쁜 곳이야';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '나쁜');
    expect(cands.some(c => c.text === '나쁘다')).toBe(true);

    const staticDeconj = KoreanLemmatizer.deconjugate('나쁜');
    expect(staticDeconj.some(c => c.text === '나쁘다')).toBe(true);
  });

  it('13. 조명탄으로 -> extracts 조명탄, 조명, and 탄 with noun POS', () => {
    const sentence = '조명탄으로 불의 군대에 신호를 보내서';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '조명탄으로');
    expect(cands.some(c => c.text === '조명탄')).toBe(true);
    expect(cands.some(c => c.text === '조명')).toBe(true);
    expect(cands.some(c => c.text === '탄')).toBe(true);
  });

  it('14. Single-token compound verb decomposition: 날아오르다 -> produces 날다 and 오르다', () => {
    const sentence = '새가 하늘로 날아오르다';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '날아오르다');
    expect(cands.some(c => c.text === '날아오르다')).toBe(true);
    expect(cands.some(c => c.text === '날다' && c.isSubComponent)).toBe(true);
    expect(cands.some(c => c.text === '오르다' && c.isSubComponent)).toBe(true);
  });

  it('15. Negative copula VCN: 아니다 -> produces 아니다 (copula)', () => {
    const sentence = '그것은 내 잘못이 아니다';
    const cands = KiwiBridge.analyzeWithKiwi(kiwi, sentence, '아니다');
    expect(cands.some(c => c.text === '아니다' && c.posHint === 'copula')).toBe(true);
  });
});
