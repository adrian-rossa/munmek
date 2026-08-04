# Understanding Your "Munmaek" Chrome Extension: A Beginner's Guide

Welcome! This guide will walk you through your "Munmaek - context based AI Word Lookup" extension, explaining what each part does and how they work together. 

Your "Munmaek" extension is designed to help you look up Korean words while you browse, especially when watching videos with subtitles.

1.  **Detect words:** When you hover your mouse over a Korean word on a webpage, it tries to identify that word. If you press the Shift key, it tries to capture the whole sentence.
2.  **Show definitions:** It then shows you a definition or translation of that word in a small pop-up window.
3.  **Use context:** It's designed to be "context-based," meaning it can use an uploaded SRT (subtitle) file to understand the surrounding text, which helps in providing more accurate lookups, especially with AI.
4.  **Work with Korean words:** It has a special focus on Korean, using an external file (like `korean_words.json` or files in the `dictionaries` folder) to help identify and define words.

## The Files in Your Extension: Who Does What?

Your extension is made up of several files, each with a specific job. Let's meet them:

### 1. `manifest.json` - The Blueprint or ID Card

*   **What it is:** This is the most important file. It's like the ID card or blueprint for your extension. It tells Chrome:
    *   The extension's name (`"name": "Munmaek - context based AI Word Lookup"`)
    *   Its version (`"version": "1.1"`)
    *   A short description (`"description": "Shows AI-powered definitions..."`)
    *   What permissions it needs (e.g., to run scripts on pages, access storage).
    *   Which files to use for different parts of the extension (like the background script, content script, popup, etc.).
    *   The icons to use.
*   **Why it's important:** Without this file, Chrome wouldn't know how to load or run your extension.
*   **Beginner's question:** "Why does it need so many permissions like `scripting`, `activeTab`, `storage`?"
    *   `scripting`: To run code (like `content.js`) on the web pages you visit to detect words.
    *   `activeTab`: To interact with the current tab you're looking at.
    *   `storage`: To save settings or data, like your API key or the content of an uploaded SRT file.
    *   `host_permissions`: (e.g., `https://generativelanguage.googleapis.com/`) To allow the extension to communicate with specific external services, in this case, Google's AI services.

### 2. `background.js` - The Behind-the-Scenes Helper

*   **What it is:** This script runs in the background, independently of any specific web page. It listens for events, like when you click the extension icon or when a content script sends it a message.
*   **Its jobs might include:**
    *   Managing the extension's overall state.
    *   Communicating with AI services (like Google's Generative Language API) to get definitions.
    *   Handling complex logic that doesn't need to be tied to a single webpage.
    *   Coordinating actions between different parts of the extension.
*   **Beginner's question:** "What's a `service_worker`?"
    *   In `manifest.json`, you'll see `background.js` is listed as a `service_worker`. This is a modern way Chrome handles background scripts. It's efficient because it only runs when needed and can be put to sleep to save resources.

### 3. `content.js` - The Page Interactor

*   **What it is:** This script is injected directly into the web pages you visit (as specified by `"matches": ["<all_urls>"]` in `manifest.json`).
*   **Its jobs include:**
    *   Detecting when you hover over a word or select a sentence with the Shift key.
    *   Extracting the hovered word or sentence from the webpage.
    *   Sending this word/sentence to `background.js` for processing (like getting a definition).
    *   Displaying the definition popup near the hovered word.
*   **Beginner's question:** "How can it see what's on the webpage?"
    *   `content.js` runs in the context of the webpage, so it can access and manipulate the page's content (the HTML, text, etc.). However, it runs in a somewhat isolated environment for security reasons but can communicate with other parts of your extension (like `background.js`) through messages.

### 4. `popup.html` & `popup.js` - The Mini-Window

*   **`popup.html`:** This is an HTML file that defines the structure and look of the small window that appears when you click your extension's icon in the Chrome toolbar.
*   **`popup.js`:** This JavaScript file adds interactivity to `popup.html`. For example, it might:
    *   Allow you to upload an SRT file.
    *   Show status information.
    *   Provide quick access to settings.
*   **Beginner's question:** "So this is like a tiny webpage?"
    *   Exactly! It uses the same web technologies (HTML, CSS, JavaScript) as regular webpages but in a small, focused window.

### 5. `options.html` & `options.js` - The Settings Page

*   **`options.html`:** This HTML file defines the structure of your extension's settings page. You can usually access this by right-clicking the extension icon and choosing "Options."
*   **`options.js`:** This JavaScript file makes the options page work. It would:
    *   Load any saved settings.
    *   Allow you to change settings (e.g., enter an API key for the AI service).
    *   Save those changes using `chrome.storage`.
*   **Beginner's question:** "Where are these settings saved?"
    *   Chrome provides a special storage area for extensions (`chrome.storage`) where they can save small amounts of data that persist even if you close the browser.

### 6. `korean_words.json` & `dictionaries/` folder - The Knowledge Base

*   **`korean_words.json`:** This is a JSON file. JSON is a common format for storing structured data. This file likely contains a list of Korean words and perhaps some basic information about them, or it might be used to assign unique IDs for parsing.
*   **`dictionaries/` folder (e.g., `KO-EN.KRDICT/`):** This folder seems to contain more detailed dictionary data, possibly split into multiple JSON files (`term_bank_1.json`, etc.). This is where the actual definitions or translations that your extension shows might come from, especially for offline lookups or as a primary source before consulting AI.
*   **How they are used:**
    *   When you hover over a word, the extension might first check these local files for a definition.
    *   The unique IDs mentioned in your project goals would likely be managed or referenced here to help the AI understand specific Korean words or grammar constructs.
*   **Beginner's question:** "Why use these files if there's an AI?"
    *   Local dictionaries are fast and don't require an internet connection for basic lookups.
    *   They can provide a baseline definition that the AI can then enhance with context.
    *   They can help in accurately identifying the root form of a Korean word, which is important for both dictionary lookup and AI processing.

### 7. `netflix_subtitle_extractor.js` - The Subtitle Grabber

*   **What it is:** This JavaScript file is likely a specialized `content_script` or a module used by `content.js`.
*   **Its job:** To specifically target Netflix and extract subtitle text from the video player. This text can then be used by the extension to provide context for word lookups or allow you to hover over words directly within the Netflix subtitles.
*   **Beginner's question:** "Why a separate file for Netflix?"
    *   Websites are structured differently. Extracting information from Netflix might require specific code that wouldn't work on other sites. Keeping it separate makes the main `content.js` cleaner.

### 8. `input_subtitle_file/` - Your Subtitles

*   **What it is:** This isn't part of the extension's code itself, but a folder in your project. The `Avatar...srt` file inside is an example of a subtitle file you might upload to the extension.
*   **How it's used:** The extension (likely through `popup.js` or `background.js`) would allow you to select an SRT file. It would then read this file to understand the dialogue and timing of a video. This context is invaluable for the AI to provide accurate, context-aware definitions.

### 9. `assets/` - Images and Icons

*   **What it is:** This folder holds image files, like `icon16.png`, `icon48.png`, `icon128.png`.
*   **How they are used:** These are the icons for your extension that you see in the Chrome toolbar, in the extensions management page, etc. The `manifest.json` file tells Chrome where to find these icons.

## How Do They Work Together? A Simple Scenario

Let's imagine you're browsing a Korean news website and have your extension active:

1.  **You hover over a Korean word.**
2.  **`content.js` (already running on the page) detects this.** It grabs the word.
3.  **`content.js` might quickly check `korean_words.json` or the `dictionaries/` files** for a basic definition or to identify the word.
4.  **For a more advanced/contextual definition, `content.js` sends a message to `background.js`** with the word and maybe the surrounding sentence (if you used Shift or if it has context from an SRT file or `netflix_subtitle_extractor.js`).
5.  **`background.js` receives the message.** If an SRT file was uploaded, it uses that context. It then might make a request to an external AI service (like Google's Generative Language API, using the API key you set in `options.js`).
6.  **The AI service processes the word and context, then sends back a definition.**
7.  **`background.js` receives the definition from the AI.**
8.  **`background.js` sends this definition back to `content.js`.**
9.  **`content.js` then displays this definition in a nice little popup** right there on the webpage, near the word you hovered over.

If you click the extension icon in the toolbar:
*   **`popup.html` is shown.**
*   **`popup.js` runs,** allowing you to, for example, upload an SRT file. If you do, `popup.js` might send the file content to `background.js` to store and use.

## Key Concepts for Beginners

*   **APIs (Application Programming Interfaces):**
    *   **Chrome APIs:** These are special tools Chrome provides for extensions to interact with the browser (e.g., `chrome.storage.sync.get()` to get saved settings, `chrome.runtime.sendMessage()` to send messages between scripts).
    *   **External APIs:** Like the Google Generative Language API. Your extension sends data to Google's servers, and Google's AI sends back a result.
*   **Events:** Extensions are often event-driven. This means they wait for something to happen (like a mouse hover, a tab update, or a message from another script) and then react to it.
*   **Asynchronous Operations:** Many tasks (like fetching data from the internet or reading a file) take time. JavaScript in extensions often uses asynchronous operations (like `Promises` or `async/await`) so that the extension doesn't freeze while waiting for these tasks to complete. This is a bit more advanced but crucial for smooth operation.

## What's Next?

Now that you have a basic understanding of the parts, you can start exploring the code in each file.
*   Look at `manifest.json` to see how everything is declared.
*   Open `content.js` to see how it detects words.
*   Check `background.js` to understand how it might call the AI.

Don't be afraid to experiment (maybe make a backup of your project first!). The best way to learn is by trying things out. Good luck with your extension development journey!
