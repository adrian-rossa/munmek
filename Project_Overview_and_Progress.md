# Project Overview: Munmaek - AI Korean Word Lookup Extension

This document provides an overview of your Chrome extension project, "Munmek - context based AI Word Lookup," and tracks the progress we've made together.

## 1. What We're Building (The Big Picture)

Munmek is a Chrome browser extension designed to help users learn Korean by providing instant, context-aware dictionary lookups and AI explanations for Korean words on any webpage or video subtitle (including asbplayer).

Core functionality:
* **Word & Sentence Hover Detection**: Detects hovered words and surrounding sentence context on webpages and asbplayer subtitles.
* **Hybrid Morphological Analysis**: Uses a two-tier lemmatization pipeline:
  1. Instant synchronous pure-JS Jamo and rule engine (< 1ms).
  2. Offscreen WASM morphological analyzer (`garu-ko`, ~1.8 MB total assets) for statistical stem extraction.
* **KoELECTRA INT8 ONNX Progressive Context Reranker**: Real local ONNX neural network session (`koelectra_small_v3_int8.onnx`, 15.66 MB) with WordPiece tokenization and [CLS] embedding cosine similarity scoring.
* **Option C Hybrid IndexedDB Dictionary Engine**: In-memory sample dictionary + chunked term bank importer for uploading 100,000+ KRDICT / Yomichan entries to IndexedDB.
* **Interactive Hover Tooltip**: Displays surface form, matched lemma, POS tag, candidate switching chips, definitions, and action buttons.
* **Gemini Flash AI Explanations**: On-demand context-aware grammar explanations using Gemini Flash.
* **AnkiConnect Card Creation**: One-click card export and "update last card" mode for Anki.

## 2. Our Progress & Progress Tracker

- [x] **Local Lookup Path**: Hover extraction, candidate generation, and local dictionary matching.
- [x] **Interactive Tooltip UI**: Custom styled hover popup with candidate switching chips, definition tabs, cached Gemini analysis, and Anki export.
- [x] **Hangul Jamo Engine (`korean_jamo.js`)**: Syllable decomposition (초성, 중성, 종성) and composition.
- [x] **Rule-Based Morphological Lemmatizer (`korean_lemmatizer.js`)**: Particle stripping, copulas, and de-conjugation for regular & irregular Korean verbs/adjectives (ㅂ, ㄷ, ㄹ, ㅅ, ㅎ, ㅡ, 르).
- [x] **Pipeline Orchestrator (`korean_pipeline.js`)**: Scored candidate generation with async provider hooks.
- [x] **Offscreen WASM Morphological Analyzer (`offscreen.html`, `offscreen.js`, `lib/garu/`)**: Offscreen document host running Garu-ko WASM for high-accuracy offline stem recovery.
- [x] **Real KoELECTRA INT8 ONNX Progressive Context Reranker (`onnx_reranker.js`, `lib/models/koelectra_small_v3_int8.onnx`, `lib/onnx/wordpiece_tokenizer.js`)**: Local ONNX neural inference for homonym disambiguation.
- [x] **IndexedDB Termbank Engine & Importer UI (`dictionary_db.js`, `options.html`, `options.js`)**: Chunked term bank zip/json importer supporting 100,000+ entries with interactive Move Up/Down priority ordering.
- [x] **asbplayer Subtitle & Page Context Extractor (`content.js`, `popup.js`)**: Automatic sentence context extraction for asbplayer subtitles with background Gemini summarization.
- [x] **Automated Vitest Test Suite (`test/`)**: 13 unit tests verifying Jamo rules, particle stripping, irregular verb de-conjugation, IndexedDB queries, and Anki field template rendering.

## 3. Project Architecture & Key Files

* `manifest.json`: Manifest V3 extension configuration with Offscreen document permissions.
* `content.js`: Main content script injected into web pages; manages hover events, asbplayer subtitle detection, candidate switching, and tooltip UI.
* `korean_jamo.js`: Utility for Hangul syllable Jamo decomposition and composition.
* `korean_lemmatizer.js`: Morphological rule engine for Korean particle stripping and verb/adjective de-conjugation.
* `korean_pipeline.js`: Candidate generator pipeline that merges JS rules with async WASM results.
* `onnx_reranker.js`: Real KoELECTRA INT8 ONNX candidate reranker module.
* `dictionary_db.js`: IndexedDB engine for querying local dictionary entries and chunked term bank insertion.
* `offscreen.html` & `offscreen.js`: MV3 Offscreen document running Garu-ko WASM and ONNXRuntime-Web neural session offline.
* `lib/garu/`: Bundled Garu WASM binary (`garu_wasm_bg.wasm`) and model data (`base.gmdl`).
* `lib/models/`: Quantized KoELECTRA INT8 ONNX model (`koelectra_small_v3_int8.onnx`) and `vocab.txt`.
* `lib/onnx/`: ONNXRuntime-Web engine (`ort.all.min.js`) and `wordpiece_tokenizer.js`.
* `background.js`: Background Service Worker managing offscreen document lifecycle, Gemini API calls, and AnkiConnect messaging.
* `options.html` & `options.js`: Settings page with Gemini/Anki configuration, ONNX reranker toggle, and IndexedDB dictionary importer.
* `scripts/export_koelectra_onnx.py`: PyTorch script to export and quantize KoELECTRA models to INT8 ONNX.
