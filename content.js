// Content script: Detects hovered word and sentence, sends for AI processing
let hoveredWord = ''; // Keep for potential direct use, though AI might refine
let hoveredSentence = ''; // Keep for potential direct use

// Tooltip logic for in-page word lookup
let tooltip = null;
// let wordData = null; // Replaced by AI response
let srtData = null; // stores parsed SRT from background
let srtFileName = null;
let currentSrtMatchDetails = null; // To store {srtSentence, prevSrtSentence, nextSrtSentence, srtEntry}

let currentSentenceAIAnalysis = null; // To store the full AI analysis for the current sentence

let dataLoadingError = null; // Used for AI/SRT/config loading errors
let showDebugOutput = true; // Variable to control debug output visibility, true for easier debugging -> for future: make this an option in the settings

// Request SRT data from background script when content script loads
chrome.runtime.sendMessage({ type: 'getSrtData' }, (response) => {
  if (chrome.runtime.lastError) {
    dataLoadingError = `Error contacting background script: ${chrome.runtime.lastError.message}`;
    console.error(' Error loading SRT data (runtime):', dataLoadingError);
    return;
  }
  if (response) {
    if (response.srtData && response.srtData.length > 0) {
      srtData = response.srtData;
      srtFileName = response.srtFileName;
      console.log(` SRT data loaded: ${srtFileName} (${srtData.length} entries)`);
      dataLoadingError = null; // Clear previous errors if any
    } else if (response.error) {
      dataLoadingError = `Error loading SRT from storage: ${response.error}`;
      console.error('Error loading SRT data (storage):', dataLoadingError);
    } else {
      dataLoadingError = response.message || 'SRT data not found or empty. Please upload an SRT file via extension options.';
      console.warn(' SRT data not available:', dataLoadingError);
    }
  } else {
    dataLoadingError = "No response from background script when fetching SRT data.";
    console.error('No response from getSrtdata function', dataLoadingError);
  }
});


// function to extract word and sentence from a given range (when hovering over)
function extractWordAndSentenceFromRange(range) {
  if (!range) return null;
  const node = range.startContainer; //get the DOM node containing the text
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) return null; //make sure the node is Text

  const textContent = node.textContent;
  const offset = range.startOffset; //offset where in the node the range starts/cursor is

  // (Korean-aware) word boundary regex (includes Hangul syllables, Jamo, compatibility Jamo, numbers, Latin letters)
  const WordChar = '[\\p{L}\\p{N}\\uAC00-\\uD7AF\\u1100-\\u11FF\\u3130-\\u318F]';
  const nonWordCharOrBoundary = `(?<!${WordChar})|(?!=${WordChar})`;
  //expand from offset to find boundaries of word
  let wordLeft = offset;
  while (wordLeft > 0 && textContent[wordLeft - 1].match(new RegExp(WordChar, 'u'))) {
    wordLeft--;
  }

  let wordRight = offset;
  while (wordRight < textContent.length && textContent[wordRight].match(new RegExp(WordChar, 'u'))) {
    wordRight++;
  }
  
  const word = textContent.slice(wordLeft, wordRight).trim();

  if (!word) return null;

  // Sentence detection:
  // For typical web pages could be more complex. In case of subtitles, the text node itself is often the sentence.
  // We'll primarily use the node's textContent as the sentence, which is good for subtitles.
  // More advanced sentence splitting for general text could be a TODO for the future.
  let sentenceText = textContent.trim();
  
  // Attempt to get a slightly larger context if the node is part of a larger paragraph.
  // might not always be perfect.
  const parentElement = node.parentElement;
  if (parentElement && parentElement.textContent.length > sentenceText.length && parentElement.textContent.length < 300) { // check for more text contained in the same parent node with a limit
      const parentText = parentElement.textContent.trim().replace(/\s+/g, ' '); //normalize whitespace
      if (parentText.includes(sentenceText)) {
          // Try to find sentence boundaries around our current sentenceText within the parentText (simplified)
          const sentenceEndChars = /[.!?。？！]/; //look out for sentence ending characters
          let potentialSentenceStart = parentText.indexOf(sentenceText); //find where original text starts in parent
          let actualStart = potentialSentenceStart;
          for (let i = potentialSentenceStart - 1; i >= 0; i--) {
              if (sentenceEndChars.test(parentText[i])) {
                  actualStart = i + 1;
                  break;
              }
              if (i === 0) actualStart = 0; //in case it hits the start of the parent node
          }
          
          let potentialSentenceEnd = potentialSentenceStart + sentenceText.length;
          let actualEnd = potentialSentenceEnd;
          for (let i = potentialSentenceEnd; i < parentText.length; i++) {
              if (sentenceEndChars.test(parentText[i])) {
                  actualEnd = i + 1;
                  break;
              }
              if (i === parentText.length -1) actualEnd = parentText.length;
          }
          sentenceText = parentText.substring(actualStart, actualEnd).trim();
      }
  }


  return { word, sentenceText, node };
}

// Function to find matching SRT entry and its context
function findSrtContext(webpageSentence) {
  if (!srtData || srtData.length === 0 || !webpageSentence) {
    return null;
  }
  // Normalize webpage sentence for matching (simple trim and space normalization)
  const normalizedWebpageSentence = webpageSentence.trim().replace(/\s+/g, ' ');

  for (let i = 0; i < srtData.length; i++) {
    const srtEntryText = srtData[i].text.trim().replace(/\s+/g, ' ');
    // Simple substring match. Consider more advanced matching if needed.
    if (srtEntryText.includes(normalizedWebpageSentence) || normalizedWebpageSentence.includes(srtEntryText)) {
      return {
        srtSentence: srtData[i].text,
        prevSrtSentence: i > 0 ? srtData[i-1].text : null,
        nextSrtSentence: i < srtData.length - 1 ? srtData[i+1].text : null,
        srtEntry: srtData[i] // The full SRT entry object
      };
    }
  }
  return null; // No match found
}

function showTooltip(x, y, currentHoveredWord, currentWebpageSentence, aiAnalysisResult) {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.style.position = 'fixed';
    tooltip.style.zIndex = '2147483647'; // Max z-index
    tooltip.style.background = 'rgba(255, 255, 255, 0.98)';
    tooltip.style.border = '1px solid #ccc';
    tooltip.style.borderRadius = '8px';
    tooltip.style.boxShadow = '0 5px 15px rgba(0,0,0,0.2)';
    tooltip.style.padding = '15px';
    tooltip.style.fontSize = '16px';
    tooltip.style.maxWidth = '500px';
    tooltip.style.minWidth = '300px';
    tooltip.style.pointerEvents = 'auto'; // Allow interaction with tooltip content if needed
    tooltip.style.fontFamily = '\'Segoe UI\', \'Malgun Gothic\', sans-serif';
    tooltip.style.lineHeight = '1.6';
    document.body.appendChild(tooltip);
  }

  let contentHtml = "";
  const normalizedWordForDisplay = currentHoveredWord ? currentHoveredWord.trim().normalize() : "";

  contentHtml += `<div style='font-size: 24px; font-weight: bold; margin-bottom: 12px; color: #2c3e50; border-bottom: 1px solid #eee; padding-bottom: 8px;'>${normalizedWordForDisplay || "..."}</div>`;
  
  if (currentWebpageSentence) {
      contentHtml += `<div style='font-size: 0.9em; color: #555; margin-bottom: 8px; font-style: italic;'>Source: "${currentWebpageSentence.substring(0, 70)}${currentWebpageSentence.length > 70 ? '...' : ''}"</div>`;
  }
  if (currentSrtMatchDetails && currentSrtMatchDetails.srtSentence) {
      contentHtml += `<div style='font-size: 0.85em; color: #3498db; margin-bottom: 12px; background-color: #eaf5ff; padding: 6px 8px; border-radius: 4px;'>SRT: "${currentSrtMatchDetails.srtSentence.substring(0,70)}${currentSrtMatchDetails.srtSentence.length > 70 ? '...' : ''}"</div>`;
  }

  if (dataLoadingError) { // For SRT/config errors (checked before AI call usually)
    contentHtml += `<div style='color:red; margin-top:10px; padding: 8px; background-color: #ffebee; border-radius: 4px;'><strong>Configuration/Data Error:</strong><br>${dataLoadingError}</div>`;
  } else if (aiAnalysisResult && aiAnalysisResult.error) {
    contentHtml += `<div style='color:red; margin-top:10px; padding: 8px; background-color: #ffebee; border-radius: 4px;'><strong>AI Error:</strong> ${aiAnalysisResult.error}</div>`;
    if (aiAnalysisResult.rawResponse) {
        contentHtml += `<div style='font-size:0.8em; color: #444; margin-top:5px; max-height: 100px; overflow-y: auto; border: 1px solid #fdd; padding: 5px; background-color: #fff9f9;'>Raw: ${aiAnalysisResult.rawResponse.substring(0,300)}...\</div>`;
    }
     if (aiAnalysisResult.details) {
        contentHtml += `<div style='font-size:0.8em; color: #444; margin-top:5px; max-height: 100px; overflow-y: auto; border: 1px solid #fdd; padding: 5px; background-color: #fff9f9;'>Details: ${typeof aiAnalysisResult.details === 'string' ? aiAnalysisResult.details.substring(0,300) : JSON.stringify(aiAnalysisResult.details).substring(0,300)}...\</div>`;
    }
  } else if (currentSentenceAIAnalysis && currentSentenceAIAnalysis.words_analysis) { // Check stored analysis
    const wordsAnalysis = currentSentenceAIAnalysis.words_analysis;
    let matchedEntry = null;

    if (normalizedWordForDisplay) {
      matchedEntry = wordsAnalysis.find(entry => entry.surface.trim().normalize() === normalizedWordForDisplay);
    }

    console.log("[KoreanDict] Matched entry in showTooltip:", matchedEntry);

    if (matchedEntry) {
      const entry = matchedEntry; // Use the single matched entry
      contentHtml += `<div style='margin-bottom: 18px; padding: 12px; border-radius: 6px; background-color: #f8f9fa; border: 1px solid #3498db;'>`;
      
      // Surface and Base form
      contentHtml += `<div style='font-size: 1.2em; font-weight: bold; color: #333; margin-bottom: 5px;'>${entry.surface}`;
      if (entry.base && entry.base !== entry.surface) {
          contentHtml += ` <span style="font-size:0.9em; color: #555;">(Base: ${entry.base})</span>`;
      }
      contentHtml += `</div>`;

      // Part of Speech (POS)
      if (entry.pos) {
        contentHtml += `<div style='margin-bottom: 6px; font-size: 0.9em;'><span style='background-color: #e0f2fe; color: #0c5460; padding: 3px 8px; border-radius: 12px; font-size: 0.9em;'>${entry.pos}</span></div>`;
      }

      // Word Type (Native, Sino-Korean, Loanword)
      if (entry.type) {
        contentHtml += `<div style='margin-bottom: 6px; font-size: 0.9em;'><span style='background-color: #e6f7ff; color: #0050b3; padding: 3px 8px; border-radius: 12px; font-size: 0.9em;'>Type: ${entry.type}</span></div>`;
      }
      
      // Hanja
      if (entry.hanja) {
        contentHtml += `<div style='margin-bottom: 8px; font-size: 1em; color: #333;'><strong>Hanja:</strong> ${entry.hanja}</div>`;
      }

      // Definitions
      let defs = entry.definitions || [];
      if (defs.length > 0) {
        contentHtml += `<div style='margin-bottom: 8px;'>`;
        contentHtml += `<strong style='color: #333; font-size: 0.95em;'>Definitions:</strong>`;
        contentHtml += `<ul style='list-style: disc; margin-left: 20px; padding-left: 0; margin-bottom: 0; font-size: 0.95em; color: #111;'>`; // Darker color for definitions
        contentHtml += defs.map(d => `<li style='margin-bottom: 4px;'>${d}</li>`).join('');
        contentHtml += `</ul></div>`;
      }

      // Conjugation
      if (entry.conjugation && (entry.conjugation.ending || entry.conjugation.form || entry.conjugation.explanation)) {
        contentHtml += `<div style='color: #444; font-size: 0.9em; margin-bottom: 5px; padding-top: 8px; border-top: 1px dashed #e0e0e0;'>`;
        contentHtml += `<strong>Conjugation/Form:</strong>`;
        if (entry.conjugation.form) contentHtml += ` ${entry.conjugation.form}`;
        if (entry.conjugation.ending) contentHtml += ` (Ending: ${entry.conjugation.ending})`;
        if (entry.conjugation.explanation) contentHtml += ` <span style='color: #555; font-size: 0.95em;'>(${entry.conjugation.explanation})</span>`;
        contentHtml += `</div>`;
      }
      
      // Grammar Notes
      if (entry.grammar_notes) {
        contentHtml += `<div style='color: #444; font-size: 0.9em; margin-top: 5px; padding-top: 8px; border-top: 1px dashed #e0e0e0; line-height: 1.4;'>`;
        contentHtml += `<strong>Notes:</strong> <span style='white-space: pre-wrap;'>${entry.grammar_notes}</span></div>`;
      }
      contentHtml += `</div>`; // Close entry div
    } else if (normalizedWordForDisplay) {
      contentHtml += `<div style="color:#666; margin-top: 10px; font-style: italic; padding: 8px; background-color: #f9f9f9; border-radius: 4px;">No specific analysis found for "${normalizedWordForDisplay}" in the current sentence.</div>`;
    } else {
      contentHtml += '<div style="color:#666; margin-top: 10px; font-style: italic; padding: 8px; background-color: #f9f9f9; border-radius: 4px;">Hover over a specific word.</div>';
    }
  } else if (aiAnalysisResult && aiAnalysisResult.data && aiAnalysisResult.data.words_analysis) {
    // This case might occur if currentSentenceAIAnalysis hasn't been set yet, but a fresh AI response came in.
    // This is a fallback, ideally currentSentenceAIAnalysis is set first.
    contentHtml += '<div style="color:#666; margin-top: 10px; font-style: italic; padding: 8px; background-color: #f9f9f9; border-radius: 4px;">Processing AI response...</div>';
  } else {
    contentHtml += '<div style="color:#666; margin-top: 10px; font-style: italic; padding: 8px; background-color: #f9f9f9; border-radius: 4px;">Waiting for AI analysis...</div>';
  }
  
  if (showDebugOutput) {
    let debugHtml = `<div style='margin-top: 15px; padding-top: 10px; border-top: 1px dashed #ccc; font-size: 0.8em; color: #333; max-height: 150px; overflow-y: auto;'>`;
    debugHtml += `<div><b>Debug Info:</b></div>`;
    debugHtml += `<div><b>Hovered Word:</b> \"${normalizedWordForDisplay || 'N/A'}\"</div>`;
    debugHtml += `<div><b>Webpage Sentence:</b> \"${currentWebpageSentence || 'N/A'}\"</div>`;
    if (currentSrtMatchDetails) {
        debugHtml += `<div><b>SRT Current:</b> "${currentSrtMatchDetails.srtSentence}"</div>`;
        debugHtml += `<div><b>SRT Prev:</b> "${currentSrtMatchDetails.prevSrtSentence || 'N/A'}"</div>`;
        debugHtml += `<div><b>SRT Next:</b> "${currentSrtMatchDetails.nextSrtSentence || 'N/A'}"</div>`;
    } else {
        debugHtml += `<div><b>SRT Match:</b> Not found for webpage sentence.</div>`;
    }
    debugHtml += `</div>`;
    contentHtml += debugHtml;
  }

  tooltip.innerHTML = contentHtml;

  tooltip.style.visibility = 'hidden'; // Hide before calculating position
  tooltip.style.display = 'block';
  
  const tooltipRect = tooltip.getBoundingClientRect();
  const tooltipHeight = tooltipRect.height;
  const tooltipWidth = tooltipRect.width;

  let topPos = y + 20; // Default below cursor
  let leftPos = x + 20; // Default right of cursor

  // Adjust if tooltip goes off-screen
  if (y + tooltipHeight + 20 > window.innerHeight) { // If overflows bottom
    topPos = y - tooltipHeight - 20; // Position above cursor
  }
  if (topPos < 0) { // If still overflows top (or was initially too high)
    topPos = 5; // Position at top of viewport
  }
  if (x + tooltipWidth + 20 > window.innerWidth) { // If overflows right
    leftPos = x - tooltipWidth - 20; // Position left of cursor
  }
  if (leftPos < 0) { // If still overflows left
    leftPos = 5; // Position at left of viewport
  }

  tooltip.style.left = leftPos + 'px';
  tooltip.style.top = topPos + 'px';
  tooltip.style.visibility = 'visible'; // Show after positioning
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
  // currentSrtMatchDetails = null; // Reset context when tooltip hides - might be too aggressive if mouse moves slightly
}

let lastRequestTime = 0;
const requestDebounceTime = 300; // milliseconds debounce for AI requests
let currentAIRequest = null; // To keep track of the last word/sentence sent to AI

// Main mousemove listener (document level)
document.addEventListener('mousemove', (e) => {
  if (e.shiftKey) {
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    const hoverContext = extractWordAndSentenceFromRange(range);
    
    if (hoverContext && hoverContext.word) {
      const currentHoveredWord = hoverContext.word.trim().normalize();
      const currentSentenceText = hoverContext.sentenceText.trim().normalize();
      const requestKey = `${currentHoveredWord}|${currentSentenceText}`; // More specific key
      const sentenceRequestKey = currentSentenceText; // Key for fetching/checking full sentence analysis

      // If AI response for the current sentence is already stored, and we are just changing the hovered word
      if (currentSentenceAIAnalysis && currentSentenceAIAnalysis.originalSentence === currentSentenceText) {
        showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, null); // Pass null for aiAnalysisResult as we use stored
        return;
      }
      
      // If there's a general data loading error (SRT, config), show it and don't proceed to AI
      if (dataLoadingError) {
        showTooltip(e.clientX, e.clientY, hoverContext.word, hoverContext.sentenceText, { error: dataLoadingError });
        return;
      }

      const currentTime = Date.now();
      if (currentTime - lastRequestTime < requestDebounceTime && currentAIRequest === sentenceRequestKey) {
        // Still debouncing for the same sentence, show tooltip with current word, using existing analysis if available
        showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, null); 
        return; 
      }
      
      currentAIRequest = sentenceRequestKey; // Track requests by sentence
      lastRequestTime = currentTime;

      currentSrtMatchDetails = findSrtContext(hoverContext.sentenceText);
      let prevSrt = null, nextSrt = null, currentSrtForAI = hoverContext.sentenceText;

      if (currentSrtMatchDetails) {
        currentSrtForAI = currentSrtMatchDetails.srtSentence; // Prefer SRT sentence for AI
        prevSrt = currentSrtMatchDetails.prevSrtSentence;
        nextSrt = currentSrtMatchDetails.nextSrtSentence;
      }
      
      // Show tooltip immediately with "loading" state or existing data for the new word
      showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, { data: { words_analysis: [] } }); 

      chrome.runtime.sendMessage({
        type: 'getAIDefinition',
        data: {
          word: hoverContext.word,
          currentSentence: currentSrtForAI,
          prevSentence: prevSrt,
          nextSentence: nextSrt
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[KoreanDict] Runtime error sending/receiving message:", chrome.runtime.lastError);
          currentSentenceAIAnalysis = null; // Clear stored analysis on error
          showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, { error: `Extension error: ${chrome.runtime.lastError.message}` });
          currentAIRequest = null; // Clear current request on error
          return;
        }
        
        console.log("[KoreanDict] Full AI Response Data:", response ? response.data : 'No response data');

        // Store the full analysis linked to the sentence it was for
        if (response && response.data && response.data.words_analysis) {
            currentSentenceAIAnalysis = {
                originalSentence: currentSentenceText, // Store which sentence this analysis belongs to
                words_analysis: response.data.words_analysis
            };
        } else if (response && response.error) {
            currentSentenceAIAnalysis = null; // Clear on error
        }

        // Only update if the response is for the current hovered word/sentence context
        const latestHoverContext = extractWordAndSentenceFromRange(document.caretRangeFromPoint(e.clientX, e.clientY));
        if (latestHoverContext && latestHoverContext.word.trim().normalize() === currentHoveredWord && latestHoverContext.sentenceText.trim().normalize() === currentSentenceText) {
            showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, response); // Pass the fresh response for initial display
        } else if (latestHoverContext && latestHoverContext.sentenceText.trim().normalize() === currentSentenceText) {
            // Sentence is the same, but word changed while AI was processing. Show new word with current analysis.
            showTooltip(e.clientX, e.clientY, latestHoverContext.word.trim().normalize(), currentSentenceText, null);
        }

        if (!response || response.error) {
            currentAIRequest = null; // Clear current request if AI returned an error
        }
      });

    } else { // No valid word/sentence under cursor
      hideTooltip();
      currentAIRequest = null;
    }
  } else { // Shift key not pressed
    hideTooltip();
    currentAIRequest = null;
  }
});

// --- Shadow DOM support ---
function addShadowDomListeners(root) {
  if (!root || root._koreanLookupListenerAttached) return; // Check if already attached

  root.addEventListener('mousemove', (e) => shadowDomMouseMoveHandler(e, root));
  root._koreanLookupListenerAttached = true;
}

function shadowDomMouseMoveHandler(e, shadowRoot) {
  if (e.shiftKey) {
    // caretRangeFromPoint needs to be called on the document containing the point.
    // For shadow DOM, this can be tricky. If the event target is inside shadow DOM,
    // its ownerDocument might be the shadow root itself if it's a full document fragment,
    // or we might need to use document.elementFromPoint and then check its shadowRoot.
    
    let range = null;
    try {
        // Try to get range from the document that owns the shadow root, or the main document
        const doc = shadowRoot.ownerDocument || document;
        if (doc.caretRangeFromPoint) {
            range = doc.caretRangeFromPoint(e.clientX, e.clientY);
        } else if (document.caretRangeFromPoint) { // Fallback to main document
             range = document.caretRangeFromPoint(e.clientX, e.clientY);
        }
    } catch (err) {
        console.warn("Error getting caretRangeFromPoint in shadow DOM:", err);
        return;
    }

    const hoverContext = extractWordAndSentenceFromRange(range);
    if (hoverContext && hoverContext.word) {
      const currentHoveredWord = hoverContext.word.trim().normalize();
      const currentSentenceText = hoverContext.sentenceText.trim().normalize();
      const requestKey = `${currentHoveredWord}|${currentSentenceText}`;
      const sentenceRequestKey = currentSentenceText;

      // If AI response for the current sentence is already stored
      if (currentSentenceAIAnalysis && currentSentenceAIAnalysis.originalSentence === currentSentenceText) {
        showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, null);
        return;
      }

      if (dataLoadingError) {
        showTooltip(e.clientX, e.clientY, hoverContext.word, hoverContext.sentenceText, { error: dataLoadingError });
        return;
      }
      
      const currentTime = Date.now();
      if (currentTime - lastRequestTime < requestDebounceTime && currentAIRequest === sentenceRequestKey) {
        showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, null);
        return;
      }
      
      currentAIRequest = sentenceRequestKey; // Track requests by sentence
      lastRequestTime = currentTime;

      currentSrtMatchDetails = findSrtContext(hoverContext.sentenceText);
      let prevSrt = null, nextSrt = null, currentSrtForAI = hoverContext.sentenceText;

      if (currentSrtMatchDetails) {
        currentSrtForAI = currentSrtMatchDetails.srtSentence;
        prevSrt = currentSrtMatchDetails.prevSrtSentence;
        nextSrt = currentSrtMatchDetails.nextSrtSentence;
      }
      
      showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, { data: { words_analysis: [] } }); // Loading

      chrome.runtime.sendMessage({
        type: 'getAIDefinition',
        data: {
          word: currentHoveredWord, // Send the specific word, AI prompt might use it as a hint
          currentSentence: currentSrtForAI,
          prevSentence: prevSrt,
          nextSentence: nextSrt
        }
      }, (response) => {
         if (chrome.runtime.lastError) {
          currentSentenceAIAnalysis = null;
          console.error("[KoreanDict] Runtime error sending/receiving message (Shadow DOM):", chrome.runtime.lastError);
          showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, { error: `Extension error: ${chrome.runtime.lastError.message}` });
          currentAIRequest = null;
          return;
        }
        console.log("[KoreanDict] Full AI Response Data (Shadow DOM):", response ? response.data : 'No response data');

        if (response && response.data && response.data.words_analysis) {
            currentSentenceAIAnalysis = {
                originalSentence: currentSentenceText,
                words_analysis: response.data.words_analysis
            };
        } else if (response && response.error) {
            currentSentenceAIAnalysis = null;
        }

        const latestHoverContext = extractWordAndSentenceFromRange(range); // Re-check range
        if (latestHoverContext && latestHoverContext.word.trim().normalize() === currentHoveredWord && latestHoverContext.sentenceText.trim().normalize() === currentSentenceText) {
            showTooltip(e.clientX, e.clientY, currentHoveredWord, currentSentenceText, response);
        } else if (latestHoverContext && latestHoverContext.sentenceText.trim().normalize() === currentSentenceText) {
            showTooltip(e.clientX, e.clientY, latestHoverContext.word.trim().normalize(), currentSentenceText, null);
        }
        
        if (!response || response.error) {
            currentAIRequest = null;
        }
      });
    } else {
      hideTooltip();
      currentAIRequest = null;
    }
  } else {
    hideTooltip();
    currentAIRequest = null;
  }
}

// Scan for shadow roots and attach listeners
function scanAndAttachShadowRoots() {
  document.querySelectorAll('*').forEach(el => {
    if (el.shadowRoot && !el.shadowRoot._koreanLookupListenerAttached) {
      addShadowDomListeners(el.shadowRoot);
    }
  });
}

// Initial scan and observe for dynamically added shadow roots
scanAndAttachShadowRoots();
const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.shadowRoot && !node.shadowRoot._koreanLookupListenerAttached) {
                        addShadowDomListeners(node.shadowRoot);
                    }
                    // Also check descendants of the added node
                    node.querySelectorAll('*').forEach(descendant => {
                        if (descendant.shadowRoot && !descendant.shadowRoot._koreanLookupListenerAttached) {
                            addShadowDomListeners(descendant.shadowRoot);
                        }
                    });
                }
            });
        }
    }
});
observer.observe(document.body, { childList: true, subtree: true });

