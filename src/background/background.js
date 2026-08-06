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
  chrome.storage.local.get(['modelId', 'ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping', 'ankiDefinitionField'], (result) => {
    const defaults = {};
    if (!result.modelId) defaults.modelId = DEFAULT_MODEL_ID;
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
    handleRerankDictionaryEntriesRequest(request.entries, request.sentenceContext, request.word, sendResponse);
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

  if (request.type === 'summarizeContext') {
    handleContextSummarization(request.text, sendResponse);
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
      await ensureOffscreenDocument();
      chrome.runtime.sendMessage(
        { type: 'OFFSCREEN_RERANK_CANDIDATES', candidates, sentenceContext },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response || { ok: false, error: 'No response from offscreen document' });
        }
      );
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  });
}

function handleRerankDictionaryEntriesRequest(entries, sentenceContext, word, sendResponse) {
  chrome.storage.local.get(['enableOnnxReranker'], async (result) => {
    const isEnabled = typeof result.enableOnnxReranker === 'boolean' ? result.enableOnnxReranker : true;
    if (!isEnabled) {
      sendResponse({ ok: true, entries: entries || [], disabled: true });
      return;
    }

    try {
      await ensureOffscreenDocument();
      chrome.runtime.sendMessage(
        { type: 'OFFSCREEN_RERANK_DICTIONARY_ENTRIES', entries, sentenceContext, word },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response || { ok: false, error: 'No response from offscreen document' });
        }
      );
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  });
}

function handleWasmAnalysisRequest(text, sendResponse) {
  (async () => {
    try {
      await ensureOffscreenDocument();
      chrome.runtime.sendMessage(
        { type: 'OFFSCREEN_ANALYZE_KOREAN', text },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response || { ok: false, error: 'No response from offscreen document' });
        }
      );
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

      const tabId = sender && sender.tab ? sender.tab.id : null;
      if (tabId && activeTabContexts[tabId]) {
        data.tabContext = activeTabContexts[tabId];
      }

      const prompt = buildSentenceAnalysisPrompt(config.aiPromptExtension, data, Boolean(config.useFullContext), config.responseLanguage, config.customResponseLanguage);
      console.log('[Munmek Gemini ContextSentencesSent]', {
        word: data.word,
        sentence: data.sentence,
        prevSentence: data.prevSentence || '(none)',
        prevSentence2: data.prevSentence2 || '(none)'
      });
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}:generateContent?key=${config.apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        sendResponse({ error: `API error ${response.status}: ${response.statusText}`, details: errorBody });
        return;
      }

      const jsonResponse = await response.json();
      const text = jsonResponse?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();

      if (!text) {
        sendResponse({ error: 'Gemini returned no usable text.', details: jsonResponse });
        return;
      }

      const parsed = parseJsonResponse(text);
      if (!parsed.ok) {
        sendResponse({ error: parsed.error, rawResponse: text });
        return;
      }

      trackDynamicGeminiFields(parsed.value);

      sendResponse({ data: parsed.value });
    } catch (error) {
      sendResponse({ error: `Network or parsing error: ${error.message}` });
    }
  });
}

function handleQuickGeminiFallback(data, sendResponse) {
  chrome.storage.local.get(['apiKey', 'modelId', 'responseLanguage', 'customResponseLanguage'], async (config) => {
    try {
      if (!config.apiKey || !config.modelId) {
        sendResponse({ error: 'Gemini API key is not configured.' });
        return;
      }

      const word = data.word || '';
      const sentence = data.sentence || '';
      const langInstr = getLanguageInstruction(config.responseLanguage, config.customResponseLanguage);
      const prompt = `Provide a concise 1-sentence dictionary definition, Part of Speech, and Hanja (if applicable) for the Korean word "${word}" used in the sentence: "${sentence}".${langInstr ? ' ' + langInstr.trim() : ''}\nReturn JSON strictly matching this schema: {"translation": "concise definition", "pos": "Noun/Verb/Adjective/etc.", "hanja": "〔韓國語〕 or empty"}`;

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}:generateContent?key=${config.apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        sendResponse({ error: `Quick LLM API error ${response.status}: ${response.statusText}`, details: errorBody });
        return;
      }

      const jsonResponse = await response.json();
      const text = jsonResponse?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
      const parsed = parseJsonResponse(text);

      if (!parsed.ok) {
        sendResponse({ error: parsed.error, rawResponse: text });
        return;
      }

      sendResponse({ data: parsed.value });
    } catch (err) {
      sendResponse({ error: `Quick Fallback error: ${err.message}` });
    }
  });
}

function handleAnkiCardRequest(data, sendResponse) {
  chrome.storage.local.get(['ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping'], async (config) => {
    try {
      if (!config.ankiConnectUrl || !config.ankiDeckName || !config.ankiNoteType) {
        sendResponse({ error: 'AnkiConnect settings are incomplete. Open extension settings first.' });
        return;
      }

      const payload = buildAnkiPayload(config, data);
      const result = await callAnkiConnect(config.ankiConnectUrl, 'addNote', {
        note: {
          deckName: config.ankiDeckName,
          modelName: config.ankiNoteType,
          fields: payload.fields,
          tags: payload.tags
        }
      });

      if (result) {
        chrome.storage.local.set({ lastCreatedAnkiNoteId: result });
      }

      sendResponse({ data: { created: true, noteId: result } });
    } catch (error) {
      sendResponse({ error: `AnkiConnect error: ${error.message}` });
    }
  });
}

function getLanguageInstruction(responseLanguage, customResponseLanguage) {
  if (!responseLanguage || responseLanguage.toLowerCase() === 'english') {
    return '';
  }
  const langName = responseLanguage === 'Custom' ? (customResponseLanguage || 'target language') : responseLanguage;
  return `Important: Provide all definitions, translations, and explanations in ${langName}.`;
}

function buildSentenceAnalysisPrompt(userExtension, data, useFullContext = false, responseLanguage = 'English', customResponseLanguage = '') {
  const context = {
    word: data.word || '',
    sentence: data.sentence || '',
    prevSentence: data.prevSentence || '',
    prevSentence2: data.prevSentence2 || ''
  };

  let promptText = replacePromptPlaceholders(DEFAULT_PROMPT, context);

  if (data.tabContext && data.tabContext.text) {
    const limit = useFullContext ? 15000 : 3000;
    promptText += `\n\nActive Tab/Subtitles Context (${data.tabContext.name || 'Webpage'}):\n${data.tabContext.text.slice(0, limit)}`;
  }

  const langInstr = getLanguageInstruction(responseLanguage, customResponseLanguage);
  if (langInstr) {
    promptText += `\n\n${langInstr}`;
  }

  if (userExtension && userExtension.trim()) {
    promptText += `\n\nAdditional User Style & Constraints:\n${userExtension.trim()}`;
  }

  return promptText;
}

function trackDynamicGeminiFields(responseObj) {
  if (!responseObj || typeof responseObj !== 'object') return;
  
  const targetObj = unpackAnalysis(responseObj);

  chrome.storage.local.get(['trackedGeminiFields', 'totalGeminiLookups', 'aiPromptExtension'], (res) => {
    let fieldsMap = res.trackedGeminiFields || {};
    let totalLookups = (res.totalGeminiLookups || 0) + 1;
    const promptText = res.aiPromptExtension || '';

    const reservedKeys = new Set([
      'words_analysis', 'words', 'analysis', 'conjugation', 'translation', 'grammar',
      'notes', 'hanja', 'pos', 'word', 'base', 'sentence', 'prevSentence', 'prevSentence2',
      'candidate', 'definition'
    ]);

    const allKeys = new Set([...Object.keys(responseObj), ...Object.keys(targetObj)]);

    allKeys.forEach((key) => {
      if (!reservedKeys.has(key) && key.length >= 2) {
        fieldsMap[key] = totalLookups;
      }
    });

    Object.keys(fieldsMap).forEach((key) => {
      const isInPrompt = promptText.includes(key);
      const isStale = (totalLookups - fieldsMap[key] > 5);
      if (!isInPrompt && isStale) {
        delete fieldsMap[key];
      }
    });

    chrome.storage.local.set({
      trackedGeminiFields: fieldsMap,
      totalGeminiLookups: totalLookups
    });
  });
}

function replacePromptPlaceholders(prompt, context) {
  return prompt
    .replace(/\{WORD\}/g, context.word)
    .replace(/\{SENTENCE\}/g, context.sentence)
    .replace(/\{PREV_SENTENCE\}/g, context.prevSentence || '')
    .replace(/\{PREV_SENTENCE2\}/g, context.prevSentence2 || '')
    .replace(/\{DICTIONARY_ENTRY\}/g, context.dictionaryCandidate ? JSON.stringify(context.dictionaryCandidate, null, 2) : '');
}

function parseJsonResponse(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (error) {
    return { ok: false, error: `Failed to parse JSON response: ${error.message}` };
  }
}

function buildAnkiPayload(config, data) {
  let fieldMapping = {};

  try {
    fieldMapping = config.ankiFieldMapping ? JSON.parse(config.ankiFieldMapping) : {};
  } catch (error) {
    throw new Error(`Invalid Anki field mapping JSON: ${error.message}`);
  }

  const context = buildTemplateContext(data);
  const fields = {};

  Object.entries(fieldMapping).forEach(([fieldName, template]) => {
    const rendered = renderTemplate(String(template || ''), context);
    fields[fieldName] = convertNewlinesToBr(rendered);
  });

  if (config.ankiUpdateLastCard) {
    const definitionField = config.ankiDefinitionField || 'Back';
    const definitionValue = renderDefinitionText(context);
    fields[definitionField] = convertNewlinesToBr(definitionValue);
  }

  return {
    fields,
    tags: ['munmek', 'korean-lookup']
  };
}

function convertNewlinesToBr(str) {
  if (typeof str !== 'string' || !str) return '';
  return str.replace(/\r?\n/g, '<br>');
}

function unpackAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return {};
  let target = raw;
  if (Array.isArray(target.words_analysis) && target.words_analysis.length > 0) {
    target = target.words_analysis[0];
  } else if (Array.isArray(target.analysis) && target.analysis.length > 0) {
    target = target.analysis[0];
  } else if (target.analysis && typeof target.analysis === 'object') {
    target = target.analysis;
  }
  return target || {};
}

function buildTemplateContext(data) {
  const dictionaryEntry = data.dictionaryEntry || {};
  const rawAnalysis = data.analysis || {};
  const rawQuick = data.quickFallback || {};
  const fullAnalysis = unpackAnalysis(rawAnalysis);
  const quickAnalysis = unpackAnalysis(rawQuick);
  const definitions = Array.isArray(dictionaryEntry.definitions) ? dictionaryEntry.definitions : [];

  const geminiTranslation = fullAnalysis.translation || fullAnalysis.definition || (Array.isArray(fullAnalysis.definitions) ? fullAnalysis.definitions.join('; ') : '') || quickAnalysis.translation || quickAnalysis.definition || (Array.isArray(quickAnalysis.definitions) ? quickAnalysis.definitions.join('; ') : '');
  const geminiGrammar = fullAnalysis.grammar || fullAnalysis.grammar_notes || (fullAnalysis.conjugation && typeof fullAnalysis.conjugation === 'object' ? fullAnalysis.conjugation.explanation : '') || quickAnalysis.grammar || quickAnalysis.grammar_notes || '';
  const geminiHanja = (dictionaryEntry && dictionaryEntry.hanja) || fullAnalysis.hanja || quickAnalysis.hanja || '';

  const primaryDef = data.selectedDefinition || (definitions.length > 0 ? definitions.join('; ') : '') || geminiTranslation;
  const primaryHanja = (dictionaryEntry && dictionaryEntry.hanja) || geminiHanja;

  const activeAnalysisObj = Object.keys(fullAnalysis).length > 0 ? fullAnalysis : quickAnalysis;

  const ctx = {
    word: data.word || '',
    base: dictionaryEntry.base || fullAnalysis.base || quickAnalysis.base || data.word || '',
    pos: dictionaryEntry.pos || fullAnalysis.pos || quickAnalysis.pos || '',
    definition: primaryDef,
    translation: geminiTranslation || primaryDef,
    grammar: geminiGrammar || activeAnalysisObj.notes || dictionaryEntry.grammar_notes || '',
    hanja: primaryHanja,
    notes: activeAnalysisObj.notes || dictionaryEntry.grammar_notes || '',
    sentence: data.sentence || '',
    prevSentence: data.prevSentence || '',
    prevSentence2: data.prevSentence2 || '',
    candidate: data.candidate || '',
    analysisJson: rawAnalysis && Object.keys(rawAnalysis).length > 0 ? JSON.stringify(rawAnalysis, null, 2) : (rawQuick && Object.keys(rawQuick).length > 0 ? JSON.stringify(rawQuick, null, 2) : '')
  };

  if (activeAnalysisObj && typeof activeAnalysisObj === 'object') {
    Object.keys(activeAnalysisObj).forEach((key) => {
      if (!(key in ctx)) {
        const val = activeAnalysisObj[key];
        ctx[key] = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
      }
    });
  }

  return ctx;
}

function renderDefinitionText(context) {
  const parts = [context.definition, context.translation, context.grammar].filter(Boolean);
  return parts.join('\n\n').trim();
}

function renderTemplate(template, context) {
  let result = String(template || '');
  Object.keys(context).forEach((key) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
    result = result.replace(regex, context[key] !== undefined && context[key] !== null ? String(context[key]) : '');
  });
  return result.replace(/\{\{[^}]+\}\}/g, '');
}

async function callAnkiConnect(baseUrl, action, params) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params })
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error);
  }

  return result.result;
}

function handleContextSummarization(rawText, sendResponse) {
  chrome.storage.local.get(['apiKey', 'modelId', 'useFullContext', 'enableCheaperSummaryModel', 'cheaperSummaryModelId'], async (config) => {
    try {
      if (!config.apiKey) {
        sendResponse({ error: 'Gemini API key is not configured.' });
        return;
      }

      const activeModelId = (config.enableCheaperSummaryModel && config.cheaperSummaryModelId)
        ? config.cheaperSummaryModelId.trim()
        : (config.modelId || DEFAULT_MODEL_ID);

      let textToSummarize = rawText || '';
      if (!config.useFullContext && textToSummarize.length > 3000) {
        const head = textToSummarize.slice(0, 2000);
        const tail = textToSummarize.slice(-1000);
        textToSummarize = `${head}\n\n[... middle section abbreviated for token efficiency ...]\n\n${tail}`;
      } else if (textToSummarize.length > 8000) {
        textToSummarize = textToSummarize.slice(0, 8000);
      }

      const prompt = `Summarize the following text from a webpage/subtitle track into a clear, concise background summary (key entities, main topic, setting, and plot/overview) to serve as linguistic context for analyzing Korean sentences in this document. Keep the summary focused and under 400 words.\n\nText:\n${textToSummarize}`;
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${activeModelId}:generateContent?key=${config.apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        sendResponse({ error: `Summarization API error (${activeModelId}): ${response.statusText}`, details: errText });
        return;
      }

      const json = await response.json();
      const summaryText = json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
      sendResponse({
        summary: summaryText || textToSummarize.slice(0, 1000),
        rawCharCount: (rawText || '').length,
        charCount: textToSummarize.length,
        useFullContext: Boolean(config.useFullContext)
      });
    } catch (err) {
      sendResponse({ error: `Summarization failed: ${err.message}` });
    }
  });
}
