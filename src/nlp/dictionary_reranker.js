/**
 * Munmek Dictionary Definition & Sense Tab Reranker Module
 * Reranks dictionary entries and preselects specific definition tabs (Def 1..N) based on sentence context.
 */
(function (global) {
  'use strict';

  const HOMONYM_SENSE_ASSOCIATIONS = [
    {
      word: '눈',
      senses: [
        { senseKey: 'snow', keywords: ['하늘', '내리', '내려', '내림', '내린', '내려와', '싸락눈', '함박눈', '겨울', '하얀', '흰', '얼음', '결정', '날씨', '차갑다', 'snow', 'ice', 'atmosphere', 'frozen', 'fall', 'falling', 'winter', '雪', 'ゆき', '空', '降る', '降', '氷', '結晶', '冬', '白い'], boost: 50 },
        { senseKey: 'eye', keywords: ['얼굴', '안구', '보이다', '보다', '시력', '눈물', '눈빛', '시선', '눈동자', '안과', '아프', '아파', '통증', '감다', '뜨다', '몸', 'eye', 'seeing', 'organ', 'sight', 'gaze', 'vision', 'facially', '目', '眼', 'め', '顔', '見る', '視力', '眼科', '痛', '視線'], boost: 50 },
        { senseKey: 'bud', keywords: ['꽃', '잎', '가지', '줄기', '식물', '싹', 'bud', 'sprout', 'flower', 'leaf', 'plant', 'branch', 'stem', '芽', 'め', '花', '葉', '枝', '茎', '植物'], boost: 40 },
        { senseKey: 'mesh', keywords: ['그물', '줄', '망', 'mesh', 'net', 'string', 'woven', '網', '網目', 'あみ', '糸'], boost: 40 },
        { senseKey: 'calibration', keywords: ['자', '온도계', '저울', '눈금', 'gradation', 'calibration', 'ruler', 'thermometer', 'scale', '目盛り', '目盛', '定規', '温度計'], boost: 40 }
      ]
    },
    {
      word: '밤',
      senses: [
        { senseKey: 'night', keywords: ['낮', '어둡', '어두운', '하늘', '달', '별', '자다', '자러', '저녁', 'night', 'dark', 'evening', 'moon', 'sleep', '夜', 'よる', '晩', '暗い', '月', '星', '寝る'], boost: 50 },
        { senseKey: 'chestnut', keywords: ['나무', '열매', '먹다', '먹어', '껍질', '군밤', 'chestnut', 'nut', 'tree', 'fruit', 'eat', '栗', 'くり', '木', '実', '食べる'], boost: 50 }
      ]
    },
    {
      word: '배',
      senses: [
        { senseKey: 'pear', keywords: ['과일', '달다', '달콤', '나무', '먹다', '맛있', 'pear', 'fruit', 'sweet', 'tree', 'eat', '梨', 'なし', '果物', '甘い', '木', '食べる'], boost: 50 },
        { senseKey: 'boat', keywords: ['바다', '강', '물', '항구', '선장', '타고', '타다', '항해', 'ship', 'boat', 'vessel', 'sea', 'river', 'water', 'sail', '船', '舟', 'ふね', '海', '川', '港', '乗る'], boost: 50 },
        { senseKey: 'belly', keywords: ['몸', '배고프', '배부르', '아프', '소화', 'belly', 'stomach', 'abdomen', 'body', 'hungry', '腹', 'お腹', 'はら', '体', '胃', '痛い'], boost: 50 },
        { senseKey: 'times', keywords: ['곱하기', '수', '증가', 'times', 'fold', 'double', 'triple', 'multiplication', '倍', 'ばい'], boost: 40 }
      ]
    },
    {
      word: '차',
      senses: [
        { senseKey: 'car', keywords: ['운전', '도로', '타고', '타다', '길', '바퀴', '속도', 'car', 'vehicle', 'automobile', 'drive', 'road', '車', '自動車', 'くるま', '運転', '道路', '乗る'], boost: 50 },
        { senseKey: 'tea', keywords: ['마시다', '마셔', '녹차', '홍차', '따뜻', '잔', 'tea', 'drink', 'beverage', 'cup', 'hot', '茶', 'お茶', 'ちゃ', '飲む', '緑茶', '紅茶'], boost: 50 }
      ]
    },
    {
      word: '말',
      senses: [
        { senseKey: 'word', keywords: ['하다', '해요', '언어', '이야기', '대화', '목소리', '듣다', '들어', 'word', 'speech', 'language', 'talk', 'speak', 'say', '言葉', 'ことば', '話', '言語', '話す', '言う'], boost: 50 },
        { senseKey: 'horse', keywords: ['타다', '타고', '동물', '달리다', '달려', '마구간', 'horse', 'animal', 'ride', 'gallop', '馬', 'うま', '動物', '乗る', '走る'], boost: 50 }
      ]
    },
    {
      word: '다리',
      senses: [
        { senseKey: 'leg', keywords: ['몸', '걷다', '걸어', '무릎', '발', '아프', 'leg', 'body', 'walk', 'foot', 'knee', '脚', '足', 'あし', '体', '歩く', '膝'], boost: 50 },
        { senseKey: 'bridge', keywords: ['강', '건너', '건너다', '길', '연결', 'bridge', 'river', 'cross', 'connect', '橋', 'はし', '川', '渡る', 'つなぐ'], boost: 50 }
      ]
    },
    {
      word: '사과',
      senses: [
        { senseKey: 'apple', keywords: ['과일', '빨갛', '빨간', '달다', '나무', '먹다', 'apple', 'fruit', 'red', 'tree', 'eat', 'りん고', '林檎', '果物', '赤い', '食べる'], boost: 50 },
        { senseKey: 'apology', keywords: ['용서', '죄송', '미안', '하다', '해요', '말', 'apology', 'apologize', 'sorry', 'forgive', '謝罪', '謝る', 'わび', 'すまない', 'ごめんなさい'], boost: 50 }
      ]
    },
    {
      word: '풀',
      senses: [
        { senseKey: 'grass', keywords: ['나무', '꽃', '들', '산', '자라다', '녹색', 'grass', 'plant', 'herb', 'weed', 'green', '草', 'くさ'], boost: 50 },
        { senseKey: 'glue', keywords: ['붙이다', '종이', '붙이', '접착', 'glue', 'paste', 'adhesive', '糊', 'のり'], boost: 50 }
      ]
    },
    {
      word: '손',
      senses: [
        { senseKey: 'hand', keywords: ['몸', '손가락', '잡다', '씻다', '얼굴', 'hand', 'arm', 'finger', 'hold', 'wash', '手', 'て'], boost: 50 },
        { senseKey: 'guest', keywords: ['손님', '오다', '방문', '맞다', 'guest', 'visitor', 'customer', '客', 'きゃく'], boost: 50 }
      ]
    },
    {
      word: '집',
      senses: [
        { senseKey: 'house', keywords: ['방', '살다', '건물', '가족', '고향', 'house', 'home', 'building', 'live', 'dwelling', '家', 'うち', '住む'], boost: 50 },
        { senseKey: 'collection', keywords: ['시집', '화집', '문집', '책', 'collection', 'anthology', 'volume', '集', 'しゅう'], boost: 40 }
      ]
    },
    {
      word: '키',
      senses: [
        { senseKey: 'height', keywords: ['크다', '작다', '몸', '사람', 'cm', 'height', 'stature', 'tall', 'short', '背', '身長'], boost: 50 },
        { senseKey: 'key', keywords: ['문', '열쇠', '열다', '자물쇠', 'key', 'lock', 'open', '鍵', 'かぎ'], boost: 50 }
      ]
    },
    {
      word: '줄',
      senses: [
        { senseKey: 'line/rope', keywords: ['묶다', '길다', '서다', '줄서다', 'rope', 'string', 'line', 'cord', 'queue', '縄', '紐', '列'], boost: 50 },
        { senseKey: 'way/know-how', keywords: ['알다', '모르다', '할 줄', 'way', 'method', 'how to', 'know-how', '術', 'やり方'], boost: 40 }
      ]
    },
    {
      word: '점',
      senses: [
        { senseKey: 'mole/spot', keywords: ['얼굴', '피부', '검은', 'spot', 'mole', 'mark', 'dot', 'ほくろ', '斑点'], boost: 50 },
        { senseKey: 'point/score', keywords: ['시험', '맞다', '점수', '100점', 'point', 'score', 'mark', 'grade', '点', '点数'], boost: 50 },
        { senseKey: 'store', keywords: ['매장', '가게', '식당', '백화점', 'store', 'shop', 'branch', '店', '店舗'], boost: 40 }
      ]
    },
    {
      word: '부르다',
      senses: [
        { senseKey: 'sing', keywords: ['노래', '곡', '가사', '음악', '가수', '찬송가', 'sing', 'song', 'tune', 'melody', '歌', '歌う', '曲'], boost: 50 },
        { senseKey: 'call', keywords: ['이름', '친구', '사람', '선생님', '경찰', '택시', '의사', '소리쳐', '부름', '라고', '이라고', '라', '이라', '명칭', '칭하다', '말', '언어', '한국어', '조선말', 'call', 'name', 'shout', 'invite', 'refer', 'term', '呼ぶ', '名前', '称하는', '称する'], boost: 50 },
        { senseKey: 'full', keywords: ['배', '배가', '밥', '음식', '먹다', '먹어', '포만감', 'full', 'stomach', 'eat', 'food', 'お腹', '満腹'], boost: 50 },
        { senseKey: 'dictate', keywords: ['글', '받아쓰기', 'dictate', 'read', '書き取り'], boost: 40 },
        { senseKey: 'quote', keywords: ['값', '가격', '돈', 'price', 'quote', 'cost', '値段'], boost: 40 }
      ]
    },
    {
      word: '쓰다',
      senses: [
        { senseKey: 'write', keywords: ['글', '편지', '책', '시', '소설', '문장', '기록', 'write', 'letter', 'book', 'poem', '書く', '手紙'], boost: 50 },
        { senseKey: 'wear', keywords: ['모자', '안경', '마스크', '우산', 'wear', 'hat', 'glasses', 'mask', 'かぶる', '眼鏡', '帽子'], boost: 50 },
        { senseKey: 'use', keywords: ['돈', '시간', '에너지', '힘', '마음', '도구', '컴퓨터', 'use', 'spend', 'money', 'time', '使う', '金'], boost: 50 },
        { senseKey: 'bitter', keywords: ['약', '맛', '입', '입맛', 'bitter', 'taste', 'medicine', '苦い', '薬'], boost: 50 }
      ]
    },
    {
      word: '지다',
      senses: [
        { senseKey: 'lose', keywords: ['경기', '싸움', '시합', '게임', '패배', 'lose', 'defeat', 'game', 'match', '負ける'], boost: 50 },
        { senseKey: 'set', keywords: ['해', '달', '태양', '서쪽', 'set', 'sun', 'moon', 'sunset', '沈む', '日'], boost: 50 },
        { senseKey: 'carry', keywords: ['짐', '책임', '빚', '가방', 'carry', 'bear', 'burden', 'debt', '背負う'], boost: 50 }
      ]
    },
    {
      word: '차다',
      senses: [
        { senseKey: 'kick', keywords: ['공', '발', '축구', 'kick', 'ball', 'foot', 'soccer', '蹴る'], boost: 50 },
        { senseKey: 'cold', keywords: ['손', '발', '공기', '바람', '물', 'cold', 'chilly', '冷たい'], boost: 50 },
        { senseKey: 'full', keywords: ['가득', '차오르다', '물이', 'full', 'filled', '満ちる'], boost: 50 },
        { senseKey: 'wear', keywords: ['시계', '수갑', 'wear', 'watch', 'handcuffs', 'つける'], boost: 50 }
      ]
    },
    {
      word: '나다',
      senses: [
        { senseKey: 'happen', keywords: ['사고', '불', '소리', '생각', 'happen', 'occur', 'arise', '起こる'], boost: 50 },
        { senseKey: 'grow', keywords: ['털', '수염', '싹', '풀', 'grow', 'sprout', '生える'], boost: 50 },
        { senseKey: 'smell/taste', keywords: ['냄새', '맛', '향', 'smell', 'taste', 'scent', '匂이', '味'], boost: 50 }
      ]
    },
    {
      word: '들다',
      senses: [
        { senseKey: 'hold/carry', keywords: ['가방', '손', '무게', '짐', '칼', '우산', 'hold', 'carry', 'lift', '持つ'], boost: 50 },
        { senseKey: 'listen', keywords: ['음악', '소리', '말', '라디오', '노래', '강의', 'listen', 'hear', '聞く'], boost: 50 },
        { senseKey: 'enter', keywords: ['동아리', '모임', '방', 'enter', 'join', '入る'], boost: 40 }
      ]
    },
    {
      word: '가설',
      senses: [
        { senseKey: 'hypothesis', keywords: ['알타이', '어족', '이론', '주류', '학설', '학회', '연구', '검증', '학자', '분류', 'hypothesis', 'theory', 'proposition', 'idea', '仮説'], boost: 50 },
        { senseKey: 'construction', keywords: ['다리', '도로', '전선', '설치', '공사', '건설', 'construction', 'installation', 'building', '架設'], boost: 50 },
        { senseKey: 'makeshift', keywords: ['임시', '건물', '천막', 'makeshift', 'temporary', '假設'], boost: 40 }
      ]
    }
  ];

  const VOCAB_DOMAIN_MAP = {
    '노래': ['sing', 'song', 'tune', 'melody', 'lyric', '歌', '歌う'],
    '곡': ['song', 'music', 'tune', 'track', '曲'],
    '가사': ['lyric', 'words', 'song'],
    '음악': ['music', 'song', 'musical', '音楽'],
    '가수': ['singer', 'vocalist', '歌手'],
    '목소리': ['voice', 'vocal', 'sound', 'call', '声'],
    '소리': ['sound', 'voice', 'noise', 'call', '音', '声'],
    '이름': ['name', 'call', 'title', '名前'],
    '호칭': ['title', 'name', 'call'],
    '명칭': ['title', 'name', 'call', 'term', '名前'],
    '라고': ['call', 'name', 'refer', 'term', '呼ぶ', '名前'],
    '이라고': ['call', 'name', 'refer', 'term', '呼ぶ', '名前'],
    '한국어': ['korean', 'language', 'call', 'name', '韓国語'],
    '조선말': ['korean', 'language', 'call', 'name'],
    '말': ['word', 'language', 'call', 'speech', '言葉'],
    '사람': ['person', 'someone', 'human', 'people', '인물', '人'],
    '타인': ['others', 'person', 'someone'],
    '친구': ['friend', 'pal', 'companion', '友達'],
    '경찰': ['police', 'cop', 'officer', '警察'],
    '택시': ['taxi', 'cab'],
    '의사': ['doctor', 'physician', '메디컬', '医師'],
    '배': ['stomach', 'belly', 'abdomen', 'full', 'boat', 'pear', 'お腹'],
    '밥': ['food', 'meal', 'rice', 'eat', 'full', 'ご飯', '食事'],
    '음식': ['food', 'dish', 'meal', 'eat', '食べ物'],
    '먹다': ['eat', 'food', 'meal', 'consume', '食べる'],
    '포만감': ['full', 'stomach', 'stuffed', '満腹'],
    '가격': ['price', 'cost', 'quote', 'value', '値段'],
    '값': ['price', 'cost', 'quote', 'value'],
    '돈': ['money', 'price', 'pay', 'cost', '金'],
    '글': ['write', 'text', 'letter', 'read', 'dictate', '文章', '書く'],
    '편지': ['letter', 'mail', 'write', '手紙'],
    '모자': ['hat', 'cap', 'wear', '帽子'],
    '안경': ['glasses', 'spectacles', 'wear', '眼鏡'],
    '약': ['medicine', 'drug', 'bitter', '薬'],
    '맛': ['taste', 'flavor', 'bitter', 'sweet', '味'],
    '경기': ['game', 'match', 'play', 'lose', 'win', '試合'],
    '해': ['sun', 'day', 'set', 'rise', '日', '太陽'],
    '달': ['moon', 'month', 'night', 'set', '月'],
    '공': ['ball', 'kick', 'soccer', '球'],
    '축구': ['soccer', 'football', 'kick', 'サッカー'],
    '바람': ['wind', 'chilly', 'cold', 'breeze', '風'],
    '사고': ['accident', 'happen', 'occur', 'incident', '事故'],
    '불': ['fire', 'happen', 'occur', 'burn', '火'],
    '털': ['hair', 'fur', 'grow', 'sprout', '毛'],
    '가방': ['bag', 'pack', 'hold', 'carry', '鞄'],
    '짐': ['pack', 'baggage', 'load', 'carry', 'burden', '荷物'],
    '하늘': ['sky', 'air', 'atmosphere', 'fall', 'snow', 'rain', '空'],
    '내리다': ['fall', 'drop', 'snow', 'rain', '降る'],
    '내려': ['fall', 'drop', 'snow', 'rain', '降る'],
    '겨울': ['winter', 'cold', 'snow', '冬'],
    '얼음': ['ice', 'frozen', 'snow', '氷'],
    '바다': ['sea', 'ocean', 'water', 'boat', 'ship', '海'],
    '강': ['river', 'stream', 'water', 'boat', 'bridge', '川'],
    '물': ['water', 'river', 'sea', 'liquid', 'boat', 'cold', '水'],
    '운전': ['drive', 'driver', 'car', 'vehicle', '運転'],
    '도로': ['road', 'street', 'way', 'car', '道路'],
    '차': ['car', 'vehicle', 'tea', 'drink', '車', 'お茶'],
    '마시다': ['drink', 'beverage', 'tea', 'cup', '飲む'],
    '과일': ['fruit', 'sweet', 'pear', 'apple', 'eat', '果物'],
    '빨갛다': ['red', 'apple', '赤い'],
    '용서': ['forgive', 'apology', 'sorry', '謝罪'],
    '죄송': ['sorry', 'apology', 'apologize'],
    '미안': ['sorry', 'apology', 'apologize'],
    '알타이': ['hypothesis', 'theory', 'language', '仮説'],
    '어족': ['hypothesis', 'family', 'language', '仮説'],
    '이론': ['theory', 'hypothesis', 'idea', '理論'],
    '학설': ['hypothesis', 'theory', '학자', '説'],
    '주류': ['mainstream', 'theory', 'hypothesis', '주류']
  };

  function scoreDictionaryEntry(entry, sentenceContext = '', targetWord = '') {
    if (!entry) return { totalScore: 0, bestDefIndex: 0 };
    const sentence = (sentenceContext || '').trim();

    const entryWord = (entry.surface || entry.word || entry.base || entry.expression || '').normalize().trim();
    const cleanTargetWord = (targetWord || '')
      .normalize()
      .trim()
      .replace(/(은|는|이|가|을|를|의|에|에서|와|과|도|만|으로|로)$/, '');

    const rawDefs = Array.isArray(entry.definitions) ? entry.definitions : [];
    if (rawDefs.length === 0) return { totalScore: 0, bestDefIndex: 0 };

    let totalScore = 0;
    let bestDefIndex = 0;
    let bestDefScore = -1;

    const assocRule = HOMONYM_SENSE_ASSOCIATIONS.find((h) => h.word === entryWord || h.word === cleanTargetWord);

    const defScores = [];
    const defConfidenceScores = [];

    rawDefs.forEach((def, defIdx) => {
      const defText = String(def).toLowerCase();
      let defScore = 0;

      // 1. Semantic Association Matching per sub-definition
      if (assocRule && sentence) {
        for (const sense of assocRule.senses) {
          const sentenceHasKeyword = sense.keywords.some((kw) => sentence.includes(kw));
          if (sentenceHasKeyword) {
            sense.keywords.forEach((kw) => {
              if (defText.includes(kw.toLowerCase())) {
                defScore += 25;
              }
            });
          }
        }
      }

      // 2. Multilingual concept mapping
      if (sentence) {
        const sentenceWords = sentence.match(/[가-힣]{2,}/g) || [];
        sentenceWords.forEach((sw) => {
          if (sw !== entryWord && sw !== cleanTargetWord) {
            if (defText.includes(sw)) {
              defScore += 15;
            }
            const mappedConcepts = VOCAB_DOMAIN_MAP[sw];
            if (Array.isArray(mappedConcepts)) {
              mappedConcepts.forEach((concept) => {
                if (defText.includes(concept.toLowerCase())) {
                  defScore += 20;
                }
              });
            }
          }
        });
      }

      // 3. Entry quality scoring: POS bonus & Cross-reference redirect penalty
      const isCrossRef = /^\([^)]*\)\s*→/.test(defText) || /→\s*[가-힣]+/.test(defText);
      if (isCrossRef) {
        defScore -= 40;
      } else if (entry.pos && String(entry.pos).trim()) {
        defScore += 10;
      }

      defScores.push(defScore);
      const confNum = Math.min(99, Math.max(62, 65 + Math.round((Math.max(0, defScore) / 100) * 34)));
      defConfidenceScores.push(`${confNum}%`);

      if (defScore > bestDefScore) {
        bestDefScore = defScore;
        bestDefIndex = defIdx;
      }
    });

    totalScore = bestDefScore;
    return { totalScore, bestDefIndex, defScores, defConfidenceScores };
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
          defScores: res.defScores || [],
          defConfidenceScores: res.defConfidenceScores || []
        };
      });

      scored.sort((a, b) => b.totalScore - a.totalScore || a.originalIndex - b.originalIndex);

      const topInGroup = scored[0];
      scored.forEach((s, idx) => {
        const isTopMatched = (idx === 0);
        const bestIdx = isTopMatched ? (topInGroup ? topInGroup.bestDefIndex : 0) : 0;
        const topConf = (s.defConfidenceScores && s.defConfidenceScores[bestIdx]) ? s.defConfidenceScores[bestIdx] : '85%';
        if (s && s.entry) {
          s.entry._koelectraMatched = isTopMatched;
          s.entry._bestDefIndex = bestIdx;
          s.entry._defScores = s.defScores;
          s.entry._defConfidenceScores = s.defConfidenceScores;
          s.entry._confidenceScore = topConf;
          reordered.push(s.entry);
        }
      });
    });

    return reordered;
  }

  const DictionaryReranker = {
    HOMONYM_SENSE_ASSOCIATIONS,
    VOCAB_DOMAIN_MAP,
    scoreDictionaryEntry,
    rerankDictionaryEntries
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DictionaryReranker;
  } else {
    global.DictionaryReranker = DictionaryReranker;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
