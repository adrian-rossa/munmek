## Korean AI Word Lookup Extension: Todo List & Feature Implementation Plan

**🔴 Immediate & Critical (Ongoing & Stability Focus):**

1.  **Netflix Subtitle Extraction & Tab-Specific SRT Upload Stability:**
    *   **Goal:** Ensure reliable subtitle data (from Netflix or uploaded SRTs) is available to the AI for the current tab. This is the current main development focus.
    *   **Status:** Partially implemented; Netflix player access is the primary blocker.
    *   **Steps:**
        *   **Netflix Extractor (`netflix_subtitle_extractor.js`):**
            *   Continue intensive debugging to reliably access the Netflix player API (`window.netflix...`). This involves ensuring the script can find the player instance across different Netflix UI states and timings.
            *   Verify robust extraction of available subtitle languages and their corresponding VTT data.
            *   Ensure the `JSON.parse` override consistently captures subtitle manifests.
            *   Refine `waitForPlayer` and player access functions based on console logs and testing.
        *   **Popup Interaction (`popup.html`, `popup.js`):**
            *   Ensure "Scan Available Languages" and "Extract Selected Subtitles" buttons for Netflix work reliably.
            *   Confirm manual SRT/VTT file uploads via the popup are correctly processed for the active tab.
        *   **Background Processing (`background.js`):**
            *   Verify that `netflixSubtitlesExtracted` messages from `netflix_subtitle_extractor.js` are correctly received.
            *   Ensure VTT content (from Netflix) and SRT content (from upload) are parsed by `parseSRT` and stored in `tabSrtData[tabId]`.
            *   Confirm `srtDataUpdated` messages are sent to the correct `content.js`.
        *   **Content Script Usage (`content.js`):**
            *   Ensure `content.js` correctly requests and receives tab-specific SRT data from `background.js`.

2.  **Make In-Page Tooltip More Stable (Tooltip from `content.js`):**
    *   **Goal:** Prevent the AI definition tooltip from closing too quickly or unexpectedly, improving usability.
    *   **Steps:**
        *   Review `hideTooltip()` logic in `content.js`.
        *   Implement a delay before hiding the tooltip when the mouse moves off the highlighted word.
        *   Consider adding `mouseenter` and `mouseleave` event listeners to the tooltip itself, so if the user moves their mouse onto the tooltip, it stays open. It should only close if the mouse moves off both the word and the tooltip after a delay.

**🟠 High Priority (Core UX & Key Functionality):**

3.  **Hanja Display (한자 표시) in Tooltip:**
    *   **Goal:** Show associated Hanja (Chinese characters) for Korean words, if available from the AI.
    *   **Steps:**
        *   **AI Prompt:** Ensure the AI prompt (in `options.js` default and potentially user's custom prompt) explicitly requests Hanja for Korean words in its JSON response structure (e.g., a `hanja` field).
        *   **Content Script (`content.js`):**
            *   Modify the `showTooltip` function to parse the AI response for the Hanja field.
            *   Update the tooltip's HTML structure to display the Hanja, perhaps next to the Korean word or in the definition area.

4.  **Prompt Refinement (Iterative & Ongoing):**
    *   **Goal:** Continuously improve the quality, accuracy, and consistency of AI-generated definitions and explanations.
    *   **Steps:**
        *   **Testing:** Regularly test with diverse Korean words, sentences, and contexts.
        *   **Prompt Adjustment (`options.js`):** Refine the default AI prompt. Focus on:
            *   Clear instructions for the desired JSON output structure.
            *   How the AI should use context (hovered sentence, surrounding sentences, SRT summary if implemented).
            *   The desired style and depth of explanation.
            *   Requesting specific information (like Hanja, grammar points, related words).
        *   **User Guidance:** Encourage users to experiment with their custom prompts.

5.  **Bake-in Crucial AI Prompt Parts:**
    *   **Goal:** Allow users to customize their AI prompt without accidentally breaking the extension's ability to parse the AI's response.
    *   **Steps:**
        *   **Identify Core Instructions:** Determine essential parts of the prompt (e.g., "You MUST respond in JSON format with fields: {word_info, definition, grammar_notes, hanja}", "Analyze the primary Korean word: [WORD_HERE]").
        *   **Background Script (`background.js`):** In `handleAIDefinitionRequest`, construct the final prompt sent to the AI by combining:
            *   A fixed prefix/template containing these core instructions and placeholders.
            *   The user's custom prompt from `chrome.storage.local`.
            *   Contextual data (word, sentence, SRT info).
        *   **Options Page (`options.html`):** Clearly explain to the user that their custom prompt will be integrated with a base template, and show which placeholders they can use or what output structure is expected.

**🟡 Medium Priority (Significant Enhancements & User Experience):**

6.  **Interactions inside Tooltip (e.g., example sentences, simpler explanations):**
    *   **Goal:** Allow users to get more information or different views of the AI's analysis directly from the tooltip.
    *   **Steps:**
        *   **Tooltip UI (`content.js`):** Add buttons to the tooltip HTML (e.g., "Simpler Explanation," "Example Sentence," "More Grammar Details").
        *   **Event Handling (`content.js`):** Add event listeners to these buttons.
        *   **Background Communication (`background.js`):** On button click, send a new message to `background.js` with a specific request type (e.g., `getSimplifiedDefinition`, `getExampleSentence`) including the original word and context.
        *   **AI Call (`background.js`):** `handleAIDefinitionRequest` (or a new function) would make a new AI call with a prompt tailored to this specific request.
        *   **Tooltip Update (`content.js`):** Update a section of the tooltip with the AI's response to this follow-up query.

7.  **Multi-language Support (Selectable):**
    *   **Goal:** Extend the extension's functionality beyond Korean to other languages.
    *   **Steps:**
        *   **UI for Selection:** Add a language selector in `options.html` and possibly a quick selector in `popup.html`.
        *   **Storage:** Store the selected target language in `chrome.storage.local`.
        *   **AI Prompt:** Modify `background.js` to include the selected target language in the prompt to the AI (e.g., "Provide definitions in [selected_language]").
        *   **(Optional) Word/Sentence Detection:** If other languages require different word/sentence boundary detection rules, `content.js` would need to adapt.
        *   **(Optional) Dictionary Sources:** If using non-AI dictionary sources in the future, these would need to be language-specific.
    
    Also: make Sentence selection more robust for webpages that are not subtitled videoplayers.
    IMPORTANT: for Japanese, since it doesnt use empty spaces to seperate words we would need a different approach to word recognition. Maybe background.js has to handle it and have the AI segment the words

8.  **Summarize SRT for AI Context:**
    *   **Goal:** Provide the AI (once) with a summary of the entire SRT file's content to give broader context for definitions.
    *   **Steps:**
        *   **Background Script (`background.js`):**
            *   When an SRT file is loaded (manual or Netflix), after parsing, send the full text content (or a significant chunk) to the AI with a prompt asking for a concise summary (e.g., 2-3 sentences).
            *   Store this summary alongside the SRT data (e.g., in `tabSrtData[tabId].summary`).
        *   **AI Prompt:** When requesting a word definition, include this stored summary in the context provided to the AI.
        *   **UI (Optional):** Display the summary somewhere (e.g., in the popup) so the user knows what context is being used.

9.  **Better Grammar Explanations (Inspired by Satori Reader):**
    *   **Goal:** Provide more detailed and structured grammatical insights for the hovered word within its sentence.
    *   **Steps:**
        *   **Research:** Analyze how Satori Reader or similar tools present grammar.
        *   **AI Prompt:** Update the AI prompt to specifically ask for a breakdown of the word's grammatical function in the sentence, relevant particles, conjugation details, etc.
        *   **Content Script (`content.js`):**
            *   Parse this richer grammatical information from the AI's JSON response.
            *   Design a clear way to display these explanations in the `showTooltip` function.

10. **Text in Tooltip Highlightable/Copyable:**
    *   **Goal:** Allow users to easily select and copy text from the AI definition tooltip.
    *   **Steps:**
        *   **CSS (`content.js`):** Ensure that the CSS styles applied to the tooltip's content areas do not include `user-select: none;`. Text selection should be enabled by default if not explicitly disabled.

11. **First Install Initial Setup / Onboarding:**
    *   **Goal:** Guide new users through the essential setup steps (e.g., API key).
    *   **Steps:**
        *   **Background Script (`background.js`):** In `chrome.runtime.onInstalled`, if `details.reason === 'install'`, use `chrome.tabs.create({ url: 'options.html' });` to open the options page.
        *   **Options Page (`options.html`):** Add a small welcome message or a clearly marked "Setup" section that is prominent on first load, guiding the user to enter their API key.

12. **Default AI Model to a Flash Model:**
    *   **Goal:** Use a faster and potentially more cost-effective AI model by default.
    *   **Steps:**
        *   **Background Script (`background.js`):** In `chrome.runtime.onInstalled`, when initializing default settings, set `modelId` to a suitable flash model (e.g., `gemini-1.5-flash-latest`) if no model ID is already stored.
        *   **Options Page (`options.html`):** Update the placeholder text for the Model ID input to suggest a flash model.

13. **Mention Antonyms/Related Words in AI Notes:**
    *   **Goal:** Enhance learning by providing words with opposite or similar meanings.
    *   **Steps:**
        *   **AI Prompt:** Modify the AI prompt to request antonyms or semantically related words, to be included in a specific field in the JSON response (e.g., `related_words: {antonyms: [], synonyms: []}`).
        *   **Content Script (`content.js`):** Parse this information in `showTooltip` and display it clearly.

**🟢 Low Priority (Refinements, Nice-to-Haves):**

14. **Remove/Hide Debug Information:**
    *   **Goal:** Provide a cleaner console and UI experience for end-users.
    *   **Steps:**
        *   **Global Flag:** Introduce a global constant like `const DEBUG_MODE = false;` in relevant files (`content.js`, `background.js`, `netflix_subtitle_extractor.js`).
        *   **Conditional Logging:** Wrap all `console.log` statements intended for debugging with `if (DEBUG_MODE) { ... }`.
        *   **UI Cleanup:** Remove any debug information currently displayed directly in the tooltip or popup UI.
        let showDebugOutput = true; -> in content.js

15. **Play Short Audio of Word:**
    *   **Goal:** Add an auditory learning aid by playing the pronunciation of the hovered word.
    *   **Steps:**
        *   **TTS Source:**
            *   **Web Speech API:** Investigate using `speechSynthesis` for Korean.
            *   **External API:** If Web Speech API quality is insufficient, research a free or freemium Korean TTS API.
        *   **Tooltip UI (`content.js`):** Add a small "play audio" button to the tooltip.
        *   **Functionality:** On button click, take the hovered word and send it to the chosen TTS source. Play the returned audio.
        *   **Permissions:** If using an external API, ensure necessary permissions are declared in `manifest.json` if it involves new host permissions.

16. **New Icon and Name (文脈 - Bunmyaku/Munmaek - Context):**
    *   **Goal:** Update the extension's branding.
    *   **Steps:**
        *   **Create Assets:** Design new icons in various sizes (16x16, 32x32, 48x48, 128x128 px) and save them in the `assets/` folder.
        *   **Manifest Update (`manifest.json`):**
            *   Change the `"name"` field to "文脈".
            *   Update the paths in `"action.default_icon"` and `"icons"` to point to the new icon files.

17. **Day/Night Mode for UI:**
    *   **Goal:** Offer visual customization for user comfort.
    *   **Steps:**
        *   **UI Toggle:** Add a toggle switch in `options.html` (and perhaps `popup.html`).
        *   **Storage:** Store the user's preference (e.g., `theme: 'dark'` or `theme: 'light'`) in `chrome.storage.local`.
        *   **CSS Styling:**
            *   Define CSS variables or classes for dark and light themes.
            *   In `content.js` (for the tooltip), `popup.html`, and `options.html`, dynamically apply the appropriate theme class to a main container element based on the stored preference.

18. **Information in Settings (Model Recommendation, Link to AI Studio):**
    *   **Goal:** Provide helpful guidance to users within the settings page.
    *   **Steps:**
        *   **Options Page (`options.html`):** Add a small section with text recommending the use of faster/cheaper models (like Flash versions) and include a hyperlink to Google AI Studio or relevant model documentation.

19. **Hotkey for Hover Action Configurable:**
    *   **Goal:** Allow users to choose their preferred modifier key for triggering the lookup.
    *   **Steps:**
        *   **UI in Options (`options.html`):** Add a dropdown or radio buttons to select the modifier key (e.g., Shift, Ctrl, Alt, or None - for hover without key).
        *   **Storage:** Store the selected hotkey preference in `chrome.storage.local`.
        *   **Content Script (`content.js`):**
            *   On load, retrieve the hotkey preference.
            *   Modify the `mousemove` event listener to check for the currently configured modifier key(s) instead of hardcoding `e.shiftKey`.

20. **Reminder: "AI Can Make Mistakes!"**
    *   **Goal:** Manage user expectations regarding the accuracy of AI-generated content.
    *   **Steps:**
        *   **Tooltip (`content.js`):** Add a small, non-intrusive disclaimer at the bottom of the tooltip (e.g., "AI-generated content. Verify important information.").
        *   **Options Page (`options.html`):** Optionally, include a similar note in the settings.

21. consider making it so that the extension content.js gets only injected in certain web pages (e.g Netflix) or when the user activates it for the webpage

22. Add OpenAI Api permission to manifest.json, Gemini also currently hardcoded in background.js

---

**🚀 Publishing & Public Release Checklist:**

This section outlines steps to take when preparing the extension for a public release on GitHub and the Chrome Web Store.

**A. Preparing for GitHub Public Release:**

1.  **`.gitignore` File:**
    *   **Goal:** Prevent unnecessary or sensitive files from being committed to the repository.
    *   **Steps:**
        *   Create a `.gitignore` file in the project root.
        *   Add entries for files/folders like `.vscode/` (if personal settings), any build artifacts (if applicable in the future), `node_modules/` (if you add JS build tools/libraries), and any local configuration files not meant for sharing.

2.  **`LICENSE` File:**
    *   **Goal:** Define how others can use your code.
    *   **Steps:**
        *   Choose an open-source license (e.g., MIT, Apache 2.0, GPL). MIT is common for its permissiveness.
        *   Add a `LICENSE` file to the project root containing the chosen license text.

3.  **Comprehensive `README.md` (Enhance Existing):**
    *   **Goal:** Provide a clear and welcoming entry point for users and potential contributors.
    *   **Steps (Expand on current `README.md`):**
        *   **Project Title & Slogan:** Reflect the new name "文脈".
        *   **Detailed Description:** What the extension does, its core value.
        *   **Features List:** Bullet points of all key functionalities.
        *   **Visuals:** Add screenshots or GIFs showing the extension in action (tooltip, popup, options).
        *   **Installation:**
            *   Link to Chrome Web Store page (once published).
            *   Instructions for developers to load unpacked from GitHub.
        *   **Usage Guide:** How to use the extension (triggering lookup, using popup, Netflix extraction, SRT upload).
        *   **Configuration:** Explain options (API key, model ID, custom prompt, future settings like language/hotkey).
        *   **Troubleshooting:** Common issues and solutions (e.g., API key errors, Netflix player not found, ad blocker interference).
        *   **Contributing (Optional):** If you're open to contributions, add a `CONTRIBUTING.md` file and link to it, outlining how to report bugs, suggest features, or submit code changes (style guides, PR process).
        *   **Credits/Acknowledgements:** If you used any third-party libraries, assets, or were inspired by other projects.

**B. Preparing for Chrome Web Store Submission:**

1.  **Chrome Developer Account:**
    *   **Goal:** Required to publish extensions.
    *   **Steps:** Register at the Chrome Web Store Developer Dashboard. There's a small one-time registration fee.

2.  **Finalize `manifest.json` for Store:**
    *   **Goal:** Ensure the manifest is complete and accurate for the store.
    *   **Steps:**
        *   **`version`:** Increment for each release (e.g., "1.0.0" for initial public release). Use semantic versioning (MAJOR.MINOR.PATCH).
        *   **`name`:** Finalize (e.g., "文脈 - AI Contextual Lookup").
        *   **`description`:** A concise (max 132 characters) summary for the store listing.
        *   **`icons`:** Ensure all required sizes (16, 32, 48, 128) are high quality and present.
        *   **`permissions` & `host_permissions`:** Review carefully. Only request permissions absolutely necessary for the extension's functionality. You'll need to justify these during submission.
        *   **`default_locale` (Recommended):** Set a default locale (e.g., "en" or "ko") even if you only support one language initially. This helps with future localization.
        *   Consider adding `author` or `homepage_url` fields.

3.  **Create Promotional Materials:**
    *   **Goal:** Attract users in the Chrome Web Store.
    *   **Steps:**
        *   **Screenshots:** At least one, up to five (1280x800 or 640x400 pixels). Showcase key features.
        *   **Small Promo Tile:** 440x280 pixels.
        *   **Marquee Promo Tile (Optional):** 1400x560 pixels (for featured extensions).
        *   **YouTube Video (Optional):** A short video demonstrating the extension.
        *   **Detailed Store Description:** Expand on the manifest description. Use formatting, highlight benefits.

4.  **Privacy Policy:**
    *   **Goal:** Be transparent with users about data handling; this is mandatory.
    *   **Steps:**
        *   Draft a clear privacy policy. It must explain:
            *   What data your extension collects (e.g., user-provided API key, selected text, sentence context, SRT data).
            *   How this data is used (e.g., API key stored locally via `chrome.storage.local`, text sent to Google Gemini API for processing).
            *   How data is stored and shared (e.g., settings stored locally, data sent to Google's API, no other third-party sharing).
            *   Link to Google's privacy policy for the Gemini API.
            *   State that the extension itself doesn't track browsing history or unrelated personal data.
        *   Host this policy on a publicly accessible URL (e.g., using GitHub Pages for your repository).
        *   Provide the link to this policy in the Chrome Web Store developer dashboard.

5.  **Thorough Testing:**
    *   **Goal:** Catch bugs before users do.
    *   **Steps:**
        *   Test all features extensively on various websites (especially Netflix).
        *   Test installation, uninstallation, and updates.
        *   Test on different operating systems if possible.
        *   Check for console errors.

6.  **Package for Upload:**
    *   **Goal:** Create the ZIP file for the store.
    *   **Steps:** Create a ZIP archive of your extension's root directory. Ensure it only contains necessary files (your `.gitignore` helps define what's necessary). Do not include the `.git` folder or other development-specific files.

7.  **Comply with Store Policies:**
    *   **Goal:** Avoid rejection.
    *   **Steps:** Read and ensure your extension adheres to all Chrome Web Store Program Policies.

**C. General Best Practices for Public Release (Code & Project Health):**

1.  **Remove All Debug Code (Reiteration of TODO #14):**
    *   **Goal:** Clean and professional codebase, no console spam for users.
    *   **Steps:** Ensure all development `console.log`s, `alert()`s, or other debug outputs are removed or conditionally disabled (e.g., via a `DEBUG_MODE = false` flag).

2.  **Robust Error Handling:**
    *   **Goal:** Gracefully handle issues and inform the user.
    *   **Steps:**
        *   Implement try-catch blocks for API calls, file parsing, and other potentially failing operations.
        *   Provide clear, user-friendly error messages in the UI (tooltip or popup) when things go wrong, instead of just logging to console.

3.  **Code Comments & Clarity:**
    *   **Goal:** Make the code understandable for yourself in the future and for any potential contributors.
    *   **Steps:** Add comments to explain complex logic, function purposes, and data structures.

4.  **Consider Linting & Formatting:**
    *   **Goal:** Maintain consistent code style and catch potential errors early.
    *   **Steps (Optional, but highly recommended):**
        *   Set up ESLint (for JavaScript linting) and Prettier (for code formatting).
        *   Add their configuration files (e.g., `.eslintrc.js`, `.prettierrc.json`) to your project.
        *   Run them regularly.

5.  **API Key Security (User Awareness):**
    *   **Goal:** Ensure users understand how their API key is handled.
    *   **Steps:**
        *   Clearly state in your `README.md` and options page that the API key is stored locally in the browser's storage and is sent directly to the AI provider's API (Google).
        *   Advise users to protect their API key.
