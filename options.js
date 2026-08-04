document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelIdInput = document.getElementById('modelId');
  const srtFileInput = document.getElementById('srtFile');
  const srtFileInfo = document.getElementById('srtFileInfo');
  const aiPromptInput = document.getElementById('aiPrompt');
  const saveButton = document.getElementById('save');
  const statusDiv = document.getElementById('status');

  let parsedSrtData = null; // To hold the currently parsed data if a new file is selected
  let currentSrtFileName = null; // To hold the name of the file selected in this session

  // Load saved settings
  chrome.storage.local.get(['apiKey', 'modelId', 'srtFileName', 'parsedSrtData', 'aiPrompt'], (result) => {
    if (result.apiKey) apiKeyInput.value = result.apiKey;
    if (result.modelId) modelIdInput.value = result.modelId;
    
    if (result.srtFileName) {
      srtFileInfo.textContent = `Currently loaded: ${result.srtFileName}`;
      // We don't re-load parsedSrtData into the variable here,
      // as it's only for handling a new upload during this options page session.
      // The background script will always use the version from storage.
    } else {
      srtFileInfo.textContent = 'No SRT file currently loaded.';
    }

    if (result.aiPrompt) {
      aiPromptInput.value = result.aiPrompt;
    } else {
      // Set a default prompt if none is saved
      aiPromptInput.value = `You are an AI assistant specialized in Korean linguistics and data extraction.
Your task is to analyze Korean words within a given sentence and provide detailed linguistic information.

The user will hover over a specific Korean word ('{WORD}') within a sentence ('{SENTENCE}').
The preceding sentence is: '{PREV_SENTENCE}'.
The subsequent sentence is: '{NEXT_SENTENCE}'.

For EACH significant Korean lexical unit in the provided '{SENTENCE}' (not just the specific '{WORD}'), generate an object with the following fields. Pay close attention to context to ensure accuracy.

Each object in the output array should represent a unique Korean lexical unit identified from the '{SENTENCE}'. A lexical unit is defined by its surface form AND its specific meaning/grammatical role in the context of that sentence.

**Handling Ambiguity and Context:** This is crucial. If the same surface form can have different meanings, base words, or parts of speech depending on context, ensure your analysis reflects the specific usage in '{SENTENCE}'.

**Tokenization/Word Segmentation for 'surface' forms (How to decide what a "word" is for an entry in your analysis of '{SENTENCE}'):**
Your goal is to identify meaningful units that a language learner would want to understand from the '{SENTENCE}'.
- **Nouns + Particles:** For combinations like "할머니는", "물을", "학교에서", the 'surface' should be the combined form (e.g., "할머니는"). The 'base' would be the noun ("할머니"), 'pos' would be "noun", and 'grammar_notes' would explain the particle ("-는" - topic marker, attached to the noun '할머니').
- **Conjugated Verbs/Adjectives:** For forms like "하세요", "먹었다", "예쁜", "평화로웠던", the 'surface' is the full conjugated form. The 'base' is the dictionary form (e.g., "하다", "먹다", "예쁘다", "평화롭다").
- **Compound Verbs:** For Noun+하다 verbs like "공부하다", if they function as a single lexical unit in the sentence, treat the entire compound as the 'surface' and 'base'. If separated (e.g., "공부를 하다"), then "공부를" is one unit and "하다" (or its conjugated form) is another.
- **Standalone Words:** Adverbs, interjections, or nouns appearing without particles will have 'surface' and 'base' being the same.

**Required fields for each lexical unit's object:**
- "id": A unique temporary string ID for this specific lexical unit within this sentence's analysis (e.g., "temp_w1", "temp_w2").
- "surface": The exact Korean word or phrase segment as it appears in the '{SENTENCE}'.
- "base": The dictionary/base form of the word.
- "definitions": An array of strings. Each string should be a concise, **context-aware English definition** of the word as it is used in '{SENTENCE}'. Provide at least one English definition. Optionally, if readily available and accurate, include a Japanese definition as another string in the array.
- "pos": The part of speech of the 'base' word (e.g., "noun", "verb", "adjective", "adverb", "particle", "pronoun", "determiner", "exclamation").
- "type": The origin type of the 'base' word: "native", "sino-korean", or "loanword".
- "hanja": (Optional) The Hanja (Chinese characters) for the 'base' word, if applicable and commonly associated. If not applicable or no common Hanja, use null or omit the field.
- "grammar_notes": A string containing a **context-aware grammatical explanation**. Detail how the 'surface' form is constructed (if different from 'base') and its function *in this specific sentence context*. Examples:
    - For 'surface': "물을" (from 'base': "물"): "'surface' '물을' is composed of the noun 'base' '물' (water) and the object particle '-을'. In this sentence, it indicates 'water' is the direct object of the verb."
    - For 'surface': "평화로웠던" (from 'base': "평화롭다"): "'surface' '평화로웠던' is derived from the adjective 'base' '평화롭다' (to be peaceful), conjugated into its past adnominal form using -었/았 + 던. It modifies a following noun, describing it as something that was peaceful."
    - For 'surface': "하세요" (from 'base': "하다"): "'surface' '하세요' is a polite imperative/statement form of the verb 'base' '하다' (to do), typically used when addressing someone respectfully."
- "conjugation": (Optional) An object with details if the 'surface' form is a conjugated verb or adjective. If not applicable, omit or use null.
    - "ending": The specific inflectional ending(s) (e.g., for "평화로웠던", it could be "-었던").
    - "explanation": Brief description of the grammatical function of that ending (e.g., "past retrospective adnominal ending").

Return ONLY a single, valid JSON object with a key "words_analysis" which contains an array of these objects for all analyzed lexical units in the '{SENTENCE}'.
Do not include any explanatory text before or after the JSON object.
Focus on accurate contextual disambiguation. If a word is ambiguous, choose the most likely interpretation in context for the main entry, and optionally note other possibilities in 'grammar_notes'.

Example for a single word analysis within the "words_analysis" array:
{
  "id": "temp_w1",
  "surface": "평화로웠던",
  "base": "평화롭다",
  "definitions": ["having been peaceful (in this specific context)", "平和だった (この文脈で)"],
  "pos": "adjective",
  "type": "native",
  "hanja": null,
  "grammar_notes": "'surface' '평화로웠던' is derived from the adjective 'base' '평화롭다' (to be peaceful), conjugated into its past adnominal form using -었/았 + 던. It modifies the following noun '과거', describing the past as something that was peaceful.",
  "conjugation": {
    "ending": "-었던",
    "explanation": "past retrospective adnominal ending"
  }
}
`;
    }
  });

  srtFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          parsedSrtData = parseSRT(e.target.result); // Store new data in the session variable
          console.log('Number of entries parsed:', parsedSrtData ? parsedSrtData.length : 'null');
          console.log('First 3 parsed SRT entries in options.js:', parsedSrtData ? JSON.stringify(parsedSrtData.slice(0, 3)) : 'null');
          currentSrtFileName = file.name; // Store new name in the session variable
          srtFileInfo.textContent = `Selected for upload: ${file.name} (${parsedSrtData.length} entries)`;
          statusDiv.textContent = 'New SRT file ready to be saved.';
          statusDiv.className = ''; // Clear previous status styling
        } catch (error) {
          statusDiv.textContent = `Error parsing SRT: ${error.message}`;
          statusDiv.className = 'error';
          srtFileInfo.textContent = 'Error processing file. Please try another.';
          parsedSrtData = null; // Clear on error
          currentSrtFileName = null;
        }
      };
      reader.onerror = () => {
          statusDiv.textContent = 'Error reading SRT file.';
          statusDiv.className = 'error';
          parsedSrtData = null;
          currentSrtFileName = null;
      };
      reader.readAsText(file);
    }
  });

  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value;
    const modelId = modelIdInput.value;
    const aiPrompt = aiPromptInput.value;

    if (!apiKey || !modelId) {
      statusDiv.textContent = 'API Key and Model ID are required.';
      statusDiv.className = 'error';
      return;
    }

    const dataToSave = { apiKey, modelId, aiPrompt };

    console.log('Data being prepared to save in options.js (keys):', JSON.stringify(Object.keys(dataToSave)));
    console.log('Is parsedSrtData going to be part of dataToSave?', parsedSrtData && currentSrtFileName ? 'Yes' : 'No (either no new file parsed or issue with filename)');

    // Only include SRT data in saving if a new file was successfully parsed in this session
    if (parsedSrtData && currentSrtFileName) {
      dataToSave.parsedSrtData = parsedSrtData;
      dataToSave.srtFileName = currentSrtFileName;
      console.log('First 3 entries of parsedSrtData for saving:', dataToSave.parsedSrtData ? JSON.stringify(dataToSave.parsedSrtData.slice(0, 3)) : 'N/A');
    }
    // If no new file was selected, the existing parsedSrtData and srtFileName in storage will be preserved
    // unless explicitly overwritten by a new upload.

    chrome.storage.local.set(dataToSave, () => {
      if (chrome.runtime.lastError) {
        statusDiv.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
        statusDiv.className = 'error';
      } else {
        statusDiv.textContent = 'Settings saved successfully!';
        statusDiv.className = 'success';
        if (currentSrtFileName) { // If a new file was saved
           srtFileInfo.textContent = `Currently loaded: ${currentSrtFileName}`;
        }
        // Reset session variables after successful save
        parsedSrtData = null;
        currentSrtFileName = null;
      }
      setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
      }, 4000);
    });
  });

  // Helper function to format time string consistently (HH:MM:SS.mmm)
  function normalizeTimestampPart(h, m, s_ms_input) {
    const hours = h ? h.padStart(2, '0') : '00';
    const minutes = m.padStart(2, '0'); // m is already \d{2} from regex
    
    // s_ms_input is "SS.mmm" or "SS,mmm"
    let [ss, mmm] = s_ms_input.replace(',', '.').split('.');
    // ss is \d{2}, mmm is \d{3} due to regex (\d{2}[,.]\d{3})
    
    return `${hours}:${minutes}:${ss}.${mmm}`;
  }

  /**
   * Parses SRT or VTT file content.
   * @param {string} srtContent - The string content of the SRT/VTT file.
   * @returns {Array<Object>} An array of subtitle objects.
   *                          Each object: { id (string), startTime (string), endTime (string), text (string) }
   */
  function parseSRT(srtContent) {
    const entries = [];
    let cueIdCounter = 1;

    // Normalize line endings
    let normalizedContent = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove WEBVTT header and metadata, and trim
    normalizedContent = normalizedContent.replace(/^WEBVTT([ \t].*)?\n*/i, ''); // Remove WEBVTT and anything on its line
    normalizedContent = normalizedContent.replace(/^STYLE\n([\s\S]*?)\n\n/gim, ''); // Remove STYLE blocks
    normalizedContent = normalizedContent.replace(/^REGION\n([\s\S]*?)\n\n/gim, ''); // Remove REGION blocks
    normalizedContent = normalizedContent.trim();

    // Split into blocks. Handles VTT files that might use one or more blank lines (potentially with spaces)
    const blocks = normalizedContent.split(/\n\s*\n+/);
    console.log(`parseSRT: Found ${blocks.length} potential blocks.`);

    for (const block of blocks) {
        const trimmedBlock = block.trim();
        if (trimmedBlock === '' || trimmedBlock.startsWith('NOTE')) {
            console.warn("Skipping empty or NOTE block:", trimmedBlock.substring(0, 50));
            continue;
        }

        const lines = trimmedBlock.split('\n');
        let id = null;
        // let timeLine = null; // Declared later
        let textLines = [];

        let timestampLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            // More robust check for timestamp line
            if (lines[i].includes('-->') && lines[i].match(/\d{1,2}:\d{2}[,.]\d{3}|\d{2}:\d{2}:\d{2}[,.]\d{3}/)) {
                timestampLineIndex = i;
                break;
            }
        }

        if (timestampLineIndex === -1) {
            console.warn("Skipping block: no valid timestamp line found. Block content:", trimmedBlock.substring(0, 100));
            continue;
        }

        const timeLine = lines[timestampLineIndex].trim();
        
        if (timestampLineIndex > 0) {
            const potentialIdLine = lines[timestampLineIndex - 1].trim();
            if (potentialIdLine && !potentialIdLine.includes('-->') && !potentialIdLine.match(/^(NOTE|STYLE|REGION)/i)) {
                 id = potentialIdLine;
            }
        }
        
        if (!id) {
            id = (cueIdCounter++).toString();
        }
        
        textLines = lines.slice(timestampLineIndex + 1).filter(line => line.trim() !== '');

        const timeRegex = /^(?:(\d{1,2}):)?(\d{2}):(\d{2}[,.]\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2}[,.]\d{3})(?:\s+.*)?$/;
        const timeMatch = timeLine.match(timeRegex);

        if (!timeMatch) {
            console.warn("Skipping block: invalid timestamp format on line:", timeLine, "Block content:", trimmedBlock.substring(0,100));
            continue;
        }

        const startTime = normalizeTimestampPart(timeMatch[1], timeMatch[2], timeMatch[3]);
        const endTime = normalizeTimestampPart(timeMatch[4], timeMatch[5], timeMatch[6]);
        
        const text = textLines.join('\n').trim();

        if (text) {
            entries.push({ id, startTime, endTime, text });
        } else {
            console.warn("Skipping block: parsed text is empty. ID:", id, "Time:", timeLine);
        }
    }

    if (entries.length === 0 && normalizedContent.trim() !== '') {
      console.warn("SRT/VTT parsing resulted in 0 entries, but input was not empty. Check file format and console warnings above. Processed content length:", normalizedContent.length);
    }
    console.log(`parseSRT finished. Parsed ${entries.length} entries.`);
    return entries;
  }
});
