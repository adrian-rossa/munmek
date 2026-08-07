# Munmek (문맥) — Korean Context Lookup

**Munmek** is a Chromium browser extension for fast, context-aware Korean word lookups. It aims to solve language ambiguity that makes Korean difficult for beginners. This is done by combining a local offline termbank engine (supporting Yomichan / KRDICT imports), a hybrid morphological analyzer (Garu-ko), neural KoELECTRA candidate reranking, a Multilingual E5 model for reranking definition results and optional Google Gemini explanations for further context-aware definitions and explanations. This extension also features ASBPlayer subtitle support, and interactive AnkiConnect flashcard exports.

In its current vibe coded state this extension serves as a **proof of concept**. I will rework it from scratch for better maintainability and stability if I feel like demand is there and it proves useful.
Meanwhile [Kimchi Reader](https://kimchi-reader.app/) or [Migaku](https://migaku.com/) are more polished and actively maintained paid alternatives with a similar featureset.
Credits for the amazing [blog post](https://kimchi-reader.app/blog/int8-cpu-korean-disambiguation) regarding the KoELECTRA INT8 Reranker go to Kimchi Readers developer @Alanoor.

---

## Key Features

- 🔍 **Hover Word & Context Scanning**: Hold `Shift` (configurable) and hover over any Korean word on web pages or ASBPlayer subtitle overlays to inspect definitions and grammar.
- ⚡ **Hybrid Morphological Lemmatizer**:
  - **Tier 1 (Instant Pure-JS Rule Engine)**: Hangul Jamo decomposition (초성/중성/종성), particle (조사) stripping, honorific/tense recovery, and irregular verb/adjective de-conjugations (`ㅂ`, `ㄷ`, `ㄹ`, `ㅅ`, `ㅎ`, `ㅡ`, `르`).
  - **Tier 2 (Garu-ko WASM Analyzer)**: Runs a compact WebAssembly analyzer (~1.8 MB) inside a Manifest V3 Offscreen Document to extract base dictionary stems offline.
- 🧠 **Multi-Stage Progressive Neural Reranker & Sense Preselector**:
  - **Stage 1 (KoELECTRA INT8 ONNX, ~14.3 MB)**: Runs pure Korean candidate deinflection lemma reranking inside a Manifest V3 Offscreen Document, ranking candidate stems (e.g. `[듣다]` vs `[들다]`, `[짓다]` vs `[지다]`).
  - **Stage 2 (Multilingual E5 INT8 ONNX, ~118 MB, EXPERIMENTAL)**: Optionally computes cross-lingual bi-encoder vector embeddings mapping Korean sentence context directly to multilanguage definitions for semantic sense disambiguation. Features **WebGPU Hardware Acceleration** (experimental, disabled by default) with automatic WASM SIMD CPU fallback. You can also import precomputated vector files to speed up reranking further. Currently this feature needs more fine-tuning and is a work in progress.
- 🤖 **On-Demand Gemini AI & Multi-Group Auto-Tab Switcher**: Click "Ask Gemini" inside the hover tooltip for context-aware grammar notes, clause analysis, and nuances. Gemini matching searches across all candidate chunk groups (`dictGroups`), matches base lemmas, filters out dummy conjugation stubs, and automatically switches the active candidate tab to the matched entry. If no local dictionary entry matches, Quick LLM Lookup automatically provides concise contextual definitions to fill the gaps.
- 📄 **Extension Pin Bar Context Extractor**: Extract active webpage or subtitle content, automatically summarize them with Gemini, and attach them as additional background context for LLM lookups.
- 🎴 **Interactive AnkiConnect Card Export**: One-click card export to Anki desktop with custom deck selection, note types, and dynamic field mapping (including custom LLM JSON fields). Supports creating new cards or updating the last created card (e.g., from ASBPlayer).

---

## Installation & Setup Guide

### 1. Prerequisites
- **Browser**: Google Chrome, Brave, Microsoft Edge, or any Chromium-based browser.
- **Anki Desktop** *(Optional, for card export)*: Anki installed with the [AnkiConnect Add-on](https://ankiweb.net/shared/info/2055492159) (Add-on Code: `2055492159`).
- **Gemini API Key** *(Optional, for AI explanations)*: Get a free key from [Google AI Studio](https://aistudio.google.com/apikey) and set the models name in the extension settings. I recommend using a flash-lite model for speed and low cost. You can also set 'gemini-flash-lite-latest' to automatically get routed to the current model but slightly older models are usually the cheaper option. The extension is designed with token usage in mind, so the Gemini free tier should be sufficient for moderate usage.

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
   - Download a Yomichan-format KRDICT `.zip` archive (e.g. `KO-EN.KRDICT.No.Examples.zip`). You can find compatible dictionaries [here](https://github.com/Lyroxide/yomitan-ko-dic/releases). In my testing I used the No Examples Versions.
   - Click **Import Term Bank / Zip** and select the `.zip` file.
   - Adjust dictionary priority order using **▲ Up** and **▼ Down** buttons.
3. **AnkiConnect Setup**:
   - Ensure Anki is running on your computer.
   - Click **Test Connection**.
   - Select your target **Deck**, **Note Type**, and map Munmek placeholders (`{{word}}`, `{{base}}`, `{{definition}}`, `{{sentence}}`, etc.) to your note fields.

<details>
<summary>⚡ <strong>Offline Vector Precomputation Guide (GPU Accelerated)</strong></summary>

Precomputing definition vectors locally using your computer's GPU speeds up sense reranking for offline lookups down to **<5ms**, completely bypassing live ONNX model evaluation (works for both WASM CPU and WebGPU settings).

### Step-by-Step Instructions:
0. Navigate to the Extension-Folder using `cd`

1. **Install Python dependencies**:
   ```bash
   pip install -r scripts/requirements.txt
   ```
2. **Run GPU Precomputation**:
   Run the precomputation script passing your Yomichan dictionary `.zip` file:
   ```bash
   python scripts/precompute_definition_vectors.py "path/to/KRDICT-KO-EN.zip"
   ```
   *(Uses DirectML GPU hardware acceleration)*

3. **Import Vector Cache into Extension**:
   - The script outputs a compact binary file `[dict_name]_vectors.vec.bin` in `scripts/` (~79 MB).
   - In **Munmek Settings**, click **"📥 Import Vector File"** next to your installed dictionary and select the `.vec.bin` file.
   - The badge **"⚡ Vector Cached"** will appear! Offline lookups will now perform sense reranking more quickly.

</details>

---

## Usage Guide

- **Hover Lookup**: Hold `Shift` (or your chosen modifier key) and move your mouse over any Korean word on a webpage or ASBPlayer video overlay.
- **Switch Candidates**: Click candidate chips (e.g. `[듣다]`, `[들다]`) in the tooltip to view alternative base form definitions. In case there is no local definition available clicking the candidate chip will trigger a quick LLM lookup for a definition.
- **Ask Gemini**: Click **Ask Gemini** inside the popup to generate more detailed and context-aware definitions, structural grammar breakdowns and context notes for the sentence.
- **Export Flashcard**: Click **Send to Anki** or `+ Anki` on a specific definition tab to add or update your card.
- **Extract Context**: Click the Munmek toolbar icon to summarize page text or video subtitles for background AI context.

---

## Architecture & Project Structure

```
munmek/
├── manifest.json              # Manifest V3 Extension Manifest
├── package.json               # Dependencies and test script definition
├── README.md                  # Project documentation & setup guide
├── scripts/
│   ├── export_koelectra_onnx.py  # Export PyTorch KoELECTRA to INT8 ONNX
│   ├── export_multilingual_onnx.py # Export PyTorch Multilingual-E5 to INT8 ONNX
│   ├── precompute_definition_vectors.py # DirectML GPU offline definition vector precomputator
│   └── requirements.txt          # Python dependencies for GPU vector precomputation
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
│   │   └── onnx_reranker.js   # Two-stage KoELECTRA + Multilingual E5 neural reranker module
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
│   ├── models/                # KoELECTRA INT8 ONNX, Multilingual E5 INT8 ONNX & vocab
│   ├── onnx/                  # ONNXRuntime-Web engine & WordPiece tokenizer
│   └── jszip.min.js           # ZIP extraction library for termbank imports
└── test/                      # Vitest automated test suite (33 passing unit tests)
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
- Local rule-based & Multilingual E5 homonym entry reordering & definition tab preselection (`test/koelectra_reranker.test.js`)
- Two-stage neural candidate deinflection & multilingual dictionary sense tab ranking (`test/two_stage_neural_pipeline.test.js`)
- Gemini definition matching and candidate scoping (`test/gemini_matcher.test.js`)
- Background messaging and Anki template rendering (`test/background_template.test.js`)

---

## Credits & Technologies Used

Munmek is made possible thanks to the following open-source libraries, models, and services:

| Technology / Resource | Author / Provider | License | Usage in Munmek |
| :--- | :--- | :--- | :--- |
| [Garu-ko](https://github.com/ongjin/garu) | phlummox | **MIT** | WebAssembly Korean morphological analyzer |
| [KoELECTRA](https://github.com/monologg/KoELECTRA) | Park Jangwon (monologg) | **Apache 2.0** | Stage 1 candidate deinflection reranker neural model |
| [Multilingual E5 Small](https://huggingface.co/intfloat/multilingual-e5-small) | Microsoft / Intfloat | **MIT** | Stage 2 cross-lingual dictionary sense tab neural model |
| [ONNXRuntime-Web](https://github.com/microsoft/onnxruntime) | Microsoft | **MIT** | Local WebAssembly neural inference engine |
| [JSZip](https://github.com/Stuk/jszip) | Stuart Knightley | **MIT / GPLv3** | ZIP archive unpacker for dictionary imports |
| [Google Gemini API](https://ai.google.dev/) | Google DeepMind | **API ToS** | On-demand sentence & grammar analysis |
| [AnkiConnect](https://github.com/FooSoft/anki-connect) | FooSoft | **GPLv3** | Anki desktop HTTP API integration |
| [KRDICT](https://krdict.korean.go.kr/) | National Institute of Korean Language | **CC-BY-SA 2.0 KR** | User-imported dictionary data source |

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
