#!/usr/bin/env python3
"""
Pre-compute Definition Vectors for Korean Multilingual Dictionaries (English, Japanese, German, Chinese, etc.)
Model: intfloat/multilingual-e5-small (384-dimensional embeddings)
Outputs:
  - lib/models/vectors.bin : Binary file storing Int8 quantized definition vectors (384 bytes each)
  - lib/models/vector_index.json : Mapping of definition text hashes/keys to byte offset in vectors.bin
"""

import os
import sys
import json
import hashlib
import struct
import numpy as np
import torch
from transformers import AutoTokenizer, AutoModel

# Force UTF-8 encoding for stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

MODEL_NAME = "intfloat/multilingual-e5-small"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "..", "lib", "models")
VECTORS_BIN_PATH = os.path.join(OUTPUT_DIR, "vectors.bin")
INDEX_JSON_PATH = os.path.join(OUTPUT_DIR, "vector_index.json")

import re

def clean_def_text(def_text: str) -> str:
    """Clean definition text by removing parens, brackets, and extra spaces."""
    cleaned = re.sub(r'\([^)]*\)', '', def_text)
    cleaned = re.sub(r'\[[^\]]*\]', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().lower()
    return cleaned

def hash_def_text(def_text: str) -> str:
    """Generate deterministic MD5 hex string for clean definition text."""
    clean = clean_def_text(def_text)
    return hashlib.md5(clean.encode('utf-8')).hexdigest()

def mean_pooling(model_output, attention_mask):
    token_embeddings = model_output[0] # First element of model_output contains all token embeddings
    input_mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    return torch.sum(token_embeddings * input_mask_expanded, 1) / torch.clamp(input_mask_expanded.sum(1), min=1e-9)

def quantize_float32_to_int8(vec_f32: np.ndarray) -> np.ndarray:
    """Quantize normalized Float32 embedding vector (-1.0 to 1.0) to Int8 (-128 to 127)."""
    clamped = np.clip(vec_f32 * 127.0, -128, 127)
    return np.round(clamped).astype(np.int8)

def compute_definition_embeddings(definitions, model, tokenizer, device='cpu', batch_size=32):
    print(f"Computing embeddings for {len(definitions)} definitions...")
    results = {}
    
    formatted_passages = [f"passage: {clean_def_text(d)}" for d in definitions]
    
    for i in range(0, len(formatted_passages), batch_size):
        batch_text = formatted_passages[i:i + batch_size]
        batch_defs = definitions[i:i + batch_size]
        
        encoded = tokenizer(batch_text, padding=True, truncation=True, max_length=64, return_tensors='pt').to(device)
        with torch.no_grad():
            outputs = model(**encoded)
            embeddings = mean_pooling(outputs, encoded['attention_mask'])
            # Normalize embeddings to unit length (L2 norm)
            embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
            
        embeddings_np = embeddings.cpu().numpy()
        for idx, def_str in enumerate(batch_defs):
            key = hash_def_text(def_str)
            int8_vec = quantize_float32_to_int8(embeddings_np[idx])
            results[key] = int8_vec
            
    return results

def main():
    print(f"[1/4] Loading {MODEL_NAME} PyTorch model & tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModel.from_pretrained(MODEL_NAME)
    model.eval()

    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model.to(device)
    print(f"Running inference on device: {device}")

    # Built-in definition list for common Korean-English/Japanese dictionary senses
    sample_definitions = [
        "call for; call out for To ask someone to come or draw attention",
        "sing To sing a song or tune with a voice",
        "quote To quote a price",
        "full Feeling one stomach is stuffed after eating food",
        "呼ぶ【よぶ】 人를来させる",
        "歌う【うたう】 節をつけて声で歌を歌う",
        "唱える【となえる】",
        "wear To wear a hat or glasses on face",
        "use To use money or time or tools",
        "write To write or record words or text on paper with a pen or pencil",
        "call; refer to by name To call or refer to someone or something by a name in a language",
        "listen To listen to music or sound with ears",
        "build To build a house or structure",
        "bitter Having a bitter taste like medicine"
    ]

    # Automatically scan dictionaries/ for Yomichan termbank files if present
    dict_dir = os.path.join(SCRIPT_DIR, "..", "dictionaries")
    if os.path.exists(dict_dir):
        import glob
        term_files = glob.glob(os.path.join(dict_dir, "*", "term_bank_*.json"))
        if term_files:
            print(f"Found {len(term_files)} dictionary termbank files in {dict_dir}...")
            def extract_texts(obj):
                txts = []
                if isinstance(obj, str):
                    if obj.strip(): txts.append(obj.strip())
                elif isinstance(obj, list):
                    for sub in obj: txts.extend(extract_texts(sub))
                elif isinstance(obj, dict):
                    if 'content' in obj: txts.extend(extract_texts(obj['content']))
                return txts

            for tf in term_files:
                try:
                    with open(tf, 'r', encoding='utf-8') as fp:
                        data = json.load(fp)
                        if isinstance(data, list):
                            for entry in data:
                                if len(entry) > 5:
                                    extracted = extract_texts(entry[5])
                                    for t in extracted:
                                        if len(t) > 3 and not t.isdigit():
                                            sample_definitions.append(t)
                except Exception as e:
                    print(f"Notice: Error reading {tf}: {e}")

    # If additional definition file or JSON provided via argument
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            extra_defs = json.load(f)
            if isinstance(extra_defs, list):
                sample_definitions.extend(extra_defs)

    # Deduplicate definitions while preserving order
    unique_defs = list(dict.fromkeys(sample_definitions))

    print(f"[2/4] Processing {len(unique_defs)} unique dictionary definition passages...")
    key_to_vec = compute_definition_embeddings(unique_defs, model, tokenizer, device=device)

    print(f"[3/4] Packaging vectors to Int8 binary file {VECTORS_BIN_PATH}...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    vector_index = {}
    current_offset = 0

    with open(VECTORS_BIN_PATH, 'wb') as bin_file:
        for key, int8_arr in key_to_vec.items():
            bytes_data = int8_arr.tobytes()
            bin_file.write(bytes_data)
            vector_index[key] = {
                "offset": current_offset,
                "length": len(bytes_data)
            }
            current_offset += len(bytes_data)

    print(f"[4/4] Writing vector index JSON to {INDEX_JSON_PATH}...")
    with open(INDEX_JSON_PATH, 'w', encoding='utf-8') as idx_file:
        json.dump(vector_index, idx_file, indent=2)

    bin_size = os.path.getsize(VECTORS_BIN_PATH)
    print(f"[SUCCESS] Successfully pre-computed {len(key_to_vec)} definition vectors!")
    print(f"Vectors binary: {VECTORS_BIN_PATH} ({bin_size} bytes)")
    print(f"Vector index:   {INDEX_JSON_PATH}")

if __name__ == '__main__':
    main()
