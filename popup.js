// Handles popup logic for the BROWSER ACTION (extension icon)
// This is NOT the hover tooltip.
// This can be used for quick settings access or status.

document.addEventListener('DOMContentLoaded', () => {
  const wordElem = document.getElementById('word');
  const defElem = document.getElementById('definition');
  const sentElem = document.getElementById('sentence'); // Assuming this is still in popup.html

  wordElem.textContent = 'Korean AI Lookup';
  defElem.innerHTML = 'Hover over Korean text with Shift to see AI-powered definitions.<br><br>Configure API key and SRT files in extension options.';
  sentElem.textContent = '';

  // Optional: Add a button to open options page
  const optionsButton = document.createElement('button');
  optionsButton.textContent = 'Open Settings';
  optionsButton.style.marginTop = '15px';
  optionsButton.style.padding = '8px 12px';
  optionsButton.style.cursor = 'pointer';
  optionsButton.onclick = () => {
    chrome.runtime.openOptionsPage();
  };
  document.body.appendChild(optionsButton);

  // Remove old logic that relied on korean_words.json and messages for hovered words,
  // as that functionality is now handled by content.js and its tooltip.
});
