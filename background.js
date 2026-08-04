// Handles extension install, communication, and AI API calls

chrome.runtime.onInstalled.addListener(() => {
  console.log('Munmek - Extension installed/updated.');
  // Initialize default settings if needed, especially the AI prompt (as a starting point)
  // check if there is a prompt stored in chrome.storage, if not set this the default prompt
  chrome.storage.local.get(['aiPrompt', 'modelId'], (result) => {
    if (!result.aiPrompt) {
      chrome.storage.local.set({
        aiPrompt: `You are a Korean language expert.
Analyze the Korean word '{WORD}' within the context of the following sentence: '{SENTENCE}'.
The preceding sentence is: '{PREV_SENTENCE}'.
The subsequent sentence is: '{NEXT_SENTENCE}'.

For EACH significant Korean word in '{SENTENCE}' (not just the {WORD}), provide a JSON object with the following fields:
- "surface": The exact word form as it appears in the sentence.
- "base": The dictionary/base form of the word.
- "pos": The part of speech (e.g., "noun", "verb", "adjective", "particle", "adverb", "pronoun", "auxiliary verb/adjective").
- "definitions": An array of concise English definitions relevant to the context.
- "conjugation": (If applicable) An object with "ending" (e.g., "을", "는", "었다") and "explanation" (e.g., "object particle", "topic marker", "past tense").
- "grammar_notes": (Optional) Any brief, relevant grammar notes or disambiguation if the word is tricky.
- "id": A unique temporary ID for this analysis (e.g., "temp_w1", "temp_w2").

Return ONLY a single, valid JSON object with a key "words_analysis" which contains an array of these objects for all analyzed words in the current sentence.
Do not include any explanatory text before or after the JSON object.
Example for a single word analysis within the array:
{
  "surface": "물을",
  "base": "물",
  "pos": "noun",
  "hanja": "水",
  "definitions": ["water"],
  "conjugation": { "ending": "을", "explanation": "object particle" },
  "grammar_notes": "Indicates 'water' is the object of the verb."
}
Focus on accurate contextual disambiguation. If a word is ambiguous, choose the most likely interpretation in context for the main entry, and optionally note other possibilities in grammar_notes.`
      });
    }
    if (!result.modelId) {
        chrome.storage.local.set({ modelId: "gemini-2.0-flash-lite" }); // Default model, ideally a fast one with free usage possible
    }
  });
});

//add listener for any requests from other parts of the extension and check whether it is for getAIDef or getSrtData. 
//return true so that chrome keeps communication open when response takes time
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getAIDefinition') {
    handleAIDefinitionRequest(request.data, sendResponse);
    return true; // Indicates that the response will be sent asynchronously
  }
  if (request.type === 'getSrtData') {
    chrome.storage.local.get(['parsedSrtData', 'srtFileName'], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else if (result.parsedSrtData) {
        sendResponse({ srtData: result.parsedSrtData, srtFileName: result.srtFileName });
      } else {
        sendResponse({ srtData: null, srtFileName: null, message: "SRT data not found. Please upload an SRT file via extension options." });
      }
    });
    return true; // Indicates asynchronous response
  }
});

//receive word data and try to receive AI information using the API
async function handleAIDefinitionRequest(data, sendResponse) {
  const { word, currentSentence, prevSentence, nextSentence } = data; //creating variables necessary from data, add new const for srt story overview here when implementing in the future
//get apikey e.g from storage and if not set, show error messages
  chrome.storage.local.get(['apiKey', 'modelId', 'aiPrompt'], async (config) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: `Storage error: ${chrome.runtime.lastError.message}` });
      return;
    }
    if (!config.apiKey || !config.modelId) {
      sendResponse({ error: 'API Key or Model ID not configured. Please set them in the extension options.' });
      return;
    }
    if (!config.aiPrompt) {
      // This should ideally be set by onInstalled, but as a fallback:
      sendResponse({ error: 'AI Prompt not configured. Please check extension options or reinstall.' });
      return;
    }

    //replace the parts of the prompt so that it fits the target word and context before giving it to the AI
    let prompt = config.aiPrompt
      .replace(/{WORD}/g, word)
      .replace(/{SENTENCE}/g, currentSentence)
      .replace(/{PREV_SENTENCE}/g, prevSentence || "N/A")
      .replace(/{NEXT_SENTENCE}/g, nextSentence || "N/A");

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${config.modelId}:generateContent?key=${config.apiKey}`; //add option for OpenAI API later here

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            // "temperature": 0.7, // Example: Adjust as needed
            // "maxOutputTokens": 2048, // Example: Adjust as needed
            "responseMimeType": "application/json", // Crucial for getting AI response as a JSON directly
          }
        }),
      });
//case it didnt work -> get error details and respond them 
      if (!response.ok) {
        const errorBody = await response.text(); // Try to get more details from the body
        console.error("AI API Error:", response.status, errorBody);
        sendResponse({ error: `API Error ${response.status}: ${response.statusText}`, details: errorBody });
        return;
      }
//case a json file is returned successfully
      const jsonResponse = await response.json();
      
      // With responseMimeType: "application/json", the response should be directly usable.
      // The actual content is usually in candidates[0].content.parts[0].text, which should be a JSON string.
      // However, if the API directly returns the JSON object due to responseMimeType, this might simplify.
      // Let's assume the prompt guides it to produce the { "words_analysis": [...] } structure.
      if (jsonResponse.candidates && jsonResponse.candidates.length > 0 &&
          jsonResponse.candidates[0].content && jsonResponse.candidates[0].content.parts &&
          jsonResponse.candidates[0].content.parts.length > 0 &&
          jsonResponse.candidates[0].content.parts[0].text) {
        
        // The 'text' field itself should be the JSON string we asked for.
        try {
            const aiOutput = JSON.parse(jsonResponse.candidates[0].content.parts[0].text);
            sendResponse({ data: aiOutput });
        } catch (e) {
            console.error("Failed to parse AI JSON output:", e, jsonResponse.candidates[0].content.parts[0].text);
            sendResponse({ error: `Failed to parse AI JSON response: ${e.message}`, rawResponse: jsonResponse.candidates[0].content.parts[0].text });
        }
      } else if (jsonResponse.error) { // Handle cases where the API itself returns an error structure
        console.error("AI API returned an error object:", jsonResponse.error);
        sendResponse({ error: `AI API Error: ${jsonResponse.error.message}`, details: jsonResponse.error.details });
      }
      else {
        console.error("Unexpected AI response format:", jsonResponse);
        sendResponse({ error: 'Unexpected AI response format.', details: jsonResponse });
        return;
      }

    } catch (error) {
      console.error("Network or other error during AI call:", error);
      sendResponse({ error: `Network or other error: ${error.message}` });
    }
  });
}
