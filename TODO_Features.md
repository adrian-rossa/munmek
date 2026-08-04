## Korean Lookup Rework Plan

**Current direction:** keep the extension focused on Korean, remove subtitle handling, and make the hover popup the main interaction surface.

### Now
1. Finish the local lookup path: hover extraction, candidate generation, and dictionary ranking from the packaged JSON seed.
2. Keep the hover popup stable and interactive so Gemini and Anki actions stay available while the user is reading.
3. Remove any leftover console noise or dead code paths that still reference subtitles or multi-language mode.

### Next
1. Replace the lightweight candidate heuristics with a real Korean segmenter or lemmatizer backend.
2. Add ONNX reranking once the lookup pipeline is stable enough to benefit from it.
3. Expand the local dictionary data and decide later whether to move it into IndexedDB or SQLite.

### Removed from scope
1. Netflix subtitle extraction and SRT upload.
2. Multi-language support for now.
3. Debug-only UI and unused settings.
