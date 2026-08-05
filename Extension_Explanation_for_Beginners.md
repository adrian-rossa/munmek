# Extension Codebase Guide for Beginners

This document explains each file in your project folder in simple terms so you can easily understand how the pieces work together.

---

## 1. Core Extension Configuration

### `manifest.json`
Think of `manifest.json` as your extension's **ID card and instruction manual** for Chrome.
It tells Chrome:
- The extension's name, version, and description.
- What permissions it needs (like `storage` for settings and `offscreen` for running WebAssembly).
- Which scripts run automatically on web pages (`src/content/`).
- Which background worker handles background tasks (`src/background/background.js`).

---

## 2. Page Interaction & Lookup Scripts (`src/content/` & `src/nlp/`)

### `src/content/content.js`
This script runs directly inside web pages. It listens to mouse movement and keyboard modifier keys (`Shift`), extracts hovered Korean words and surrounding sentence context, and coordinates dictionary lookups.

### `src/content/content_ui.js` & `src/content/content.css`
`content_ui.js` generates the HTML template cards, candidate switching chips, and definition tabs for the hover popup. `content.css` defines all visual styles, gradients, and font properties.

### `src/nlp/korean_jamo.js`
Korean syllables like `한` are made of individual alphabet letters (Jamos: `ㅎ` + `ㅏ` + `ㄴ`). This script breaks Hangul characters down into their initial consonant (초성), vowel (중성), and final consonant (종성 / 받침) and builds them back together.

### `src/nlp/korean_lemmatizer.js`
Korean words conjugate based on tense, politeness, and grammar (e.g. `들어요` comes from `듣다`, `평화로웠던` comes from `평화롭다`). This file contains rules to remove grammar particles (조사) and restore conjugated verbs and adjectives to their base dictionary forms.

### `src/nlp/korean_pipeline.js`
This is the **orchestrator script**. It takes a hovered word, runs the local rules from `korean_lemmatizer.js`, requests background WASM results from Garu-ko, and ranks the best candidate dictionary words with confidence scores and rule tags.

### `src/nlp/dictionary_db.js`
This script manages a local browser database (**IndexedDB** called `MunmekDictionaryDB`). It allows the extension to search large dictionary entries offline.

---

## 3. Offscreen Document & WebAssembly (`src/offscreen/`)

### `src/offscreen/offscreen.html` & `src/offscreen/offscreen.js`
In Chrome Manifest V3, WebAssembly (WASM) models must be run in a separate background document called an **Offscreen Document**. `offscreen.js` initializes the Garu-ko WASM morphological analyzer and responds to analysis requests from `background.js`.

### `lib/garu/`
Contains the bundled WebAssembly binary (`garu_wasm_bg.wasm`) and lightweight model data (`base.gmdl`) used by Garu-ko for offline Korean stem analysis (~1.8 MB total).

---

## 4. Background Worker & User Interfaces

### `src/background/background.js`
Runs in the background service worker. It manages the offscreen document lifecycle, sends API calls to Google Gemini when you click "Ask Gemini", and sends card data to AnkiConnect.

### `src/options/options.html`, `options.js` & `options.css`
The settings page where users configure their Gemini API Key, prompt, dictionary priority ordering, and AnkiConnect deck settings.

### `src/popup/popup.html`, `popup.js` & `popup.css`
The extension pin bar popup window that allows users to extract active webpage article text or subtitle overlays into active background context for Gemini.

---

## 5. Neural Reranking & Automated Testing

### `src/nlp/onnx_reranker.js`
Runs local ONNXRuntime-Web neural inference (`koelectra_small_v3_int8.onnx`) inside the offscreen document. It calculates sentence-to-lemma embedding cosine similarities to disambiguate homonyms.

### `test/`
Contains automated unit tests run with Vitest (`npx vitest run`). These tests verify Jamo decomposition, particle stripping, verb de-conjugation, IndexedDB lookups, and Anki card field template formatting.
