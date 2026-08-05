## Korean Lookup Rework Plan

**Current direction:** keep the extension focused on Korean, remove subtitle handling, and make the hover popup the main interaction surface.

### Completed
1. Local lookup path: hover extraction, candidate generation, and dictionary ranking from packaged JSON seed.
2. Stable and interactive hover popup with Gemini analysis and AnkiConnect export capabilities.
3. Hybrid Korean Morphological Segmenter & Lemmatizer pipeline (`korean_jamo.js`, `korean_lemmatizer.js`, `korean_pipeline.js`) with Hangul Jamo decomposition, particle stripping, honorifics, tenses, and irregular verb/adjective de-conjugation (ㅂ, ㄷ, ㄹ, ㅅ, ㅎ, ㅡ, 르 불규칙).
4. Offscreen Document WASM Morphological Analyzer (`offscreen.html`, `offscreen.js`, `lib/garu/`) using Garu-ko WASM (~1.8 MB total assets) for high-accuracy offline stem extraction.
5. Local IndexedDB Dictionary Engine (`dictionary_db.js`) for querying local dictionary entries.
6. **Real KoELECTRA INT8 ONNX Progressive Context Reranker** (`onnx_reranker.js`, `lib/models/koelectra_small_v3_int8.onnx`, `lib/onnx/wordpiece_tokenizer.js`) with real ONNXRuntime neural session inference, [CLS] embedding cosine similarity scoring, and settings toggle.
7. Fixed WASM full-sentence query bug, connected end-to-end background message routing, wired IndexedDB fallback lookups, and throttled mousemove events.

### Next
1. Build bulk IndexedDB term bank importer UI / script for full KRDICT term banks (`dictionaries/KO-EN.KRDICT`).
2. Interactive candidate selection chips inside hover tooltip UI for manual lemma switching.
