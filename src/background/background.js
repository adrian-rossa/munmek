function ensureDictionaryDbLoaded() {
  if (typeof self !== 'undefined' && typeof self.DictionaryDB !== 'undefined') return true;
  if (typeof globalThis !== 'undefined' && typeof globalThis.DictionaryDB !== 'undefined') return true;
  try {
    if (typeof importScripts === 'function') {
      importScripts('../nlp/dictionary_db.js');
    }
    return (typeof self !== 'undefined' && typeof self.DictionaryDB !== 'undefined') || (typeof globalThis !== 'undefined' && typeof globalThis.DictionaryDB !== 'undefined');
  } catch (e) {
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
2. For "base", provide ONLY the clean Korean dictionary citation form (e.g. "부르다", NOT "부르다 (to call)"). Do not include English glosses, notes, or parentheses in "base".
3. Ground "grammar_notes" in the actual context of the surrounding sentences and scene.

Return JSON with "words_analysis": [{
  "surface": "{WORD}",
  "base": "clean Korean citation lemma without English gloss or parentheses (e.g. 부르다)",
  "pos": "part of speech",
  "definitions": ["definition in context"],
  "conjugation": { "ending": "...", "explanation": "..." },
  "grammar_notes": "contextual breakdown based on scene/sentence context",
  "id": "1"
}]`;

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get([
      'aiProvider',
      'modelId',
      'customEndpointUrl',
      'customModelId',
      'customApiKey',
      'autoTriggerAiOnHover',
      'customDisableReasoning',
      'customTemperature',
      'customTopP',
      'customTopK',
      'customMinP',
      'customRepeatPenalty',
      'customPresencePenalty',
      'ankiConnectUrl',
      'ankiDeckName',
      'ankiNoteType',
      'ankiFieldMapping',
      'ankiDefinitionField',
      'enableOnnxReranker',
      'enableWebGpu'
    ], (result) => {
      const defaults = {};
      if (!result.aiProvider) defaults.aiProvider = 'custom';
      if (!result.modelId) defaults.modelId = DEFAULT_MODEL_ID;
      if (!result.customEndpointUrl) defaults.customEndpointUrl = 'http://localhost:1234/v1';
      if (!result.customModelId) defaults.customModelId = 'llama-3.2-3b-instruct';
      if (result.customApiKey === undefined) defaults.customApiKey = '';
      if (typeof result.autoTriggerAiOnHover !== 'boolean') defaults.autoTriggerAiOnHover = false;
      if (typeof result.customDisableReasoning !== 'boolean') defaults.customDisableReasoning = false;
      if (result.customTemperature === undefined) defaults.customTemperature = '0.2';
      if (result.customTopP === undefined) defaults.customTopP = '0.9';
      if (result.customTopK === undefined) defaults.customTopK = '40';
      if (result.customMinP === undefined) defaults.customMinP = '0.05';
      if (result.customRepeatPenalty === undefined) defaults.customRepeatPenalty = '1.1';
      if (result.customPresencePenalty === undefined) defaults.customPresencePenalty = '0.0';
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
}

const activeSessionTabIds = new Set();
const activeTabContexts = {};
let offscreenCreating = null;

if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    activeSessionTabIds.delete(tabId);
    delete activeTabContexts[tabId];
  });
}

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

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'analyzeKoreanTextWasm') {
      handleWasmAnalysisRequest(request, sendResponse);
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

    if (request.type === 'askGeminiFollowup') {
      handleFollowupAiRequest(request.data, sendResponse, sender);
      return true;
    }

    if (request.type === 'testAiEndpoint') {
      handleTestAiEndpoint(request.data, sendResponse);
      return true;
    }

    if (request.type === 'createAnkiCard') {
      handleAnkiCardRequest(request.data, sendResponse);
      return true;
    }

    if (request.type === 'clearDictCache') {
      if (typeof self !== 'undefined' && typeof self.DictionaryDB !== 'undefined' && typeof self.DictionaryDB.invalidateDictMapCache === 'function') {
        self.DictionaryDB.invalidateDictMapCache();
      }
      sendResponse({ success: true });
      return true;
    }

    if (request.type === 'dictionaryLookup') {
      if (!ensureDictionaryDbLoaded() || !(typeof self !== 'undefined' && self.DictionaryDB)) {
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

    if (request.type === 'getTabSessionStatus') {
      const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
      const isActive = tabId ? activeSessionTabIds.has(tabId) : false;
      const context = tabId ? activeTabContexts[tabId] : null;
      sendResponse({ isActive, context });
      return true;
    }

    if (request.type === 'startTabSession') {
      const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
      if (tabId) {
        activeSessionTabIds.add(tabId);
        if (typeof chrome !== 'undefined' && chrome.action && chrome.action.setBadgeText) {
          chrome.action.setBadgeText({ tabId, text: 'ON' });
          chrome.action.setBadgeBackgroundColor({ tabId, color: '#2e7d32' });
        }
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
          chrome.tabs.sendMessage(tabId, { type: 'setTabSessionActive', isActive: true }).catch(() => {});
        }
      }
      sendResponse({ success: true, isActive: true, tabId });
      return true;
    }

    if (request.type === 'stopTabSession') {
      const tabId = request.tabId || (sender.tab ? sender.tab.id : null);
      if (tabId) {
        activeSessionTabIds.delete(tabId);
        delete activeTabContexts[tabId];
        if (typeof chrome !== 'undefined' && chrome.action && chrome.action.setBadgeText) {
          chrome.action.setBadgeText({ tabId, text: '' });
        }
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
          chrome.tabs.sendMessage(tabId, { type: 'setTabSessionActive', isActive: false }).catch(() => {});
        }
      }
      sendResponse({ success: true, isActive: false, tabId });
      return true;
    }

    if (request.type === 'setTabContext') {
      const tabId = sender.tab ? sender.tab.id : request.tabId;
      if (tabId) {
        activeTabContexts[tabId] = {
          name: request.name || 'Custom Context',
          text: request.text || '',
          summary: request.summary || request.text || '',
          siteType: request.siteType || 'custom',
          title: request.title || request.name || 'Context'
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

    if (request.type === 'fetchAndSummarizeContext') {
      handleFetchAndSummarizeContext(request, sender, sendResponse);
      return true;
    }

    if (request.type === 'summarizeContext') {
      handleSummarizeContextOnly(request, sendResponse);
      return true;
    }

    return false;
  });
}

function handleRerankCandidatesRequest(candidates, sentenceContext, sendResponse) {
  chrome.storage.local.get(['enableOnnxReranker'], async (result) => {
    const isEnabled = typeof result.enableOnnxReranker === 'boolean' ? result.enableOnnxReranker : false;
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
    const isEnabled = typeof result.enableOnnxReranker === 'boolean' ? result.enableOnnxReranker : false;
    const enableWebGpu = typeof result.enableWebGpu === 'boolean' ? result.enableWebGpu : false;
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

function handleWasmAnalysisRequest(requestData, sendResponse) {
  (async () => {
    try {
      const text = typeof requestData === 'string' ? requestData : (requestData?.text || '');
      const targetWord = typeof requestData === 'object' ? (requestData?.targetWord || requestData?.word || '') : '';
      const response = await sendToOffscreenWithRetry({
        type: 'OFFSCREEN_ANALYZE_KOREAN',
        text,
        targetWord
      });
      sendResponse(response);
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
}

function normalizeOpenAiEndpointUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  url = url.replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) {
    return url;
  }
  if (url.endsWith('/v1')) {
    return `${url}/chat/completions`;
  }
  return `${url}/v1/chat/completions`;
}

function getOpenAiModelsUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  url = url.replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) {
    url = url.substring(0, url.length - '/chat/completions'.length);
  }
  if (url.endsWith('/v1')) {
    return `${url}/models`;
  }
  return `${url}/v1/models`;
}

function extractAndParseJson(text) {
  if (typeof text !== 'string') {
    throw new Error('Response is not a string');
  }
  let clean = text.trim();

  // Strip <think>...</think> blocks from reasoning models (e.g. DeepSeek-R1, QwQ)
  clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 1. Direct JSON parse
  try {
    return JSON.parse(clean);
  } catch (e) {}

  // 2. Markdown code block
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {}
  }

  // 3. Outermost object { ... }
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonSub = clean.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(jsonSub);
    } catch (e) {}
  }

  // 4. Outermost array [ ... ]
  const firstBracket = clean.indexOf('[');
  const lastBracket = clean.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const jsonSub = clean.substring(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(jsonSub);
    } catch (e) {}
  }

  throw new Error(`Failed to extract valid JSON from AI output: ${clean.slice(0, 120)}...`);
}

async function callAiChatCompletion({ promptText, systemInstruction, config }) {
  const provider = config.aiProvider || 'gemini';

  if (provider === 'custom') {
    const endpointUrl = normalizeOpenAiEndpointUrl(config.customEndpointUrl || 'http://localhost:1234/v1');
    if (!endpointUrl) {
      throw new Error('Custom OpenAI endpoint URL is not configured. Open extension settings.');
    }
    const modelId = (config.customModelId || '').trim() || 'local-model';
    const headers = { 'Content-Type': 'application/json' };
    if (config.customApiKey && config.customApiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.customApiKey.trim()}`;
    }

    const messages = [];
    if (systemInstruction && systemInstruction.trim()) {
      messages.push({ role: 'system', content: systemInstruction.trim() });
    }
    messages.push({ role: 'user', content: promptText });

    const payload = {
      model: modelId,
      messages,
      response_format: { type: 'json_object' }
    };

    // Sampling parameters
    if (config.customTemperature !== undefined && config.customTemperature !== '' && !isNaN(Number(config.customTemperature))) {
      payload.temperature = Number(config.customTemperature);
    } else {
      payload.temperature = 0.2;
    }

    if (config.customTopP !== undefined && config.customTopP !== '' && !isNaN(Number(config.customTopP))) {
      payload.top_p = Number(config.customTopP);
    }

    if (config.customTopK !== undefined && config.customTopK !== '' && !isNaN(Number(config.customTopK))) {
      payload.top_k = Number(config.customTopK);
    }

    if (config.customMinP !== undefined && config.customMinP !== '' && !isNaN(Number(config.customMinP))) {
      payload.min_p = Number(config.customMinP);
    }

    if (config.customRepeatPenalty !== undefined && config.customRepeatPenalty !== '' && !isNaN(Number(config.customRepeatPenalty))) {
      payload.repeat_penalty = Number(config.customRepeatPenalty);
    }

    if (config.customPresencePenalty !== undefined && config.customPresencePenalty !== '' && !isNaN(Number(config.customPresencePenalty))) {
      payload.presence_penalty = Number(config.customPresencePenalty);
    }

    // Toggle off reasoning / thinking tokens for reasoning models (DeepSeek-R1 / QwQ / o-series)
    if (config.customDisableReasoning) {
      payload.reasoning_effort = 'none';
      payload.enable_thinking = false;
      payload.chat_template_kwargs = { enable_thinking: false };
    }

    let response;
    try {
      response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
    } catch (fetchErr) {
      throw new Error(`Failed to connect to custom AI endpoint at ${endpointUrl}: ${fetchErr.message}`);
    }

    // If 400 error occurs (some local backends don't accept response_format), retry without response_format
    if (!response.ok && response.status === 400) {
      try {
        const retryPayload = { ...payload };
        delete retryPayload.response_format;
        const retryResponse = await fetch(endpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(retryPayload)
        });
        if (retryResponse.ok) {
          response = retryResponse;
        }
      } catch (retryErr) {}
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Custom AI endpoint returned HTTP ${response.status}: ${errText}`);
    }

    const resJson = await response.json();
    const content = resJson.choices?.[0]?.message?.content || resJson.choices?.[0]?.text;
    if (!content) {
      throw new Error('Empty response content received from custom AI endpoint.');
    }

    return extractAndParseJson(content);
  } else {
    // Gemini
    if (!config.apiKey) {
      throw new Error('Gemini API Key is not configured. Open the extension settings first.');
    }
    const modelId = config.modelId || DEFAULT_MODEL_ID;
    const bodyData = {
      contents: [
        {
          parts: [
            { text: promptText }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    };

    if (systemInstruction && systemInstruction.trim()) {
      bodyData.systemInstruction = {
        parts: [
          { text: systemInstruction.trim() }
        ]
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${config.apiKey}`;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });
    } catch (fetchErr) {
      throw new Error(`Failed to connect to Gemini API: ${fetchErr.message}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API request failed with status ${response.status}: ${errorText}`);
    }

    const resJson = await response.json();
    const textContent = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      throw new Error('Empty response text from Gemini API.');
    }

    return extractAndParseJson(textContent);
  }
}

function handleSentenceAnalysisRequest(data, sendResponse, sender) {
  chrome.storage.local.get([
    'aiProvider',
    'apiKey',
    'modelId',
    'customEndpointUrl',
    'customModelId',
    'customApiKey',
    'customDisableReasoning',
    'customTemperature',
    'customTopP',
    'customTopK',
    'customMinP',
    'customRepeatPenalty',
    'customPresencePenalty',
    'aiPromptExtension'
  ], async (config) => {
    try {
      const provider = config.aiProvider || 'gemini';
      if (provider === 'gemini' && (!config.apiKey || !config.modelId)) {
        sendResponse({ error: 'Gemini API key or model ID is not configured. Open the extension settings first.' });
        return;
      }
      if (provider === 'custom' && !config.customEndpointUrl) {
        sendResponse({ error: 'Custom AI Endpoint URL is not configured. Open the extension settings first.' });
        return;
      }

      const tabId = sender && sender.tab ? sender.tab.id : (data && data.tabId ? data.tabId : null);
      const activeCtx = tabId ? activeTabContexts[tabId] : null;

      let systemInstruction = 'You are a precise Korean language assistant.';
      let promptText = DEFAULT_PROMPT
        .replace('{WORD}', data.word || '')
        .replace('{SENTENCE}', data.sentence || '')
        .replace('{PREV_SENTENCE}', data.prevSentence || '')
        .replace('{PREV_SENTENCE2}', data.prevSentence2 || '');

      let targetLangStr = 'English';
      if (data && data.responseLanguage && typeof data.responseLanguage === 'string' && data.responseLanguage.trim()) {
        targetLangStr = data.responseLanguage.trim();
      }
      systemInstruction += ` Please provide all definitions, explanations, translations, and notes in ${targetLangStr}.`;
      if (targetLangStr !== 'English') {
        promptText += `\n\nCRITICAL LANGUAGE INSTRUCTION: All content in "definitions" and "grammar_notes" MUST be written in ${targetLangStr}.`;
      }

      if (activeCtx && (activeCtx.summary || activeCtx.text)) {
        const ctxSummary = (activeCtx.summary || activeCtx.text).trim();
        systemInstruction += ` Active Media/Scene Context (${activeCtx.name || activeCtx.title || 'Tab'}): ${ctxSummary}`;
      }

      if (config.aiPromptExtension && config.aiPromptExtension.trim()) {
        const ext = config.aiPromptExtension.trim();
        systemInstruction += ` Additional user instruction: ${ext}`;

        const reservedWords = new Set([
          'and', 'the', 'for', 'with', 'from', 'words', 'analysis', 'rules',
          'words_analysis', 'pos', 'surface', 'base', 'definitions', 'grammar_notes',
          'conjugation', 'sentence', 'context', 'korean', 'return', 'only', 'valid', 'json',
          'string', 'array', 'object', 'number', 'boolean', 'field', 'fields', 'value', 'values',
          'custom', 'extra', 'additional', 'following', 'containing', 'translation', 'definition'
        ]);

        const customFieldMatches = [
          ...ext.matchAll(/[\("'`]\s*([a-zA-Z0-9_]{3,40})\s*[\)"'`]/g),
          ...ext.matchAll(/\{\{([a-zA-Z0-9_]{3,40})\}\}/g),
          ...ext.matchAll(/["'`]?([a-zA-Z0-9_]{3,40})["'`]?\s*:/g),
          ...ext.matchAll(/(?:field|key|named)\s+(?:for\s+|of\s+|a\s+|an\s+)?["'`]?([a-zA-Z0-9_]{3,40})["'`]?/gi),
          ...ext.matchAll(/["'`(]?([a-zA-Z0-9_]{3,40})["'`)']?\s+(?:field|key)\b/gi),
          ...ext.matchAll(/\b([a-z][a-z0-9_]{2,30}_(?:translation|def|definition|meaning|field|note|nuance|romaji|reading|kana|kanji))\b/gi)
        ]
          .map(m => m[1])
          .filter(k => !reservedWords.has(k.toLowerCase()))
          .filter(k => k.includes('_') || /^[a-z]+[A-Z]/.test(k) || ['nuance', 'reading', 'hanja', 'synopsis', 'etymology', 'pitch', 'romaji'].includes(k.toLowerCase()));

        const allCustomKeys = Array.from(new Set(customFieldMatches));
        if (allCustomKeys.length > 0) {
          systemInstruction += ` You MUST include the following custom field(s) in each object of your "words_analysis" JSON array (or at the root of your JSON response): ${allCustomKeys.map(k => `"${k}"`).join(', ')}.`;
          promptText += `\n\nUser Instruction: ${ext}\nRequired extra fields in each "words_analysis" item: ${allCustomKeys.map(k => `"${k}": "..."`).join(', ')}`;
        } else {
          promptText += `\n\nUser Instruction: ${ext}`;
        }
      }

      const parsedData = await callAiChatCompletion({
        promptText,
        systemInstruction,
        config
      });

      if (parsedData && typeof parsedData === 'object') {
        try {
          Object.defineProperty(parsedData, '_responseLanguage', {
            value: targetLangStr,
            enumerable: false,
            writable: true,
            configurable: true
          });
        } catch (_) {
          parsedData._responseLanguage = targetLangStr;
        }
      }

      sendResponse({ data: parsedData });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });
}

function boundedMapSet(map, key, value, maxSize = 500) {
  if (map.size >= maxSize) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
  map.set(key, value);
}

const quickLlmBackgroundCache = new Map();

function handleQuickGeminiFallback(data, sendResponse, sender) {
  const cacheKey = `${data?.word || ''}__${data?.sentence || ''}`;
  if (quickLlmBackgroundCache.has(cacheKey)) {
    sendResponse({ data: quickLlmBackgroundCache.get(cacheKey) });
    return;
  }

  chrome.storage.local.get([
    'aiProvider',
    'apiKey',
    'modelId',
    'customEndpointUrl',
    'customModelId',
    'customApiKey',
    'customDisableReasoning',
    'customTemperature',
    'customTopP',
    'customTopK',
    'customMinP',
    'customRepeatPenalty',
    'customPresencePenalty'
  ], async (config) => {
    try {
      const provider = config.aiProvider || 'gemini';
      if (provider === 'gemini' && (!config.apiKey || !config.modelId)) {
        sendResponse({ error: 'Gemini API Key or Model is not configured.' });
        return;
      }
      if (provider === 'custom' && !config.customEndpointUrl) {
        sendResponse({ error: 'Custom AI Endpoint URL is not configured.' });
        return;
      }

      const tabId = sender && sender.tab ? sender.tab.id : (data && data.tabId ? data.tabId : null);
      const activeCtx = tabId ? activeTabContexts[tabId] : null;

      let targetLangStr = 'English';
      if (data && data.responseLanguage && typeof data.responseLanguage === 'string' && data.responseLanguage.trim()) {
        targetLangStr = data.responseLanguage.trim();
      }

      let prompt = `Return ONLY valid JSON (no markdown backticks or commentary): {"definitions":["definition in ${targetLangStr}"],"pos":"part of speech","grammar_notes":"usage note"}
Analyze the Korean word '${data.word}' in sentence: '${data.sentence || ''}'`;

      if (activeCtx && (activeCtx.summary || activeCtx.text)) {
        prompt += `\nMedia Context: ${(activeCtx.summary || activeCtx.text).trim()}`;
      }

      const systemInstruction = `You are a concise Korean vocabulary assistant. Always respond in valid JSON format only. All explanations in ${targetLangStr}.`;

      const parsed = await callAiChatCompletion({
        promptText: prompt,
        systemInstruction,
        config
      });

      boundedMapSet(quickLlmBackgroundCache, cacheKey, parsed, 500);
      sendResponse({ data: parsed });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });
}

function handleFollowupAiRequest(data, sendResponse, sender) {
  if (!data || !data.question) {
    sendResponse({ error: 'No question provided.' });
    return;
  }

  chrome.storage.local.get([
    'aiProvider',
    'apiKey',
    'modelId',
    'customEndpointUrl',
    'customModelId',
    'customApiKey'
  ], async (config) => {
    try {
      const provider = config.aiProvider || 'gemini';
      if (provider === 'gemini' && (!config.apiKey || !config.modelId)) {
        sendResponse({ error: 'Gemini API Key or Model is not configured.' });
        return;
      }
      if (provider === 'custom' && !config.customEndpointUrl) {
        sendResponse({ error: 'Custom AI Endpoint URL is not configured.' });
        return;
      }

      let targetLangStr = 'English';
      if (data && data.responseLanguage && typeof data.responseLanguage === 'string' && data.responseLanguage.trim()) {
        targetLangStr = data.responseLanguage.trim();
      }

      const prompt = `Student is learning Korean and asked a follow-up question.
Target Word: ${data.word || ''}
Target Sentence: ${data.sentence || ''}
Context/Previous Explanation: ${typeof data.previousAnalysis === 'object' ? JSON.stringify(data.previousAnalysis) : (data.previousAnalysis || '')}

Student Question: ${data.question}

Please answer the student's question clearly, concisely, and helpfully in ${targetLangStr}.`;

      const systemInstruction = `You are a friendly and expert Korean language pair tutor. Provide direct, helpful, concise answers to learner questions in ${targetLangStr}.`;

      if (provider === 'custom') {
        const endpointUrl = normalizeOpenAiEndpointUrl(config.customEndpointUrl || 'http://localhost:1234/v1');
        const headers = { 'Content-Type': 'application/json' };
        if (config.customApiKey && config.customApiKey.trim()) {
          headers['Authorization'] = `Bearer ${config.customApiKey.trim()}`;
        }
        const payload = {
          model: config.customModelId || 'default',
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3
        };
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Custom AI endpoint returned HTTP ${response.status}: ${errText}`);
        }
        const resJson = await response.json();
        const content = resJson.choices?.[0]?.message?.content || resJson.choices?.[0]?.text || '';
        sendResponse({ data: { answer: content.trim() } });
      } else {
        const modelId = config.modelId || DEFAULT_MODEL_ID;
        const bodyData = {
          contents: [{ parts: [{ text: prompt }] }]
        };
        if (systemInstruction) {
          bodyData.systemInstruction = { parts: [{ text: systemInstruction }] };
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${config.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyData)
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API request failed with HTTP ${response.status}: ${errText}`);
        }
        const resJson = await response.json();
        const textContent = resJson.candidates?.[0]?.content?.parts?.[0]?.text || '';
        sendResponse({ data: { answer: textContent.trim() } });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });
}

async function testAiModelsEndpoint(config) {
  const provider = config?.aiProvider || 'gemini';

  if (provider === 'custom') {
    const modelsUrl = getOpenAiModelsUrl(config.customEndpointUrl || 'http://localhost:1234/v1');
    if (!modelsUrl) {
      throw new Error('Custom OpenAI endpoint URL is not configured.');
    }
    const headers = { 'Content-Type': 'application/json' };
    if (config.customApiKey && config.customApiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.customApiKey.trim()}`;
    }

    let response;
    try {
      response = await fetch(modelsUrl, {
        method: 'GET',
        headers
      });
    } catch (fetchErr) {
      throw new Error(`Failed to connect to custom AI endpoint at ${modelsUrl}: ${fetchErr.message}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Custom AI endpoint returned HTTP ${response.status}: ${errText}`);
    }

    const resJson = await response.json();
    const rawList = resJson.data || resJson.models || (Array.isArray(resJson) ? resJson : []);
    const modelIds = rawList.map(m => (typeof m === 'string' ? m : (m.id || m.name || ''))).filter(Boolean);
    return {
      success: true,
      endpoint: modelsUrl,
      count: modelIds.length,
      models: modelIds
    };
  } else {
    // Gemini provider
    if (!config.apiKey) {
      throw new Error('Gemini API key is not configured.');
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${config.apiKey}`;
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (fetchErr) {
      throw new Error(`Failed to connect to Gemini API: ${fetchErr.message}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API returned HTTP ${response.status}: ${errText}`);
    }

    const resJson = await response.json();
    const rawList = resJson.models || [];
    const modelIds = rawList.map(m => (m.name || '').replace(/^models\//, '')).filter(Boolean);
    return {
      success: true,
      count: modelIds.length,
      models: modelIds
    };
  }
}

function handleTestAiEndpoint(data, sendResponse) {
  const config = data || {};
  testAiModelsEndpoint(config)
    .then((result) => {
      sendResponse(result);
    })
    .catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
}

function handleAnkiCardRequest(data, sendResponse) {
  chrome.storage.local.get(['ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping', 'ankiDefinitionField'], async (config) => {
    try {
      const ankiUrl = config.ankiConnectUrl || 'http://127.0.0.1:8765';
      const deckName = config.ankiDeckName || 'Korean';
      const noteType = config.ankiNoteType || 'Basic';
      const defField = config.ankiDefinitionField || 'Back';

      const rawEntry = data.dictionaryEntry || {};
      const analysis = data.analysis || {};
      const candidate = data.candidate || {};
      const quickFallback = data.quickFallback || {};

      // Resolve definition
      let resolvedDef = data.selectedDefinition || data.definition || '';
      if (!resolvedDef && Array.isArray(rawEntry.definitions) && rawEntry.definitions.length > 0) {
        resolvedDef = rawEntry.definitions.join('<br>');
      } else if (!resolvedDef && typeof rawEntry.definition === 'string') {
        resolvedDef = rawEntry.definition;
      } else if (!resolvedDef && analysis.definition) {
        resolvedDef = analysis.definition;
      } else if (!resolvedDef && Array.isArray(analysis.words_analysis) && analysis.words_analysis[0]) {
        const w0 = analysis.words_analysis[0];
        if (Array.isArray(w0.definitions) && w0.definitions.length > 0) {
          resolvedDef = w0.definitions.join('<br>');
        } else if (w0.definition) {
          resolvedDef = w0.definition;
        }
      } else if (!resolvedDef && quickFallback.definition) {
        resolvedDef = quickFallback.definition;
      } else if (!resolvedDef && Array.isArray(quickFallback.definitions) && quickFallback.definitions.length > 0) {
        resolvedDef = quickFallback.definitions.join('<br>');
      }

      // Resolve candidate text
      const candidateText = (typeof data.candidate === 'string')
        ? data.candidate
        : (candidate?.text || candidate?.word || data.dictionaryMatch || '');

      // Resolve word, surface, base
      const word = data.word || data.surface || candidateText || rawEntry.surface || '';
      const base = data.base || rawEntry.base || candidateText || rawEntry.surface || word;
      const surface = data.surface || data.word || word;

      // Resolve hanja, pos, grammar, translation, reading, sentence, preceding sentences
      let hanja = data.hanja || rawEntry.hanja || analysis.hanja || '';
      let pos = data.pos || rawEntry.pos || analysis.pos || candidate.posHint || '';
      let grammar = data.grammar || data.grammarNotes || analysis.grammarNotes || analysis.grammar || '';
      let translation = data.translation || analysis.translation || quickFallback.translation || '';
      const reading = data.reading || data.pronunciation || rawEntry.reading || '';
      const sentence = data.sentence || '';
      const prevSentence = data.prevSentence || '';
      const prevSentence2 = data.prevSentence2 || '';

      if (Array.isArray(analysis.words_analysis) && analysis.words_analysis[0]) {
        const w0 = analysis.words_analysis[0];
        if (!grammar && (w0.grammar_notes || w0.grammar)) grammar = w0.grammar_notes || w0.grammar;
        if (!translation && w0.translation) translation = w0.translation;
        if (!pos && w0.pos) pos = w0.pos;
        if (!hanja && w0.hanja) hanja = w0.hanja;
      }

      let fields = {};
      if (config.ankiFieldMapping) {
        try {
          const mapping = JSON.parse(config.ankiFieldMapping);
          for (const [key, valTemplate] of Object.entries(mapping)) {
            let filled = String(valTemplate)
              .replace(/\{\{word\}\}/g, word)
              .replace(/\{\{surface\}\}/g, surface)
              .replace(/\{\{base\}\}/g, base)
              .replace(/\{\{candidate\}\}/g, candidateText)
              .replace(/\{\{definition\}\}/g, resolvedDef)
              .replace(/\{\{definitions\}\}/g, resolvedDef)
              .replace(/\{\{translation\}\}/g, translation)
              .replace(/\{\{sentence\}\}/g, sentence)
              .replace(/\{\{prevSentence\}\}/g, prevSentence)
              .replace(/\{\{prevSentence2\}\}/g, prevSentence2)
              .replace(/\{\{grammar\}\}/g, grammar)
              .replace(/\{\{grammarNotes\}\}/g, grammar)
              .replace(/\{\{pos\}\}/g, pos)
              .replace(/\{\{hanja\}\}/g, hanja)
              .replace(/\{\{reading\}\}/g, reading)
              .replace(/\{\{pronunciation\}\}/g, reading);

            // Replace dynamic custom prompt fields from analysis and words_analysis[0] if present
            if (analysis && typeof analysis === 'object') {
              const checkObjects = [analysis];
              if (Array.isArray(analysis.words_analysis) && analysis.words_analysis[0]) {
                checkObjects.push(analysis.words_analysis[0]);
              }
              if (Array.isArray(analysis.words) && analysis.words[0]) {
                checkObjects.push(analysis.words[0]);
              }
              if (analysis.data && typeof analysis.data === 'object') {
                checkObjects.push(analysis.data);
              }

              for (const obj of checkObjects) {
                for (const [aKey, aVal] of Object.entries(obj)) {
                  if (typeof aVal === 'string' || typeof aVal === 'number') {
                    const reg = new RegExp(`\\{\\{${aKey}\\}\\}`, 'g');
                    filled = filled.replace(reg, String(aVal));
                  } else if (Array.isArray(aVal) && aVal.every(v => typeof v === 'string')) {
                    const reg = new RegExp(`\\{\\{${aKey}\\}\\}`, 'g');
                    filled = filled.replace(reg, aVal.join('; '));
                  }
                }
              }
            }

            // Strip any remaining unreplaced {{...}} placeholders so raw tags don't leak to Anki
            filled = filled.replace(/\{\{[a-zA-Z0-9_-]+\}\}/g, '').trim();
            fields[key] = filled;
          }
        } catch (e) {
          console.warn('[Munmek Anki] Failed to parse custom mapping, using default fields:', e);
        }
      }

      if (Object.keys(fields).length === 0) {
        fields = {
          Front: word,
          [defField]: `${resolvedDef}<br><br><i>${sentence}</i>`
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

function extractMetadataFromNetflixHtml(html) {
  if (!html || typeof html !== 'string') return { title: '', synopsis: '' };
  let title = '';
  let synopsis = '';

  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of jsonLdMatches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed.name && !title) title = parsed.name;
      if (parsed.description && !synopsis) synopsis = parsed.description;
    } catch (e) {}
  }

  if (!title) {
    const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogMatch) title = ogMatch[1].trim();
  }

  if (!synopsis) {
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    if (descMatch) synopsis = descMatch[1].trim();
  }

  if (!title) {
    const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleTagMatch) {
      title = titleTagMatch[1].replace(/\s*[\|\-·]\s*(Netflix|넷플릭스).*$/i, '').replace(/^(Watch|시청하기)\s+/i, '').trim();
    }
  }

  return { title, synopsis };
}

function matchBestTmdbResult(title, results) {
  if (!results || !Array.isArray(results) || results.length === 0) return null;
  const normTitle = (title || '').toLowerCase().replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u4e00-\u9faf]/gi, '');
  if (!normTitle || normTitle.length < 2 || normTitle === 'netflix' || normTitle === '넷플릭스' || normTitle === 'netflixvideo') {
    return null;
  }

  for (const item of results) {
    const itemTitle = (item.title || item.name || item.original_title || item.original_name || '').toLowerCase().replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u4e00-\u9faf]/gi, '');
    if (itemTitle && (itemTitle === normTitle || itemTitle.includes(normTitle) || normTitle.includes(itemTitle))) {
      return item;
    }
  }
  return results[0];
}

async function searchTmdbShowOrMovie(title, releaseYear, tmdbApiKey) {
  if (!tmdbApiKey || !title) return null;
  let cleanTitle = String(title).trim();

  // Strip season/episode suffixes if present in title string (e.g. "Gokusen - Season 1 - Episode 1" -> "Gokusen")
  cleanTitle = cleanTitle
    .replace(/\s*[:\-·]\s*(?:Season|시즌|S\s*\d|Episode|화|회|Ep\s*\d).*$/i, '')
    .replace(/\s+(?:S\d+E\d+|S\d+|Ep\s*\d+|E\d+|\d+화|\d+회)\b.*$/i, '')
    .trim();

  const lower = cleanTitle.toLowerCase().replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u4e00-\u9faf]/gi, '');
  if (!lower || lower === 'netflix' || lower === '넷플릭스' || lower === 'netflixvideo' || lower === 'home' || lower === '홈' || lower === 'browse' || lower === 'watch') {
    console.log('[Munmek TMDB] searchTmdbShowOrMovie aborted: title is generic or empty:', { title, cleanTitle, lower });
    return null;
  }

  console.log('[Munmek TMDB] Searching TMDB for:', { title, cleanTitle, releaseYear });

  const queryParams = new URLSearchParams({
    api_key: tmdbApiKey,
    query: cleanTitle,
    language: 'ko-KR',
    include_adult: 'false'
  });
  if (releaseYear) {
    queryParams.append('first_air_date_year', String(releaseYear));
  }

  let res = await fetch(`https://api.themoviedb.org/3/search/multi?${queryParams.toString()}`);
  if (!res.ok) {
    queryParams.set('language', 'en-US');
    res = await fetch(`https://api.themoviedb.org/3/search/multi?${queryParams.toString()}`);
  }
  if (!res.ok) {
    console.warn('[Munmek TMDB] search/multi HTTP error:', res.status, res.statusText);
    return null;
  }

  const data = await res.json();
  let results = data.results || [];
  console.log(`[Munmek TMDB] search/multi returned ${results.length} result(s)`);

  if (results.length === 0) {
    // If multi search had 0 results, retry with en-US language query
    queryParams.set('language', 'en-US');
    if (releaseYear) {
      queryParams.delete('first_air_date_year');
      queryParams.delete('year');
    }
    const retryRes = await fetch(`https://api.themoviedb.org/3/search/multi?${queryParams.toString()}`);
    if (retryRes.ok) {
      const retryData = await retryRes.json();
      results = retryData.results || [];
      console.log(`[Munmek TMDB] search/multi (en-US retry) returned ${results.length} result(s)`);
    }
  }

  if (results.length === 0) {
    // Try tv search directly
    const tvParams = new URLSearchParams({
      api_key: tmdbApiKey,
      query: cleanTitle,
      include_adult: 'false'
    });
    const tvRes = await fetch(`https://api.themoviedb.org/3/search/tv?${tvParams.toString()}`);
    if (tvRes.ok) {
      const tvData = await tvRes.json();
      results = (tvData.results || []).map(r => ({ ...r, media_type: 'tv' }));
      console.log(`[Munmek TMDB] search/tv returned ${results.length} result(s)`);
    }
  }

  if (results.length === 0) {
    console.log('[Munmek TMDB] No TMDB results found for:', cleanTitle);
    return null;
  }

  const bestMatch = matchBestTmdbResult(cleanTitle, results);
  console.log('[Munmek TMDB] Best matched TMDB item:', {
    id: bestMatch?.id,
    title: bestMatch?.title || bestMatch?.name,
    mediaType: bestMatch?.media_type
  });
  return bestMatch;
}

async function fetchTmdbDetails(tmdbId, mediaType, seasonNumber, episodeNumber, tmdbApiKey) {
  if (!tmdbApiKey || !tmdbId) return null;
  const isTv = mediaType === 'tv';

  let showDetails = null;
  let episodeDetails = null;

  try {
    const showUrl = `https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${tmdbId}?api_key=${tmdbApiKey}&language=ko-KR`;
    console.log('[Munmek TMDB] Fetching show details:', showUrl.replace(tmdbApiKey, '***'));
    let showRes = await fetch(showUrl);
    if (showRes.ok) {
      showDetails = await showRes.json();
      if (!showDetails.overview) {
        const enShowRes = await fetch(`https://api.themoviedb.org/3/${isTv ? 'tv' : 'movie'}/${tmdbId}?api_key=${tmdbApiKey}&language=en-US`);
        if (enShowRes.ok) {
          const enShow = await enShowRes.json();
          if (enShow.overview) showDetails.overview = enShow.overview;
        }
      }
    }

    if (isTv && seasonNumber && episodeNumber) {
      const epUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${tmdbApiKey}&language=ko-KR`;
      console.log('[Munmek TMDB] Fetching episode details:', epUrl.replace(tmdbApiKey, '***'));
      let epRes = await fetch(epUrl);
      if (epRes.ok) {
        episodeDetails = await epRes.json();
        if (!episodeDetails.overview) {
          const enEpRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${tmdbApiKey}&language=en-US`);
          if (enEpRes.ok) {
            const enEp = await enEpRes.json();
            if (enEp.overview) episodeDetails.overview = enEp.overview;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Munmek TMDB] Fetch details error:', err);
  }

  return { showDetails, episodeDetails };
}

async function resolveNetflixTmdbContext(netflixData, config) {
  let { title, netflixId, seasonNumber, episodeNumber, releaseYear } = netflixData || {};
  const tmdbApiKey = config.tmdbApiKey || '';

  console.log('[Munmek Netflix] resolveNetflixTmdbContext starting with:', {
    title,
    netflixId,
    seasonNumber,
    episodeNumber,
    hasDirectSynopsis: netflixData?.hasDirectSynopsis,
    hasTmdbApiKey: Boolean(tmdbApiKey)
  });

  // 0a. If title is missing, generic, or "Netflix Video", try to fetch metadata from netflix.com/title/${netflixId}
  if ((!title || title === 'Netflix Video' || /^netflix$/i.test(title)) && netflixId) {
    try {
      console.log(`[Munmek Netflix] Title missing, fetching metadata from https://www.netflix.com/title/${netflixId}...`);
      const netflixRes = await fetch(`https://www.netflix.com/title/${netflixId}`);
      if (netflixRes.ok) {
        const html = await netflixRes.text();
        const metaParsed = extractMetadataFromNetflixHtml(html);
        if (metaParsed.title) {
          title = metaParsed.title;
          netflixData.title = title;
          console.log(`[Munmek Netflix] Successfully recovered title from netflix.com/title: "${title}"`);
        }
        if (!netflixData.synopsis && metaParsed.synopsis) {
          netflixData.synopsis = metaParsed.synopsis;
          netflixData.hasDirectSynopsis = true;
          console.log(`[Munmek Netflix] Successfully recovered synopsis from netflix.com/title: "${metaParsed.synopsis.slice(0, 60)}..."`);
        }
      }
    } catch (fetchErr) {
      console.warn('[Munmek Netflix] Failed to fetch netflix.com/title:', fetchErr);
    }
  }

  // 0b. If direct synopsis was extracted from Netflix DOM / metadata, use it directly!
  if (netflixData?.hasDirectSynopsis && netflixData?.synopsis) {
    const parts = [];
    const showTitle = title || 'Netflix Video';
    const epHeader = (seasonNumber && episodeNumber)
      ? `Episode (S${seasonNumber}E${episodeNumber}): ${netflixData.episodeTitle || ''}`
      : (netflixData.episodeTitle ? `Episode: ${netflixData.episodeTitle}` : '');
    if (epHeader) parts.push(epHeader);
    parts.push(`Synopsis: ${netflixData.synopsis}`);
    if (netflixData.subtitles) {
      parts.push(`Recent Dialogue: ${netflixData.subtitles}`);
    }
    const resolved = {
      title: `${showTitle}${seasonNumber && episodeNumber ? ` S${seasonNumber}E${episodeNumber}` : ''}`,
      rawText: parts.join('\n\n'),
      directSynopsisMatched: true
    };
    console.log('[Munmek Netflix] Resolved via direct Netflix synopsis:', resolved);
    return resolved;
  }

  if (!tmdbApiKey) {
    console.log('[Munmek TMDB] No TMDB API key configured in extension settings.');
    return {
      title: title || 'Netflix Video',
      rawText: `${title || 'Netflix'} ${netflixData?.subtitles || ''} ${netflixData?.pageDetails || ''}`.trim(),
      noTmdbKey: true
    };
  }

  // 1. Check local cache
  const cachedMap = await new Promise((resolve) => {
    chrome.storage.local.get(['netflixTmdbMap'], (res) => resolve(res.netflixTmdbMap || {}));
  });

  let matchInfo = netflixId ? cachedMap[netflixId] : null;
  if (!matchInfo && title && cachedMap[title]) {
    matchInfo = cachedMap[title];
  }

  // 2. Search TMDB if not in cache
  if (!matchInfo) {
    const searchMatch = await searchTmdbShowOrMovie(title, releaseYear, tmdbApiKey);
    if (searchMatch) {
      matchInfo = {
        tmdbId: searchMatch.id,
        mediaType: searchMatch.media_type || (searchMatch.first_air_date ? 'tv' : 'movie'),
        title: searchMatch.title || searchMatch.name || title
      };
      if (netflixId) {
        cachedMap[netflixId] = matchInfo;
        chrome.storage.local.set({ netflixTmdbMap: cachedMap });
      }
    }
  }

  if (matchInfo && matchInfo.tmdbId) {
    const { showDetails, episodeDetails } = await fetchTmdbDetails(
      matchInfo.tmdbId,
      matchInfo.mediaType,
      seasonNumber,
      episodeNumber,
      tmdbApiKey
    );

    const parts = [];
    const showTitle = showDetails?.title || showDetails?.name || matchInfo.title || title;
    if (showDetails?.overview) {
      parts.push(`Show Overview: ${showDetails.overview}`);
    } else if (netflixData?.synopsis) {
      parts.push(`Netflix Synopsis: ${netflixData.synopsis}`);
    }
    if (episodeDetails?.name || episodeDetails?.overview) {
      const epHeader = `Episode (S${seasonNumber || 1}E${episodeNumber || 1}): ${episodeDetails.name || ''}`;
      parts.push(`${epHeader}\n${episodeDetails.overview || ''}`);
    }
    if (netflixData?.subtitles) {
      parts.push(`Recent Dialogue: ${netflixData.subtitles}`);
    }

    const resolved = {
      title: `${showTitle}${seasonNumber && episodeNumber ? ` S${seasonNumber}E${episodeNumber}` : ''}`,
      rawText: parts.join('\n\n') || `${showTitle} ${netflixData?.subtitles || ''}`,
      tmdbMatched: true
    };
    console.log('[Munmek TMDB] Successfully resolved TMDB context:', resolved);
    return resolved;
  }

  const fallback = {
    title: title || 'Netflix Video',
    rawText: `${title || ''} ${netflixData?.synopsis ? `Synopsis: ${netflixData.synopsis}` : ''} ${netflixData?.subtitles || ''} ${netflixData?.pageDetails || ''}`.trim(),
    tmdbMatched: false
  };
  console.log('[Munmek TMDB] Fallback without TMDB match:', fallback);
  return fallback;
}

async function fetchYouTubeTimedTextDirect(videoId) {
  if (!videoId) return '';

  try {
    const listUrl = `https://www.youtube.com/api/timedtext?type=list&v=${videoId}`;
    const listRes = await fetch(listUrl);
    if (listRes.ok) {
      const listXml = await listRes.text();
      const trackMatches = [...listXml.matchAll(/<track[^>]+>/gi)];
      if (trackMatches.length > 0) {
        const tracks = trackMatches.map(m => {
          const tag = m[0];
          const lang = (tag.match(/lang_code="([^"]+)"/) || [])[1] || '';
          const name = (tag.match(/name="([^"]+)"/) || [])[1] || '';
          const kind = (tag.match(/kind="([^"]+)"/) || [])[1] || '';
          return { lang, name, kind };
        });

        let bestTrack = tracks.find(t => t.lang === 'ko' && t.kind !== 'asr');
        if (!bestTrack) bestTrack = tracks.find(t => t.lang === 'ko');
        if (!bestTrack) bestTrack = tracks.find(t => t.lang.startsWith('ko'));
        if (!bestTrack) bestTrack = tracks.find(t => t.lang === 'en' && t.kind !== 'asr');
        if (!bestTrack) bestTrack = tracks.find(t => t.lang.startsWith('en'));
        if (!bestTrack) bestTrack = tracks[0];

        if (bestTrack) {
          const trackUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${bestTrack.lang}${bestTrack.name ? `&name=${encodeURIComponent(bestTrack.name)}` : ''}&fmt=json3`;
          const capRes = await fetch(trackUrl);
          if (capRes.ok) {
            const jsonText = await capRes.text();
            try {
              const json = JSON.parse(jsonText);
              if (json.events && Array.isArray(json.events)) {
                const lines = [];
                for (const ev of json.events) {
                  if (ev.segs && Array.isArray(ev.segs)) {
                    const line = ev.segs.map(s => s.utf8 || '').join('').trim();
                    if (line && (lines.length === 0 || lines[lines.length - 1] !== line)) {
                      lines.push(line);
                    }
                  }
                }
                if (lines.length > 0) return lines.join(' ');
              }
            } catch (e) {
              const matches = jsonText.match(/<text[^>]*>([\s\S]*?)<\/text>|<p[^>]*>([\s\S]*?)<\/p>/gi);
              if (matches) {
                const lines = matches.map(m => m.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
                if (lines.length > 0) return lines.join(' ');
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Munmek YouTube] Direct timedtext list notice:', err);
  }

  // Fallback: Scrape watch page HTML
  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    if (watchRes.ok) {
      const html = await watchRes.text();
      const match = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
      if (match) {
        const captionTracks = JSON.parse(match[1]);
        if (Array.isArray(captionTracks) && captionTracks.length > 0) {
          return await fetchYouTubeTranscript(captionTracks);
        }
      }
    }
  } catch (err) {
    console.warn('[Munmek YouTube] Watch page HTML caption scrape notice:', err);
  }

  return '';
}

async function fetchYouTubeTranscript(captionTracks) {
  if (!Array.isArray(captionTracks) || captionTracks.length === 0) return '';

  let selectedTrack = captionTracks.find(t => t.languageCode === 'ko' && t.kind !== 'asr');
  if (!selectedTrack) selectedTrack = captionTracks.find(t => t.languageCode === 'ko');
  if (!selectedTrack) selectedTrack = captionTracks.find(t => (t.languageCode || '').startsWith('ko'));
  if (!selectedTrack) selectedTrack = captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr');
  if (!selectedTrack) selectedTrack = captionTracks.find(t => (t.languageCode || '').startsWith('en'));
  if (!selectedTrack) selectedTrack = captionTracks[0];

  if (!selectedTrack || !selectedTrack.baseUrl) return '';

  try {
    const url = selectedTrack.baseUrl.includes('fmt=') ? selectedTrack.baseUrl : `${selectedTrack.baseUrl}&fmt=json3`;
    const res = await fetch(url);
    if (!res.ok) return '';

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.events && Array.isArray(json.events)) {
        const lines = [];
        for (const ev of json.events) {
          if (ev.segs && Array.isArray(ev.segs)) {
            const line = ev.segs.map(s => s.utf8 || '').join('').trim();
            if (line && (lines.length === 0 || lines[lines.length - 1] !== line)) {
              lines.push(line);
            }
          }
        }
        return lines.join(' ');
      }
    } catch (e) {
      const matches = text.match(/<text[^>]*>([\s\S]*?)<\/text>|<p[^>]*>([\s\S]*?)<\/p>/gi);
      if (matches) {
        const lines = matches.map(m =>
          m.replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .trim()
        ).filter(Boolean);
        return lines.join(' ');
      }
    }
  } catch (err) {
    console.warn('[Munmek YouTube] Failed to fetch caption track:', err);
  }
  return '';
}

async function resolveYouTubeContext(ytData) {
  const parts = [];
  const title = ytData.title || 'YouTube Video';
  parts.push(`Title: ${title}`);

  let transcript = '';
  if (ytData.captionTracks && ytData.captionTracks.length > 0) {
    transcript = await fetchYouTubeTranscript(ytData.captionTracks);
  }

  if (!transcript && ytData.videoId) {
    transcript = await fetchYouTubeTimedTextDirect(ytData.videoId);
  }

  if (transcript) {
    parts.push(`Dialogue Transcript:\n${transcript.slice(0, 1800)}`);
  } else if (ytData.subtitlesSample) {
    parts.push(`Dialogue Subtitles:\n${ytData.subtitlesSample.slice(0, 1500)}`);
  } else if (ytData.description) {
    parts.push(`Details:\n${ytData.description.slice(0, 800)}`);
  }

  return {
    title: ytData.title || 'YouTube Video',
    rawText: parts.join('\n\n')
  };
}

function parseNetflixTitleString(rawTitle) {
  let cleanDoc = String(rawTitle || '')
    .replace(/\s*[\|\-·]\s*(Netflix|넷플릭스).*$/i, '')
    .replace(/^(Watch|시청하기)\s+/i, '')
    .trim();

  const isGeneric = !cleanDoc ||
    /^netflix$/i.test(cleanDoc) ||
    /^netflix video$/i.test(cleanDoc) ||
    /^netflix\s*[:\-·]/i.test(cleanDoc) ||
    /watch tv shows online/i.test(cleanDoc) ||
    /watch movies online/i.test(cleanDoc);

  if (isGeneric) {
    return { showTitle: '', seasonNumber: null, episodeNumber: null };
  }

  let seasonNumber = null;
  let episodeNumber = null;
  let showTitle = cleanDoc;

  // Match Season and Episode (e.g. "Season 1, Episode 2" or "시즌 1 - 2화" or "S1:E2")
  const seMatch = cleanDoc.match(/(?:Season|시즌|S)\s*(\d+)[\s,:\-·]*(?:(?:Episode|E|Ep)\s*(\d+)|(\d+)\s*(?:화|회))/i);
  if (seMatch) {
    seasonNumber = parseInt(seMatch[1], 10);
    episodeNumber = parseInt(seMatch[2] || seMatch[3], 10);
    showTitle = cleanDoc.split(/[:\-·]\s*(?:Season|시즌|S\s*\d)/i)[0].trim();
  } else {
    // Match Episode only (e.g. "Episode 3" or "3화" or "Ep 3")
    const epOnlyMatch = cleanDoc.match(/(?:(?:Episode|E|Ep)\s*(\d+)|(\d+)\s*(?:화|회))/i);
    if (epOnlyMatch) {
      episodeNumber = parseInt(epOnlyMatch[1] || epOnlyMatch[2], 10);
      showTitle = cleanDoc.split(/[:\-·]\s*(?:Episode|화|회|E\s*\d|Ep\s*\d)/i)[0].trim();
    }
  }

  return { showTitle: showTitle || cleanDoc, seasonNumber, episodeNumber };
}

function parseNetflixMetadataFromTab(tabUrl, tabTitle) {
  const url = String(tabUrl || '').trim();
  const match = url.match(/\/(?:watch|title)\/(\d+)/);
  const netflixId = match ? match[1] : '';
  const { showTitle, seasonNumber, episodeNumber } = parseNetflixTitleString(tabTitle);
  return { netflixId, showTitle, seasonNumber, episodeNumber };
}

function parseYouTubeMetadataFromTab(tabUrl, tabTitle) {
  let videoId = '';
  try {
    const u = new URL(tabUrl);
    videoId = u.searchParams.get('v') || (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : '');
  } catch (e) {}
  const title = String(tabTitle || '').replace(/\s*-\s*YouTube$/i, '').trim();
  return { videoId, title };
}

async function getTabMetadata(tabId, request = {}) {
  let tab = null;
  if (typeof chrome !== 'undefined' && chrome.tabs?.get) {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      console.warn('[Munmek Context] Failed to get tab info via chrome.tabs.get:', e);
    }
  }

  const rawUrl = (tab?.url || request.tabUrl || '').toLowerCase();
  const rawTitle = tab?.title || request.tabTitle || '';

  const isNetflix = rawUrl.includes('netflix.com');
  const isYouTube = rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be');

  return {
    rawUrl,
    rawTitle,
    siteType: isNetflix ? 'netflix' : (isYouTube ? 'youtube' : 'generic'),
    netflixTabMeta: isNetflix ? parseNetflixMetadataFromTab(tab?.url || request.tabUrl, rawTitle) : null,
    youtubeTabMeta: isYouTube ? parseYouTubeMetadataFromTab(tab?.url || request.tabUrl, rawTitle) : null
  };
}

async function requestContentContext(tabId) {
  let extractRes = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'extractSiteContext' }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn(`[Munmek Context] chrome.tabs.sendMessage failed on tab ${tabId}:`, chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(res);
      }
    });
  });

  // Attempt dynamic script reinjection if content script was disconnected (e.g. extension reload)
  if (!extractRes && typeof chrome !== 'undefined' && chrome.scripting?.executeScript) {
    try {
      console.log(`[Munmek Context] Attempting to reinject content script into tab ${tabId}...`);
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/content.js']
      });
      await new Promise((r) => setTimeout(r, 150));
      extractRes = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: 'extractSiteContext' }, (res) => {
          resolve(chrome.runtime.lastError ? null : res);
        });
      });
    } catch (scriptErr) {
      console.warn('[Munmek Context] Programmatic injection failed or not permitted:', scriptErr);
    }
  }

  return extractRes;
}

async function summarizeMediaContext({ siteType, title, rawText }, config) {
  const modelToUse = (config.enableCheaperSummaryModel && config.cheaperSummaryModelId)
    ? config.cheaperSummaryModelId.trim()
    : (config.modelId || DEFAULT_MODEL_ID);

  // Keep input compact (~1,200 chars) for fast local LLM evaluation
  const cleanInput = (rawText || '').replace(/\s+/g, ' ').trim().slice(0, 1300);

  // Guard against empty or generic placeholder input to prevent LLM hallucinations
  const isGenericTitle = /^(?:netflix|netflix video|webpage|webpage content|youtube|youtube video)$/i.test(cleanInput);
  if (!cleanInput || cleanInput.length < 20 || isGenericTitle) {
    console.log('[Munmek Summary] Input text is empty or generic placeholder, skipping LLM call:', { cleanInput, siteType, title });
    if (siteType === 'netflix') {
      const showLabel = (title && !/^netflix video$/i.test(title)) ? title : 'this show';
      return `No scene synopsis or dialogue available yet for ${showLabel}. Play the video with Korean subtitles or click Refresh Context.`;
    } else if (siteType === 'youtube') {
      const videoLabel = (title && !/^youtube video$/i.test(title)) ? title : 'this video';
      return `No video captions or transcript available yet for ${videoLabel}. Click Refresh Context once video starts.`;
    }
    return 'No webpage content extracted yet. Click Refresh Context to scan page.';
  }

  const promptText = `Provide a concise 2-3 sentence situational context (<80 words) for Korean language study based on the following text:

${cleanInput}

Guidelines:
- Describe strictly what is happening, who is speaking or interacting, the core topic, and practical vocabulary themes.
- Do NOT write meta phrases like "This video", "This webpage", "This article", or "This show". Output ONLY the 2-3 sentence situational summary.`;

  const systemInstruction = 'You are a concise language learning assistant. Summarize the situational context in 2-3 concise English sentences without mentioning the media format.';

  const summaryConfig = {
    ...config,
    modelId: modelToUse
  };

  try {
    const provider = config.aiProvider || 'gemini';
    if (provider === 'custom') {
      const endpointUrl = normalizeOpenAiEndpointUrl(config.customEndpointUrl || 'http://localhost:1234/v1');
      if (!endpointUrl) return (cleanInput || '').slice(0, 200);

      const headers = { 'Content-Type': 'application/json' };
      if (config.customApiKey) headers['Authorization'] = `Bearer ${config.customApiKey.trim()}`;

      const res = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.customModelId || 'local-model',
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: promptText }
          ],
          temperature: 0.2
        })
      });
      if (res.ok) {
        const json = await res.json();
        let content = json.choices?.[0]?.message?.content || json.choices?.[0]?.text || '';
        content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (content) return content;
      }
    } else {
      if (!config.apiKey) return (cleanInput || '').slice(0, 200);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=${config.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] }
        })
      });
      if (res.ok) {
        const json = await res.json();
        const content = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (content) return content;
      }
    }
  } catch (err) {
    console.warn('[Munmek] Context summarization error:', err);
  }

  return (cleanInput || '').slice(0, 200) + '...';
}

function handleFetchAndSummarizeContext(request, sender, sendResponse) {
  const tabId = request.tabId || (sender?.tab ? sender.tab.id : null);
  if (!tabId) {
    sendResponse({ error: 'No tab ID provided.' });
    return;
  }

  chrome.storage.local.get([
    'aiProvider',
    'apiKey',
    'modelId',
    'tmdbApiKey',
    'customEndpointUrl',
    'customModelId',
    'customApiKey',
    'enableCheaperSummaryModel',
    'cheaperSummaryModelId'
  ], async (config) => {
    try {
      const tabMeta = await getTabMetadata(tabId, request);
      const extractRes = await requestContentContext(tabId);

      // Tab URL domain takes strict precedence over fallback generic
      const siteType = (tabMeta.siteType !== 'generic') ? tabMeta.siteType : (extractRes?.siteType || 'generic');

      let title = '';
      let rawText = extractRes?.text || '';
      let noTmdbKey = false;

      if (siteType === 'netflix') {
        const netContentTitle = extractRes?.netflixData?.title || extractRes?.title || '';
        const validContentTitle = (!/^netflix$|^netflix video$/i.test(netContentTitle)) ? netContentTitle : '';
        const showTitle = validContentTitle || tabMeta.netflixTabMeta?.showTitle || 'Netflix Video';

        const mergedNetflixData = {
          title: showTitle,
          netflixId: extractRes?.netflixData?.netflixId || tabMeta.netflixTabMeta?.netflixId || '',
          seasonNumber: (extractRes?.netflixData?.seasonNumber != null) ? extractRes.netflixData.seasonNumber : tabMeta.netflixTabMeta?.seasonNumber,
          episodeNumber: (extractRes?.netflixData?.episodeNumber != null) ? extractRes.netflixData.episodeNumber : tabMeta.netflixTabMeta?.episodeNumber,
          episodeTitle: extractRes?.netflixData?.episodeTitle || '',
          synopsis: extractRes?.netflixData?.synopsis || '',
          hasDirectSynopsis: Boolean(extractRes?.netflixData?.hasDirectSynopsis),
          subtitles: extractRes?.netflixData?.subtitles || '',
          pageDetails: extractRes?.netflixData?.pageDetails || ''
        };

        console.log('[Munmek Context] Resolving Netflix with merged data:', mergedNetflixData);
        const netflixResolved = await resolveNetflixTmdbContext(mergedNetflixData, config);
        title = netflixResolved.title || mergedNetflixData.title;
        rawText = netflixResolved.rawText || rawText;
        noTmdbKey = Boolean(netflixResolved.noTmdbKey);
      } else if (siteType === 'youtube') {
        const mergedYouTubeData = {
          videoId: extractRes?.youtubeData?.videoId || tabMeta.youtubeTabMeta?.videoId || '',
          title: extractRes?.youtubeData?.title || extractRes?.title || tabMeta.youtubeTabMeta?.title || 'YouTube Video',
          author: extractRes?.youtubeData?.author || '',
          description: extractRes?.youtubeData?.description || '',
          captionTracks: extractRes?.youtubeData?.captionTracks || [],
          subtitlesSample: extractRes?.youtubeData?.subtitlesSample || ''
        };
        const ytResolved = await resolveYouTubeContext(mergedYouTubeData);
        title = ytResolved.title || title;
        rawText = ytResolved.rawText || rawText;
      } else {
        title = extractRes?.title || tabMeta.rawTitle || 'Webpage';
      }

      // 2. Generate concise LLM summary
      const summary = await summarizeMediaContext({ siteType, title, rawText }, config);

      // 3. Save to active tab contexts
      const contextObj = {
        name: title,
        title: title,
        text: rawText,
        summary: summary,
        siteType: siteType,
        noTmdbKey: noTmdbKey,
        updatedAt: Date.now()
      };

      activeTabContexts[tabId] = contextObj;

      sendResponse({
        success: true,
        context: contextObj
      });
    } catch (err) {
      console.error('[Munmek] fetchAndSummarizeContext error:', err);
      sendResponse({ error: err.message });
    }
  });
}

function handleSummarizeContextOnly(request, sendResponse) {
  const text = request.text || '';
  const title = request.title || 'Context';
  const siteType = request.siteType || 'custom';

  chrome.storage.local.get([
    'aiProvider',
    'apiKey',
    'modelId',
    'customEndpointUrl',
    'customModelId',
    'customApiKey',
    'enableCheaperSummaryModel',
    'cheaperSummaryModelId'
  ], async (config) => {
    try {
      const summary = await summarizeMediaContext({ siteType, title, rawText: text }, config);
      sendResponse({ summary });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeOpenAiEndpointUrl,
    getOpenAiModelsUrl,
    extractAndParseJson,
    callAiChatCompletion,
    testAiModelsEndpoint,
    extractMetadataFromNetflixHtml,
    matchBestTmdbResult,
    searchTmdbShowOrMovie,
    fetchTmdbDetails,
    resolveNetflixTmdbContext,
    fetchYouTubeTranscript,
    resolveYouTubeContext,
    summarizeMediaContext,
    parseNetflixMetadataFromTab,
    parseYouTubeMetadataFromTab,
    parseNetflixTitleString
  };
} else if (typeof self !== 'undefined') {
  self.MunmekAI = {
    normalizeOpenAiEndpointUrl,
    getOpenAiModelsUrl,
    extractAndParseJson,
    callAiChatCompletion,
    testAiModelsEndpoint,
    extractMetadataFromNetflixHtml,
    matchBestTmdbResult,
    searchTmdbShowOrMovie,
    fetchTmdbDetails,
    resolveNetflixTmdbContext,
    fetchYouTubeTranscript,
    resolveYouTubeContext,
    summarizeMediaContext,
    parseNetflixMetadataFromTab,
    parseYouTubeMetadataFromTab,
    parseNetflixTitleString
  };
}

