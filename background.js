const DEFAULT_MODEL_ID = 'gemini-2.0-flash-lite';
const DEFAULT_PROMPT = `You are a Korean language tutor.

Return only one valid JSON object and no markdown fences.
Use the supplied word, sentence, neighboring sentences, and dictionary candidate as context.

Schema:
{
  "word": string,
  "base": string,
  "pos": string,
  "translation": string,
  "grammar": string,
  "hanja": string | null,
  "notes": string,
  "related_words": {
    "synonyms": string[],
    "antonyms": string[]
  },
  "examples": string[]
}

Keep the answer concise, accurate, and specific to the sentence context.`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['aiPrompt', 'modelId', 'ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping', 'ankiDefinitionField', 'ankiUpdateLastCard'], (result) => {
    const defaults = {};

    if (!result.aiPrompt) {
      defaults.aiPrompt = 'Focus on the target word, give the clearest context-aware meaning, and keep the output strictly in JSON.';
    }

    if (!result.modelId) {
      defaults.modelId = DEFAULT_MODEL_ID;
    }

    if (!result.ankiConnectUrl) {
      defaults.ankiConnectUrl = 'http://127.0.0.1:8765';
    }

    if (!result.ankiDeckName) {
      defaults.ankiDeckName = 'Korean';
    }

    if (!result.ankiNoteType) {
      defaults.ankiNoteType = 'Basic';
    }

    if (!result.ankiFieldMapping) {
      defaults.ankiFieldMapping = JSON.stringify({
        Front: '{{word}}',
        Back: '{{definition}}<br><br>{{translation}}<br><br>{{grammar}}'
      }, null, 2);
    }

    if (!result.ankiDefinitionField) {
      defaults.ankiDefinitionField = 'Back';
    }

    if (typeof result.ankiUpdateLastCard !== 'boolean') {
      defaults.ankiUpdateLastCard = false;
    }

    if (Object.keys(defaults).length > 0) {
      chrome.storage.local.set(defaults);
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'analyzeSentence') {
    handleSentenceAnalysisRequest(request.data, sendResponse);
    return true;
  }

  if (request.type === 'createAnkiCard') {
    handleAnkiCardRequest(request.data, sendResponse);
    return true;
  }
});

function handleSentenceAnalysisRequest(data, sendResponse) {
  chrome.storage.local.get(['apiKey', 'modelId', 'aiPrompt'], async (config) => {
    try {
      if (chrome.runtime.lastError) {
        sendResponse({ error: `Storage error: ${chrome.runtime.lastError.message}` });
        return;
      }

      if (!config.apiKey || !config.modelId) {
        sendResponse({ error: 'API key or model ID is not configured. Open the extension settings first.' });
        return;
      }

      const prompt = buildSentenceAnalysisPrompt(config.aiPrompt, data);
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

      sendResponse({ data: parsed.value });
    } catch (error) {
      sendResponse({ error: `Network or parsing error: ${error.message}` });
    }
  });
}

function handleAnkiCardRequest(data, sendResponse) {
  chrome.storage.local.get(['ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping', 'ankiDefinitionField', 'ankiUpdateLastCard', 'lastCreatedAnkiNoteId'], async (config) => {
    try {
      if (!config.ankiConnectUrl || !config.ankiDeckName || !config.ankiNoteType) {
        sendResponse({ error: 'AnkiConnect settings are incomplete. Open extension settings first.' });
        return;
      }

      const payload = buildAnkiPayload(config, data);
      const updateLastCard = Boolean(config.ankiUpdateLastCard);

      if (updateLastCard && config.lastCreatedAnkiNoteId) {
        await callAnkiConnect(config.ankiConnectUrl, 'updateNoteFields', {
          note: {
            id: Number(config.lastCreatedAnkiNoteId),
            fields: payload.fields
          }
        });

        sendResponse({ data: { updated: true, noteId: config.lastCreatedAnkiNoteId } });
        return;
      }

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

function buildSentenceAnalysisPrompt(userPrompt, data) {
  const context = {
    word: data.word || '',
    sentence: data.sentence || '',
    prevSentence: data.prevSentence || '',
    nextSentence: data.nextSentence || '',
    dictionaryCandidate: data.dictionaryEntry || null
  };

  const promptParts = [
    DEFAULT_PROMPT,
    userPrompt ? replacePromptPlaceholders(userPrompt, context) : '',
    'Context JSON:',
    JSON.stringify(context, null, 2)
  ];

  return promptParts.filter(Boolean).join('\n\n');
}

function replacePromptPlaceholders(prompt, context) {
  return prompt
    .replace(/\{WORD\}/g, context.word)
    .replace(/\{SENTENCE\}/g, context.sentence)
    .replace(/\{PREV_SENTENCE\}/g, context.prevSentence || '')
    .replace(/\{NEXT_SENTENCE\}/g, context.nextSentence || '')
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
    fields[fieldName] = renderTemplate(String(template || ''), context);
  });

  if (config.ankiUpdateLastCard) {
    const definitionField = config.ankiDefinitionField || 'Back';
    const definitionValue = renderDefinitionText(context);
    fields[definitionField] = definitionValue;
  }

  return {
    fields,
    tags: ['munmek', 'korean-lookup']
  };
}

function buildTemplateContext(data) {
  const dictionaryEntry = data.dictionaryEntry || {};
  const analysis = data.analysis || {};
  const definitions = Array.isArray(dictionaryEntry.definitions) ? dictionaryEntry.definitions : [];

  return {
    word: data.word || '',
    base: dictionaryEntry.base || analysis.base || data.word || '',
    pos: dictionaryEntry.pos || analysis.pos || '',
    definition: definitions.join('; ') || analysis.translation || analysis.definition || '',
    translation: analysis.translation || analysis.definition || '',
    grammar: analysis.grammar || analysis.grammar_notes || dictionaryEntry.grammar_notes || '',
    hanja: analysis.hanja || dictionaryEntry.hanja || '',
    notes: analysis.notes || dictionaryEntry.grammar_notes || '',
    sentence: data.sentence || '',
    prevSentence: data.prevSentence || '',
    nextSentence: data.nextSentence || '',
    candidate: data.candidate || '',
    analysisJson: analysis ? JSON.stringify(analysis, null, 2) : ''
  };
}

function renderDefinitionText(context) {
  const parts = [context.definition, context.translation, context.grammar].filter(Boolean);
  return parts.join('\n\n').trim();
}

function renderTemplate(template, context) {
  return template
    .replace(/\{\{word\}\}/gi, context.word)
    .replace(/\{\{base\}\}/gi, context.base)
    .replace(/\{\{pos\}\}/gi, context.pos)
    .replace(/\{\{definition\}\}/gi, context.definition)
    .replace(/\{\{translation\}\}/gi, context.translation)
    .replace(/\{\{grammar\}\}/gi, context.grammar)
    .replace(/\{\{hanja\}\}/gi, context.hanja)
    .replace(/\{\{notes\}\}/gi, context.notes)
    .replace(/\{\{sentence\}\}/gi, context.sentence)
    .replace(/\{\{prevSentence\}\}/gi, context.prevSentence)
    .replace(/\{\{nextSentence\}\}/gi, context.nextSentence)
    .replace(/\{\{candidate\}\}/gi, context.candidate)
    .replace(/\{\{analysisJson\}\}/gi, context.analysisJson);
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
