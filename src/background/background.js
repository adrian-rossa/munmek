function ensureDictionaryDbLoaded() {
  if (typeof self.DictionaryDB !== 'undefined') return true;
  try {
    importScripts('../nlp/dictionary_db.js');
    return typeof self.DictionaryDB !== 'undefined';
  } catch (e) {
    console.error("Failed to import dictionary_db.js", e);
    return false;
  }
}
ensureDictionaryDbLoaded();

const DEFAULT_MODEL_ID = 'gemini-flash-lite-latest';
const DEFAULT_PROMPT = `Return ONLY valid JSON (no markdown backticks or commentary).

Analyze the Korean word '{WORD}' in sentence: '{SENTENCE}'
Context - Preceding (−1): '{PREV_SENTENCE}' | Preceding (−2): '{PREV_SENTENCE2}'

Rules:
1. If '{WORD}' is a person's name or proper noun in context (e.g. before ~이에요/~예요/~야/~아/~씨/~님), set "pos": "proper noun" and definition to the name rather than forcing a dictionary homonym.
2. Ground "grammar_notes" in the actual context of the surrounding sentences and scene.

Return JSON with "words_analysis": [{
  "surface": "{WORD}",
  "base": "base form or name",
  "pos": "part of speech",
  "definitions": ["definition in context"],
  "conjugation": { "ending": "...", "explanation": "..." },
  "grammar_notes": "contextual breakdown based on scene/sentence context",
  "id": "1"
}]`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['modelId', 'ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping', 'ankiDefinitionField', 'enableOnnxReranker', 'enableWebGpu'], (result) => {
    const defaults = {};
    if (!result.modelId) defaults.modelId = DEFAULT_MODEL_ID;
    if (typeof result.enableOnnxReranker !== 'boolean') defaults.enableOnnxReranker = false;
    if (typeof result.enableWebGpu !== 'boolean') defaults.enableWebGpu = false;
    if (!result.ankiConnectUrl) defaults.ankiConnectUrl = 'http://127.0.0.1:8765';
    if (!result.ankiDeckName) defaults.ankiDeckName = 'Korean';
    if (!result.ankiNoteType) defaults.ankiNoteType = 'Basic';
    if (!result.ankiFieldMapping) {
      defaults.ankiFieldMapping = JSON.stringify({
        Front: '{{word}}',
        Back: '{{definition}}<br><br>{{translation}}<br><br>{{grammar}}'
      }, null, 2);
    }
    if (!result.ankiDefinitionField) defaults.ankiDefinitionField = 'Back';
    if (Object.keys(defaults).length > 0) chrome.storage.local.set(defaults);
  });
});

const activeTabContexts = {};
let offscreenCreating = null;

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Run WASM Korean morphological analyzer for instant word lookups'
  });

  await offscreenCreating;
  offscreenCreating = null;

  for (let p = 0; p < 15; p++) {
    const ready = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'PING_OFFSCREEN' }, (res) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(Boolean(res && res.pong));
        }
      });
    });
    if (ready) break;
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function sendToOffscreenWithRetry(message, maxRetries = 5, retryDelayMs = 200) {
  await ensureOffscreenDocument();
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message || '';
          if (err.includes('Receiving end does not exist') || err.includes('Could not establish connection') || err.includes('closed before a response was received')) {
            resolve({ retry: true, error: err });
            return;
          }
          resolve({ ok: false, error: err });
          return;
        }
        resolve(response || { ok: false, error: 'No response from offscreen document' });
      });
    });

    if (!result.retry) {
      return result;
    }
    if (attempt < maxRetries) {
      await ensureOffscreenDocument();
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  return { ok: false, error: 'Could not establish connection to offscreen document after retries.' };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'analyzeKoreanTextWasm') {
    handleWasmAnalysisRequest(request.text, sendResponse);
    return true;
  }

  if (request.type === 'rerankKoreanCandidates') {
    handleRerankCandidatesRequest(request.candidates, request.sentenceContext, sendResponse);
    return true;
  }

  if (request.type === 'rerankDictionaryEntries') {
    handleRerankDictionaryEntriesRequest(request.entries, request.sentenceContext, request.word, sendResponse, request);
    return true;
  }

  if (request.type === 'analyzeSentence') {
    handleSentenceAnalysisRequest(request.data, sendResponse, sender);
    return true;
  }

  if (request.type === 'quickGeminiFallback' || request.type === 'quickLlmLookup') {
    handleQuickGeminiFallback(request.data, sendResponse);
    return true;
  }

  if (request.type === 'createAnkiCard') {
    handleAnkiCardRequest(request.data, sendResponse);
    return true;
  }

  if (request.type === 'clearDictCache') {
    if (typeof self.DictionaryDB !== 'undefined' && typeof self.DictionaryDB.invalidateDictMapCache === 'function') {
      self.DictionaryDB.invalidateDictMapCache();
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'dictionaryLookup') {
    if (!ensureDictionaryDbLoaded() || !self.DictionaryDB) {
      sendResponse({ error: 'DictionaryDB service script is not loaded.' });
      return true;
    }
    chrome.storage.local.get(['dictionaryOrder'], (res) => {
      const order = res.dictionaryOrder || [];
      try {
        if (request.method === 'lookupSurface' && typeof self.DictionaryDB.lookupSurface === 'function') {
          self.DictionaryDB.lookupSurface(request.text, request.dictId, order)
            .then(hits => sendResponse({ hits }))
            .catch(error => sendResponse({ error: error.toString() }));
        } else if (request.method === 'lookupBase' && typeof self.DictionaryDB.lookupBase === 'function') {
          self.DictionaryDB.lookupBase(request.text, request.dictId, order)
            .then(hits => sendResponse({ hits }))
            .catch(error => sendResponse({ error: error.toString() }));
        } else {
          sendResponse({ error: 'Invalid dictionaryLookup method.' });
        }
      } catch (err) {
        sendResponse({ error: err.toString() });
      }
    });
    return true;
  }

  if (request.type === 'setTabContext') {
    const tabId = sender.tab ? sender.tab.id : request.tabId;
    if (tabId) {
      activeTabContexts[tabId] = {
        name: request.name || 'Custom Context',
        text: request.text || ''
      };
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'getTabContext') {
    const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
    const ctx = tabId ? activeTabContexts[tabId] : null;
    sendResponse({ context: ctx || null });
    return true;
  }

  if (request.type === 'clearTabContext') {
    const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
    if (tabId) delete activeTabContexts[tabId];
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'rerankDictionaryEntries') {
    handleRerankDictionaryEntriesRequest(request.entries, request.sentenceContext, request.word, sendResponse);
    return true;
  }

  if (request.type === 'rerankCandidates') {
    handleRerankCandidatesRequest(request.candidates, request.sentenceContext, sendResponse);
    return true;
  }

  return false;
});

function handleRerankCandidatesRequest(candidates, sentenceContext, sendResponse) {
  chrome.storage.local.get(['enableOnnxReranker'], async (result) => {
    const isEnabled = typeof result.enableOnnxReranker === 'boolean' ? result.enableOnnxReranker : true;
    if (!isEnabled) {
      sendResponse({ ok: true, candidates: candidates || [], disabled: true });
      return;
    }

    try {
      const response = await sendToOffscreenWithRetry({
        type: 'OFFSCREEN_RERANK_CANDIDATES',
        candidates,
        sentenceContext
      });
      sendResponse(response);
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  });
}

function handleRerankDictionaryEntriesRequest(entries, sentenceContext, word, sendResponse, requestData = {}) {
  const tBgRecv = Date.now();
  chrome.storage.local.get(['enableOnnxReranker', 'enableWebGpu'], async (result) => {
    const isEnabled = typeof result.enableOnnxReranker !== 'boolean' ? true : result.enableOnnxReranker;
    const enableWebGpu = typeof result.enableWebGpu !== 'boolean' ? true : result.enableWebGpu;
    if (!isEnabled) {
      sendResponse({ ok: true, entries: entries || [], disabled: true });
      return;
    }

    try {
      const tBgSentOffscreen = Date.now();
      console.log(`[Munmek Background] [t=${tBgRecv}] Forwarding Stage 2 ONNX rerank request to offscreen document (enableWebGpu=${enableWebGpu}):`, { word, sentenceContext });
      const response = await sendToOffscreenWithRetry({
        type: 'OFFSCREEN_RERANK_DICTIONARY_ENTRIES',
        entries,
        sentenceContext,
        word,
        enableWebGpu
      });
      const tBgFinished = Date.now();
      const bgTotalMs = tBgFinished - tBgRecv;

      if (response && response.ok) {
        const reasonStr = response.providerReason ? ` | Note: ${response.providerReason}` : '';
        console.log(`[Munmek Background Timer] Stage 2 Rerank for '${word}' completed in ${bgTotalMs} ms [Provider: ${response.activeProvider || 'WASM'}${reasonStr}] (Offscreen: ${response.offscreenMs || '?'} ms, Query: ${response.queryMs || '?'} ms, ${response.passageCount || 0} passages [${response.precomputedHits || 0} precomputed] in ${response.passageMs || '?'} ms)`);
        sendResponse({
          ...response,
          t_sent: requestData.t_sent || null,
          t_bg_recv: tBgRecv,
          t_bg_sent_offscreen: tBgSentOffscreen,
          t_bg_finished: tBgFinished,
          bgTotalMs
        });
      } else {
        if (response && response.error) {
          console.warn('[Munmek Background] Offscreen rerank notice:', response.error);
        }
        sendResponse(response);
      }
    } catch (err) {
      console.error('[Munmek Background] Offscreen rerank error:', err);
      sendResponse({ ok: false, error: err.message });
    }
  });
}

function handleWasmAnalysisRequest(text, sendResponse) {
  (async () => {
    try {
      const response = await sendToOffscreenWithRetry({
        type: 'OFFSCREEN_ANALYZE_KOREAN',
        text
      });
      sendResponse(response);
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
}

function handleSentenceAnalysisRequest(data, sendResponse, sender) {
  chrome.storage.local.get(['apiKey', 'modelId', 'aiPromptExtension', 'useFullContext', 'responseLanguage', 'customResponseLanguage'], async (config) => {
    try {
      if (!config.apiKey || !config.modelId) {
        sendResponse({ error: 'API key or model ID is not configured. Open the extension settings first.' });
        return;
      }

      let systemInstruction = 'You are a precise Korean language assistant.';
      let promptText = DEFAULT_PROMPT
        .replace('{WORD}', data.word || '')
        .replace('{SENTENCE}', data.sentence || '')
        .replace('{PREV_SENTENCE}', data.prevSentence || '')
        .replace('{PREV_SENTENCE2}', data.prevSentence2 || '');

      let targetLangStr = 'English';
      if (config.responseLanguage === 'custom') {
        targetLangStr = (config.customResponseLanguage || '').trim() || 'English';
      } else if (config.responseLanguage) {
        targetLangStr = config.responseLanguage;
      }
      systemInstruction += ` Please provide all definitions, explanations, translations, and notes in ${targetLangStr}.`;

      if (config.aiPromptExtension && config.aiPromptExtension.trim()) {
        systemInstruction += ` Additional user instruction: ${config.aiPromptExtension.trim()}`;
      }

      const bodyData = {
        contents: [
          {
            parts: [
              { text: promptText }
            ]
          }
        ],
        systemInstruction: {
          parts: [
            { text: systemInstruction }
          ]
        },
        generationConfig: {
          responseMimeType: 'application/json'
        }
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}:generateContent?key=${config.apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        sendResponse({ error: `API request failed with status ${response.status}: ${errorText}` });
        return;
      }

      const resJson = await response.json();
      let textContent = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textContent) {
        sendResponse({ error: 'Empty response text from Gemini API.' });
        return;
      }

      try {
        const parsed = JSON.parse(textContent);
        sendResponse({ data: parsed });
      } catch (pErr) {
        sendResponse({ error: `Failed to parse Gemini API JSON response: ${pErr.message}` });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });
}

function handleQuickGeminiFallback(data, sendResponse) {
  chrome.storage.local.get(['apiKey', 'modelId', 'responseLanguage', 'customResponseLanguage'], async (config) => {
    try {
      if (!config.apiKey || !config.modelId) {
        sendResponse({ error: 'Gemini API Key or Model is not configured.' });
        return;
      }

      let targetLangStr = 'English';
      if (config.responseLanguage === 'custom') {
        targetLangStr = (config.customResponseLanguage || '').trim() || 'English';
      } else if (config.responseLanguage) {
        targetLangStr = config.responseLanguage;
      }

      const prompt = `JSON only (no markdown): {"definitions":["definition in ${targetLangStr}"],"pos":"part of speech","grammar_notes":"usage note"}
Analyze '${data.word}' in sentence: '${data.sentence || ''}'`;

      const bodyData = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}:generateContent?key=${config.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      if (!res.ok) {
        sendResponse({ error: `Gemini API returned status ${res.status}` });
        return;
      }

      const resJson = await res.json();
      const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        sendResponse({ data: JSON.parse(text) });
      } else {
        sendResponse({ error: 'Empty response' });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });
}

function handleAnkiCardRequest(data, sendResponse) {
  chrome.storage.local.get(['ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping', 'ankiDefinitionField'], async (config) => {
    try {
      const ankiUrl = config.ankiConnectUrl || 'http://127.0.0.1:8765';
      const deckName = config.ankiDeckName || 'Korean';
      const noteType = config.ankiNoteType || 'Basic';
      const defField = config.ankiDefinitionField || 'Back';

      let fields = {};
      if (config.ankiFieldMapping) {
        try {
          const mapping = JSON.parse(config.ankiFieldMapping);
          for (const [key, valTemplate] of Object.entries(mapping)) {
            let filled = String(valTemplate)
              .replace(/\{\{word\}\}/g, data.word || '')
              .replace(/\{\{surface\}\}/g, data.surface || data.word || '')
              .replace(/\{\{base\}\}/g, data.base || data.word || '')
              .replace(/\{\{definition\}\}/g, data.definition || '')
              .replace(/\{\{definitions\}\}/g, data.definition || '')
              .replace(/\{\{translation\}\}/g, data.translation || '')
              .replace(/\{\{sentence\}\}/g, data.sentence || '')
              .replace(/\{\{grammar\}\}/g, data.grammar || data.grammarNotes || '')
              .replace(/\{\{pos\}\}/g, data.pos || '');
            fields[key] = filled;
          }
        } catch (e) {
          console.warn('[Munmek Anki] Failed to parse custom mapping, using default fields:', e);
        }
      }

      if (Object.keys(fields).length === 0) {
        fields = {
          Front: data.word || '',
          [defField]: `${data.definition || ''}<br><br><i>${data.sentence || ''}</i>`
        };
      }

      const body = {
        action: 'addNote',
        version: 6,
        params: {
          note: {
            deckName: deckName,
            modelName: noteType,
            fields: fields,
            tags: ['munmek-korean']
          }
        }
      };

      const res = await fetch(ankiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        sendResponse({ error: `AnkiConnect HTTP error ${res.status}` });
        return;
      }

      const resJson = await res.json();
      if (resJson.error) {
        sendResponse({ error: resJson.error });
      } else {
        sendResponse({ success: true, noteId: resJson.result });
      }
    } catch (err) {
      sendResponse({ error: `Failed to connect to AnkiConnect at ${config.ankiConnectUrl || 'http://127.0.0.1:8765'}: ${err.message}` });
    }
  });
}
