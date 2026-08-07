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
      cachedDictMap = new Map(dicts.map((d) => [d.id, d.title]));
    } catch (e) {
      cachedDictMap = new Map();
    }
    return cachedDictMap;
  }

  function invalidateDictMapCache() {
    cachedDictMap = null;
  }

  function sortHitsByDictOrder(hits, dictOrder) {
    if (!Array.isArray(dictOrder) || dictOrder.length === 0 || !Array.isArray(hits)) return hits;
    return hits.sort((a, b) => {
      const idxA = dictOrder.indexOf(a.dictId);
      const idxB = dictOrder.indexOf(b.dictId);
      const rankA = idxA === -1 ? 999 : idxA;
      const rankB = idxB === -1 ? 999 : idxB;
      return rankA - rankB;
    });
  }

  async function insertEntries(entries, dictId = 'default_dict', dictTitle = 'Imported Dictionary') {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    const db = await openDB();

    const BATCH_SIZE = 5000;
    let totalInserted = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      await new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_WORDS, STORE_DICTS], 'readwrite');
        const wordStore = tx.objectStore(STORE_WORDS);
        const dictStore = tx.objectStore(STORE_DICTS);

        for (const item of chunk) {
          const entryToSave = {
            ...item,
            dictId: item.dictId || dictId,
            dictTitle: item.dictTitle || dictTitle
          };
          wordStore.put(entryToSave);
          totalInserted++;
        }

        if (i + BATCH_SIZE >= entries.length) {
          const countReq = wordStore.index('dictId').count(dictId);
          countReq.onsuccess = () => {
            const totalForDict = countReq.result || totalInserted;
            dictStore.put({
              id: dictId,
              title: dictTitle,
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

        hits = hits.map((item) => ({
          ...item,
          dictTitle: item.dictTitle || dictMap.get(item.dictId) || 'Imported Dictionary'
        }));

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

        hits = hits.map((item) => ({
          ...item,
          dictTitle: item.dictTitle || dictMap.get(item.dictId) || 'Imported Dictionary'
        }));

        resolve(sortHitsByDictOrder(hits, dictOrder));
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Parse Yomichan / KRDICT term bank raw array item into Munmek dictionary entry
  function parseKrdictTermItem(item, id) {
    if (!Array.isArray(item) || item.length < 5) return null;
    const expression = item[0] || '';
    const reading = item[1] || '';
    const posTag = item[2] || '';
    const rawContent = item[5] !== undefined ? item[5] : item[4];

    if (!expression) return null;

    let rawStrings = [];
    if (typeof rawContent === 'string' && rawContent.trim()) {
      rawStrings = [rawContent.trim()];
    } else if (Array.isArray(rawContent)) {
      rawContent.forEach((entry) => {
        if (typeof entry === 'string' && entry.trim()) {
          rawStrings.push(entry.trim());
        } else if (Array.isArray(entry) || (typeof entry === 'object' && entry !== null)) {
          rawStrings.push(...extractDefinitionsFromStructuredContent(entry));
        }
      });
    } else if (typeof rawContent === 'object' && rawContent !== null) {
      rawStrings = extractDefinitionsFromStructuredContent(rawContent);
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

        // Clean leading list numbers like "1. " or "1) " if followed by definition text
        subTrimmed = subTrimmed.replace(/^[\d]+[\.\)]\s*/, '').trim();

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
      if (typeof item[4] === 'string' && item[4].trim()) {
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
      hanja: extractedHanja,
      definitions: finalDefs.slice(0, 15)
    };
  }

  function extractDefinitionsFromStructuredContent(contentObj) {
    const textDefs = [];

    function getNodeText(node) {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (typeof node === 'number') return String(node);
      if (Array.isArray(node)) return node.map(getNodeText).filter(Boolean).join(' ');
      if (typeof node === 'object') {
        if (node.text) return String(node.text);
        if (node.content) return getNodeText(node.content);
      }
      return '';
    }

    function processNode(node) {
      if (!node) return;
      if (typeof node === 'string') {
        const trimmed = node.trim();
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
        if (node.tag === 'li' || node.tag === 'p' || node.tag === 'div' || node.tag === 'ol' || node.tag === 'ul') {
          if (node.content && Array.isArray(node.content)) {
            node.content.forEach(processNode);
          } else {
            const txt = getNodeText(node).trim();
            if (txt) textDefs.push(txt);
          }
        } else if (node.content) {
          processNode(node.content);
        } else {
          const txt = getNodeText(node).trim();
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
    getEntriesForDict,
    updateEntriesBatch,
    markDictPrecomputed,
    removePrecomputedVectors,
    importPrecomputedVectorsForDict
  };

  const targetGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : global);
  targetGlobal.DictionaryDB = DictionaryDB;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DictionaryDB;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
