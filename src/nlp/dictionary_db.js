/**
 * Munmek IndexedDB Dictionary Engine
 * Stores and indexes full KRDICT definitions and multiple user-imported dictionaries for fast offline lookups.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'MunmekDictionaryDB';
  const DB_VERSION = 2;
  const STORE_WORDS = 'words';
  const STORE_DICTS = 'dictionaries';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported in this environment.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_WORDS)) {
          const store = db.createObjectStore(STORE_WORDS, { keyPath: 'id' });
          store.createIndex('surface', 'surface', { unique: false });
          store.createIndex('base', 'base', { unique: false });
          store.createIndex('dictId', 'dictId', { unique: false });
        } else {
          const store = event.target.transaction.objectStore(STORE_WORDS);
          if (!store.indexNames.contains('dictId')) {
            store.createIndex('dictId', 'dictId', { unique: false });
          }
        }

        if (!db.objectStoreNames.contains(STORE_DICTS)) {
          db.createObjectStore(STORE_DICTS, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };

      request.onerror = (event) => {
        reject(new Error(`IndexedDB open error: ${event.target.error}`));
      };
    });

    return dbPromise;
  }

  async function getWordCount() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORDS, 'readonly');
      const store = tx.objectStore(STORE_WORDS);
      const countReq = store.count();
      countReq.onsuccess = () => resolve(countReq.result);
      countReq.onerror = () => reject(countReq.error);
    });
  }

  async function getDictionaries() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DICTS, 'readonly');
      const store = tx.objectStore(STORE_DICTS);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  let cachedDictMap = null;

  async function getDictMap() {
    if (cachedDictMap) return cachedDictMap;
    try {
      const dicts = await getDictionaries();
      cachedDictMap = new Map(dicts.map((d) => [d.id, {
        title: d.title,
        targetLanguage: d.targetLanguage || '',
        sourceLanguage: d.sourceLanguage || 'kor'
      }]));
    } catch (e) {
      cachedDictMap = new Map();
    }
    return cachedDictMap;
  }

  function invalidateDictMapCache() {
    cachedDictMap = null;
  }

  function sortHitsByDictOrder(hits, dictOrder) {
    if (!Array.isArray(hits)) return hits;
    if (!Array.isArray(dictOrder) || dictOrder.length === 0) {
      return hits.sort((a, b) => (b.score || 0) - (a.score || 0));
    }
    return hits.sort((a, b) => {
      const idxA = dictOrder.indexOf(a.dictId);
      const idxB = dictOrder.indexOf(b.dictId);
      const rankA = idxA === -1 ? 999 : idxA;
      const rankB = idxB === -1 ? 999 : idxB;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return (b.score || 0) - (a.score || 0);
    });
  }

  function mergeSequencedEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const sequencedMap = new Map();
    const result = [];

    for (const entry of entries) {
      if (entry && entry.sequence !== null && entry.sequence !== undefined && entry.sequence !== '') {
        const groupKey = `${entry.dictId || ''}__${entry.surface || entry.word || ''}__${entry.reading || ''}__${entry.sequence}`;
        const existing = sequencedMap.get(groupKey);
        if (existing) {
          const combinedDefs = Array.isArray(existing.definitions) ? [...existing.definitions] : [];
          const newDefs = Array.isArray(entry.definitions) ? entry.definitions : [];
          newDefs.forEach((d) => {
            if (!combinedDefs.includes(d)) combinedDefs.push(d);
          });
          existing.definitions = combinedDefs.slice(0, 15);
          if ((entry.score || 0) > (existing.score || 0)) {
            existing.score = entry.score;
          }
          if (!existing.hanja && entry.hanja) {
            existing.hanja = entry.hanja;
          }
          if (!existing.pos && entry.pos) {
            existing.pos = entry.pos;
          }
          if (entry.termTags) {
            existing.termTags = existing.termTags ? `${existing.termTags} ${entry.termTags}` : entry.termTags;
          }
        } else {
          sequencedMap.set(groupKey, entry);
          result.push(entry);
        }
      } else {
        result.push(entry);
      }
    }
    return result;
  }

  async function insertEntries(entries, dictId = 'default_dict', dictTitle = 'Imported Dictionary', dictMeta = {}) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    const db = await openDB();

    const mergedEntries = mergeSequencedEntries(entries);
    const BATCH_SIZE = 5000;
    let totalInserted = 0;
    const targetLang = dictMeta.targetLanguage || entries[0]?.dictTargetLanguage || '';
    const sourceLang = dictMeta.sourceLanguage || entries[0]?.dictSourceLanguage || 'kor';

    for (let i = 0; i < mergedEntries.length; i += BATCH_SIZE) {
      const chunk = mergedEntries.slice(i, i + BATCH_SIZE);
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_WORDS, STORE_DICTS], 'readwrite');
        const wordStore = tx.objectStore(STORE_WORDS);
        const dictStore = tx.objectStore(STORE_DICTS);

        for (const item of chunk) {
          const entryToSave = {
            ...item,
            dictId: item.dictId || dictId,
            dictTitle: item.dictTitle || dictTitle,
            dictTargetLanguage: item.dictTargetLanguage || targetLang,
            dictSourceLanguage: item.dictSourceLanguage || sourceLang
          };
          wordStore.put(entryToSave);
          totalInserted++;
        }

        if (i + BATCH_SIZE >= mergedEntries.length) {
          const countReq = wordStore.index('dictId').count(dictId);
          countReq.onsuccess = () => {
            const totalForDict = countReq.result || totalInserted;
            dictStore.put({
              id: dictId,
              title: dictTitle,
              sourceLanguage: sourceLang,
              targetLanguage: targetLang,
              wordCount: totalForDict,
              updatedAt: Date.now()
            });
          };
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    invalidateDictMapCache();
    return totalInserted;
  }

  async function deleteDictionary(dictId) {
    if (!dictId) return 0;
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_WORDS, STORE_DICTS], 'readwrite');
      const wordStore = tx.objectStore(STORE_WORDS);
      const dictStore = tx.objectStore(STORE_DICTS);
      const index = wordStore.index('dictId');

      const request = index.openKeyCursor(IDBKeyRange.only(dictId));
      let deletedCount = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          wordStore.delete(cursor.primaryKey);
          deletedCount++;
          cursor.continue();
        } else {
          dictStore.delete(dictId);
        }
      };

      tx.oncomplete = () => {
        invalidateDictMapCache();
        resolve(deletedCount);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function lookupSurface(surfaceText, filterDictId = 'all', dictOrder = []) {
    if (!surfaceText) return [];
    const db = await openDB();
    const dictMap = await getDictMap();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORDS, 'readonly');
      const store = tx.objectStore(STORE_WORDS);
      const index = store.index('surface');
      const req = index.getAll(surfaceText);

      req.onsuccess = () => {
        let hits = req.result || [];
        if (filterDictId && filterDictId !== 'all') {
          hits = hits.filter((item) => item.dictId === filterDictId);
        }

        hits = hits.map((item) => {
          const dictInfo = dictMap.get(item.dictId);
          const title = item.dictTitle || (dictInfo && dictInfo.title) || (typeof dictInfo === 'string' ? dictInfo : 'Imported Dictionary');
          const targetLang = item.dictTargetLanguage || (dictInfo && dictInfo.targetLanguage) || '';
          const sourceLang = item.dictSourceLanguage || (dictInfo && dictInfo.sourceLanguage) || 'kor';
          return {
            ...item,
            dictTitle: title,
            dictTargetLanguage: targetLang,
            dictSourceLanguage: sourceLang
          };
        });

        resolve(sortHitsByDictOrder(hits, dictOrder));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function lookupBase(baseText, filterDictId = 'all', dictOrder = []) {
    if (!baseText) return [];
    const db = await openDB();
    const dictMap = await getDictMap();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORDS, 'readonly');
      const store = tx.objectStore(STORE_WORDS);
      const index = store.index('base');
      const req = index.getAll(baseText);

      req.onsuccess = () => {
        let hits = req.result || [];
        if (filterDictId && filterDictId !== 'all') {
          hits = hits.filter((item) => item.dictId === filterDictId);
        }

        hits = hits.map((item) => {
          const dictInfo = dictMap.get(item.dictId);
          const title = item.dictTitle || (dictInfo && dictInfo.title) || (typeof dictInfo === 'string' ? dictInfo : 'Imported Dictionary');
          const targetLang = item.dictTargetLanguage || (dictInfo && dictInfo.targetLanguage) || '';
          const sourceLang = item.dictSourceLanguage || (dictInfo && dictInfo.sourceLanguage) || 'kor';
          return {
            ...item,
            dictTitle: title,
            dictTargetLanguage: targetLang,
            dictSourceLanguage: sourceLang
          };
        });

        resolve(sortHitsByDictOrder(hits, dictOrder));
      };
      req.onerror = () => reject(req.error);
    });
  }

  function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string' || !str.includes('&')) return str || '';
    return str.replace(/&(?:quot|apos|#39|#039|lt|gt|nbsp|amp|#(\d+)|#x([0-9a-fA-F]+));/gi, (match, dec, hex) => {
      if (dec) return String.fromCharCode(parseInt(dec, 10));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      const lower = match.toLowerCase();
      switch (lower) {
        case '&quot;': return '"';
        case '&apos;':
        case '&#39;':
        case '&#039;': return "'";
        case '&lt;': return '<';
        case '&gt;': return '>';
        case '&nbsp;': return ' ';
        case '&amp;': return '&';
        default: return match;
      }
    });
  }

  // Parse Yomichan / KRDICT term bank raw array item into Munmek dictionary entry
  function parseKrdictTermItem(item, id) {
    if (!Array.isArray(item) || item.length < 5) return null;
    const expression = item[0] || '';
    const reading = item[1] || '';
    const posTag = item[2] || '';
    
    // Yomichan schema: item[4] is score (integer), item[5] is definitions, item[6] is sequence, item[7] is term tags
    let score = 0;
    let rawContent = null;
    if (item.length > 5) {
      score = typeof item[4] === 'number' ? item[4] : 0;
      rawContent = item[5];
    } else {
      if (typeof item[4] === 'number') {
        score = item[4];
        rawContent = [];
      } else {
        rawContent = item[4];
        score = 0;
      }
    }
    const sequence = typeof item[6] === 'number' ? item[6] : null;
    const termTags = typeof item[7] === 'string' ? item[7] : '';

    if (!expression) return null;

    let rawStrings = [];
    if (typeof rawContent === 'string' && rawContent.trim()) {
      rawStrings = [decodeHtmlEntities(rawContent.trim())];
    } else if (Array.isArray(rawContent)) {
      rawContent.forEach((entry) => {
        if (typeof entry === 'string' && entry.trim()) {
          rawStrings.push(decodeHtmlEntities(entry.trim()));
        } else if (Array.isArray(entry) || (typeof entry === 'object' && entry !== null)) {
          rawStrings.push(...extractDefinitionsFromStructuredContent(entry).map(decodeHtmlEntities));
        }
      });
    } else if (typeof rawContent === 'object' && rawContent !== null) {
      rawStrings = extractDefinitionsFromStructuredContent(rawContent).map(decodeHtmlEntities);
    }

    let extractedHanja = '';
    const defCandidates = [];

    for (const str of rawStrings) {
      const trimmed = str.trim();
      if (!trimmed) continue;

      // Extract Hanja if string is enclosed in brackets e.g. 〔韓國語〕 or is pure Hanja
      if (/^[〔\(\[\{].+[〕\)\]\}]$/.test(trimmed) || (/^[\u4e00-\u9faf\s]+$/.test(trimmed) && trimmed.length < 15)) {
        if (!extractedHanja) {
          extractedHanja = trimmed;
        }
        continue;
      }

      // Filter out redundant headword strings
      const lower = trimmed.toLowerCase();
      if (lower === expression.toLowerCase() || lower === reading.toLowerCase()) {
        continue;
      }

      // Split strings with embedded numbered list markers like "1. ... 2. ... 3. ..."
      const subDefs = trimmed.split(/(?<=\D|^)(?=\b\d{1,2}[\.\)]\s+)/g);

      for (const subStr of subDefs) {
        let subTrimmed = subStr.trim();
        if (!subTrimmed) continue;

        // Filter out pure numbers, punctuation, or empty symbols (e.g., "1", "1.")
        if (!/[a-zA-Z가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u4e00-\u9faf]/.test(subTrimmed)) {
          continue;
        }

        // Clean leading list numbers like "1. ", "1) ", or "1 1. " if followed by definition text
        subTrimmed = subTrimmed.replace(/^(\s*\d{1,3}(?:[\.\)]\s*|\s+))+/, '').trim();

        // Format transitions between lowercase/Korean and uppercase words (e.g., "gestureTo ask" -> "gesture\nTo ask")
        subTrimmed = subTrimmed.replace(/(?<=[a-z가-힣])(?=[A-Z])/g, '\n');

        // Format Sentence usage patterns onto a new line
        subTrimmed = subTrimmed.replace(/\s*(Sentence\s*\d*:?)/gi, '\nSentence: ').trim();

        if (subTrimmed) {
          defCandidates.push(subTrimmed);
        }
      }
    }

    // Deduplicate definition strings
    const uniqueDefs = Array.from(new Set(defCandidates));

    let finalDefs = uniqueDefs;
    if (finalDefs.length === 0) {
      if (typeof rawContent === 'string' && rawContent.trim()) {
        finalDefs = [rawContent.trim()];
      } else if (typeof item[4] === 'string' && item[4].trim()) {
        finalDefs = [item[4].trim()];
      } else {
        finalDefs = [expression];
      }
    }

    return {
      id: id || `krdict_${expression}_${reading}_${Math.random().toString(36).substring(2, 7)}`,
      surface: expression,
      base: expression,
      reading,
      pos: posTag,
      score,
      sequence,
      termTags,
      hanja: extractedHanja,
      definitions: finalDefs.slice(0, 15)
    };
  }

  function extractDefinitionsFromStructuredContent(contentObj) {
    const textDefs = [];

    const BLOCK_TAGS = new Set(['li', 'p', 'tr', 'dt', 'dd']);
    const CONTAINER_TAGS = new Set(['ul', 'ol', 'dl', 'table', 'tbody', 'thead', 'div', 'section', 'article', 'header']);
    const ALLOWED_INLINE_TAGS = new Set(['ruby', 'rt', 'rp', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup']);

    function containsBlockTags(node) {
      if (!node) return false;
      if (Array.isArray(node)) return node.some(containsBlockTags);
      if (typeof node === 'object') {
        const tag = (node.tag || '').toLowerCase();
        if (BLOCK_TAGS.has(tag) || CONTAINER_TAGS.has(tag)) return true;
        if (node.content) return containsBlockTags(node.content);
      }
      return false;
    }

    function serializeToHtml(node) {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (typeof node === 'number') return String(node);
      if (Array.isArray(node)) {
        return node.map(serializeToHtml).join('');
      }
      if (typeof node === 'object') {
        const tag = (node.tag || '').toLowerCase();
        const inner = node.content ? serializeToHtml(node.content) : (node.text ? String(node.text) : '');
        if (ALLOWED_INLINE_TAGS.has(tag)) {
          return `<${tag}>${inner}</${tag}>`;
        }
        if (tag === 'br') {
          return '<br>';
        }
        return inner;
      }
      return '';
    }

    function processNode(node) {
      if (!node) return;
      if (typeof node === 'string') {
        const trimmed = decodeHtmlEntities(node.trim());
        if (trimmed && !trimmed.startsWith('{') && !trimmed.endsWith('}')) {
          textDefs.push(trimmed);
        }
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(processNode);
        return;
      }
      if (typeof node === 'object') {
        const tag = (node.tag || '').toLowerCase();
        if (BLOCK_TAGS.has(tag)) {
          if (node.content && containsBlockTags(node.content)) {
            processNode(node.content);
          } else {
            const html = decodeHtmlEntities(serializeToHtml(node.content || node.text).trim());
            if (html) textDefs.push(html);
          }
          return;
        }
        if (CONTAINER_TAGS.has(tag) || node.type === 'structured-content') {
          if (node.content && containsBlockTags(node.content)) {
            processNode(node.content);
          } else {
            const html = decodeHtmlEntities(serializeToHtml(node.content || node.text).trim());
            if (html) textDefs.push(html);
          }
          return;
        }
        if (node.content) {
          processNode(node.content);
        } else if (node.text) {
          const txt = decodeHtmlEntities(String(node.text).trim());
          if (txt) textDefs.push(txt);
        }
      }
    }

    processNode(contentObj);
    return textDefs;
  }

  async function clearDictionary() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_WORDS, STORE_DICTS], 'readwrite');
      tx.objectStore(STORE_WORDS).clear();
      tx.objectStore(STORE_DICTS).clear();
      tx.oncomplete = () => {
        invalidateDictMapCache();
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getEntriesForDict(dictId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORDS, 'readonly');
      const store = tx.objectStore(STORE_WORDS);
      const index = store.index('dictId');
      const req = index.getAll(dictId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function updateEntriesBatch(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORDS, 'readwrite');
      const store = tx.objectStore(STORE_WORDS);
      entries.forEach((e) => store.put(e));
      tx.oncomplete = () => {
        invalidateDictMapCache();
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async function markDictPrecomputed(dictId, hasPrecomputed = true) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_DICTS, 'readwrite');
      const store = tx.objectStore(STORE_DICTS);
      const getReq = store.get(dictId);
      getReq.onsuccess = () => {
        const dictRecord = getReq.result;
        if (dictRecord) {
          dictRecord.hasPrecomputedVectors = Boolean(hasPrecomputed);
          store.put(dictRecord);
        }
        resolve(true);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async function removePrecomputedVectors(dictId) {
    const entries = await getEntriesForDict(dictId);
    const modified = [];
    entries.forEach((e) => {
      if (e._defVectors) {
        delete e._defVectors;
        modified.push(e);
      }
    });
    if (modified.length > 0) {
      await updateEntriesBatch(modified);
    }
    await markDictPrecomputed(dictId, false);
    invalidateDictMapCache();
  }

  async function importPrecomputedVectorsForDict(dictId, vectorMap) {
    if (!vectorMap || typeof vectorMap !== 'object') {
      throw new Error('Invalid vector map provided.');
    }
    const entries = await getEntriesForDict(dictId);
    if (!entries || entries.length === 0) {
      throw new Error(`No dictionary entries found for dictionary "${dictId}".`);
    }

    const modified = [];
    entries.forEach((entry) => {
      const rawDefs = Array.isArray(entry.definitions) ? entry.definitions : [];
      let updated = false;
      rawDefs.forEach((defStr) => {
        const str = String(defStr).trim();
        const vec = vectorMap[str] || vectorMap[str.toLowerCase()];
        if (vec) {
          if (!entry._defVectors) entry._defVectors = {};
          entry._defVectors[str] = Array.isArray(vec) ? vec : Array.from(vec);
          updated = true;
        }
      });
      if (updated) modified.push(entry);
    });

    if (modified.length > 0) {
      await updateEntriesBatch(modified);
      invalidateDictMapCache();
    }
    await markDictPrecomputed(dictId, true);
    return modified.length;
  }

  const DictionaryDB = {
    openDB,
    getWordCount,
    getDictionaries,
    insertEntries,
    deleteDictionary,
    clearDictionary,
    lookupSurface,
    lookupBase,
    parseKrdictTermItem,
    extractDefinitionsFromStructuredContent,
    mergeSequencedEntries,
    sortHitsByDictOrder,
    getEntriesForDict,
    updateEntriesBatch,
    markDictPrecomputed,
    removePrecomputedVectors,
    importPrecomputedVectorsForDict,
    decodeHtmlEntities
  };

  const targetGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : global);
  targetGlobal.DictionaryDB = DictionaryDB;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DictionaryDB;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
