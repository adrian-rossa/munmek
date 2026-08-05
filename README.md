# Munmek (문맥) — Korean Context Lookup

**Munmek** is a powerful Chrome/Chromium browser extension for fast, context-aware Korean word lookups. It combines a local offline termbank engine (supporting Yomichan / KRDICT imports), a hybrid morphological analyzer, neural KoELECTRA candidate reranking, optional Google Gemini explanations, ASBPlayer subtitle support, and interactive AnkiConnect flashcard exports.

---

## Key Features

- 🔍 **Hover Word & Context Scanning**: Hold `Shift` (configurable) and hover over any Korean word on web pages or ASBPlayer subtitle overlays to inspect definitions and grammar.
- ⚡ **Hybrid Morphological Lemmatizer**:
  - **Tier 1 (Instant Pure-JS Rule Engine)**: Hangul Jamo decomposition (초성/중성/종성), particle (조사) stripping, honorific/tense recovery, and irregular verb/adjective de-conjugations (`ㅂ`, `ㄷ`, `ㄹ`, `ㅅ`, `ㅎ`, `ㅡ`, `르`).
  - **Tier 2 (Garu-ko WASM Analyzer)**: Runs a compact WebAssembly analyzer (~1.8 MB) inside a Manifest V3 Offscreen Document to extract base dictionary stems offline.
- 🧠 **KoELECTRA INT8 ONNX Candidate Reranker**: Runs local ONNXRuntime-Web neural model inference (`koelectra_small_v3_int8.onnx`) with WordPiece tokenization and `[CLS]` embedding cosine similarity scoring to disambiguate homonyms in context.
- 📚 **IndexedDB Termbank Engine & Priority Ranking**: Import full Yomichan KO-EN / KO-JP `.zip` or `.json` dictionary termbanks (e.g. KRDICT) to store 100,000+ entries in local IndexedDB. Customize dictionary search priority order with interactive Move Up / Move Down controls.
- 🤖 **On-Demand Gemini AI Explanations**: Click "Ask Gemini" inside the hover tooltip for context-aware grammar notes, clause analysis, and nuances. Sentence analyses are automatically cached across words in the same sentence.
- 📄 **Extension Pin Bar Context Extractor**: Extract active webpage article text or ASBPlayer video subtitles, automatically summarize them with Gemini for token efficiency, and attach them as background context for AI lookups.
- 🎴 **Interactive AnkiConnect Card Export**: One-click card export to Anki desktop with custom deck selection, note types, and dynamic field mapping (including custom LLM JSON fields). Supports creating new cards or updating the last created card (e.g., from ASBPlayer).

---

## Installation & Setup Guide

### 1. Prerequisites
- **Browser**: Google Chrome, Brave, Microsoft Edge, or any Chromium-based browser.
- **Anki Desktop** *(Optional, for card export)*: Anki installed with the [AnkiConnect Add-on](https://ankiweb.net/shared/info/2055492159) (Add-on Code: `2055492159`).
- **Gemini API Key** *(Optional, for AI explanations)*: Get a free key from [Google AI Studio](https://aistudio.google.com/apikey).

### 2. Installing the Extension
1. Clone or download this repository:
   ```bash
   git clone https://github.com/adrian-rossa/munmek.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** and select the root directory of the `munmek` project.
5. Pin the **Munmek** icon in your browser toolbar.

### 3. Extension Settings Configuration
Right-click the Munmek toolbar icon and select **Options** (or open `options.html`):

1. **Gemini Setup**: Paste your API key into the **API Key** field.
2. **Import Dictionaries**:
   - Download a Yomichan-format KRDICT `.zip` archive (e.g. `KRDICT-KO-EN.zip`).
   - Click **Import Term Bank / Zip** and select the `.zip` file.
   - Adjust dictionary priority order using **▲ Up** and **▼ Down** buttons.
3. **AnkiConnect Setup**:
   - Ensure Anki is running on your computer.
   - Click **Test Connection**.
   - Select your target **Deck**, **Note Type**, and map Munmek placeholders (`{{word}}`, `{{base}}`, `{{definition}}`, `{{sentence}}`, etc.) to your note fields.

---

## Usage Guide

- **Hover Lookup**: Hold `Shift` (or your chosen modifier key) and move your mouse over any Korean word on a webpage or ASBPlayer video overlay.
- **Switch Candidates**: Click candidate chips (e.g. `[듣다]`, `[들다]`) in the tooltip to view alternative base form definitions.
- **Ask Gemini**: Click **Ask Gemini** inside the popup to generate structural grammar breakdowns and context notes for the sentence.
- **Export Flashcard**: Click **Send to Anki** or `+ Anki` on a specific definition tab to add or update your card.
- **Extract Context**: Click the Munmek toolbar icon to summarize page text or video subtitles for background AI context.

---

## Architecture & Project Structure

```
munmek/
├── manifest.json              # Manifest V3 Extension Manifest
├── package.json               # Dependencies and test script definition
├── README.md                  # Project documentation & setup guide
├── src/
│   ├── background/
│   │   └── background.js      # Service Worker (Offscreen lifecycle, Gemini API, AnkiConnect)
│   ├── content/
│   │   ├── content.js         # Core content script (Hover detection, DOM scraping, Range math)
│   │   ├── content_ui.js      # Tooltip UI renderer & template engine
│   │   └── content.css        # Tooltip UI CSS stylesheet
│   ├── nlp/
│   │   ├── korean_jamo.js     # Hangul alphabet decomposition/composition utility
│   │   ├── korean_lemmatizer.js # Rule-based particle stripper & verb de-conjugator
│   │   ├── korean_pipeline.js # Candidate generator orchestrator
│   │   ├── dictionary_db.js   # IndexedDB engine for fast offline dictionary queries
│   │   └── onnx_reranker.js   # KoELECTRA neural reranker module
│   ├── offscreen/
│   │   ├── offscreen.html     # Offscreen document HTML container
│   │   └── offscreen.js       # Offscreen document host (Garu-ko WASM & ONNXRuntime-Web)
│   ├── options/
│   │   ├── options.html       # Extension settings UI
│   │   ├── options.js         # Extension settings controller
│   │   └── options.css        # Settings page CSS stylesheet
│   └── popup/
│       ├── popup.html         # Extension pin bar popup UI
│       ├── popup.js           # Extension pin bar popup controller
│       └── popup.css          # Popup CSS stylesheet
├── lib/
│   ├── garu/                  # Garu-ko WASM binary & model files
│   ├── models/                # Quantized KoELECTRA INT8 ONNX model & vocab.txt
│   ├── onnx/                  # ONNXRuntime-Web engine & WordPiece tokenizer
│   └── jszip.min.js           # ZIP extraction library for termbank imports
└── test/                      # Vitest automated test suite
```

---

## Development & Automated Testing

To run the automated test suite locally:

```bash
# Install dependencies
npm install

# Execute Vitest test suite
npx vitest run
```

The test suite validates:
- Rule-based Hangul Jamo decomposition and irregular verb/adjective de-conjugations (`test/korean_lemmatizer.test.js`)
- IndexedDB termbank storage & multi-dictionary priority queries (`test/dictionary_db.test.js`)
- Background messaging and Anki template rendering (`test/background_template.test.js`)

---

## Credits & Technologies Used

Munmek is made possible thanks to the following open-source libraries, models, and services:

| Technology / Resource | Author / Provider | License | Usage in Munmek |
| :--- | :--- | :--- | :--- |
| [Garu-ko](https://github.com/phlummox/garu-ko) | phlummox | **MIT** | WebAssembly Korean morphological analyzer |
| [KoELECTRA](https://github.com/monologg/KoELECTRA) | Park Jangwon (monologg) | **Apache 2.0** | INT8 ONNX candidate reranking neural model |
| [ONNXRuntime-Web](https://github.com/microsoft/onnxruntime) | Microsoft | **MIT** | Local WebAssembly neural inference engine |
| [JSZip](https://github.com/Stuk/jszip) | Stuart Knightley | **MIT / GPLv3** | ZIP archive unpacker for dictionary imports |
| [Google Gemini API](https://ai.google.dev/) | Google DeepMind | **API ToS** | On-demand sentence & grammar analysis |
| [AnkiConnect](https://github.com/FooSoft/anki-connect) | FooSoft | **GPLv3** | Anki desktop HTTP API integration |
| [KRDICT](https://krdict.korean.go.kr/) | National Institute of Korean Language | **CC-BY-SA 2.0 KR** | User-imported dictionary data source |

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
