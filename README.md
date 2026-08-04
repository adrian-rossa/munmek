# Munmek - Korean Context Lookup

Munmek is a Korean hover-lookup extension built around a small local dictionary seed, optional Gemini enrichment, and AnkiConnect exports.

## What it does
- Detects a hovered Korean word and extracts nearby sentence context
- Looks up local dictionary entries from `korean_words.json`
- Lets you ask Gemini for a richer grammar or translation explanation on demand
- Sends cards to AnkiConnect with configurable deck, note type, and field mapping

## What changed
- Removed Netflix subtitle extraction and manual subtitle upload
- Removed the old multi-language direction and related clutter
- Kept the lookup surface focused on Korean

## Setup
1. Load the unpacked extension from `chrome://extensions`.
2. Open Settings and enter your Gemini API key if you want AI explanations.
3. Start AnkiConnect in Anki if you want card creation or updates.

## Notes
- The packaged dictionary sample lives in `korean_words.json`.
- The main interaction now lives in the in-page hover tooltip, not the browser-action popup.
- The local dictionary is intentionally small right now so the lookup pipeline can evolve around a cleaner core.
