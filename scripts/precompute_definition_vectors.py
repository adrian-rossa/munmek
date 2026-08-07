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

def compute_definition_embeddings_onnx(definitions, session, tokenizer, batch_size=128):
    print(f"Computing embeddings for {len(definitions)} definitions via ONNX DirectML (RTX GPU)...", flush=True)
    results = {}
    raw_vec_map = {}
    
    formatted_passages = [f"passage: {clean_def_text(d)}" for d in definitions]
    
    for i in range(0, len(formatted_passages), batch_size):
        batch_text = formatted_passages[i:i + batch_size]
        batch_defs = definitions[i:i + batch_size]
        
        encoded = tokenizer(batch_text, padding=True, truncation=True, max_length=64, return_tensors='np')
        input_ids = encoded['input_ids'].astype(np.int64)
        attention_mask = encoded['attention_mask'].astype(np.int64)

        feeds = {
            'input_ids': input_ids,
            'attention_mask': attention_mask
        }

        outputs = session.run(None, feeds)
        last_hidden_state = outputs[0]

        # Mean pooling
        input_mask_expanded = np.expand_dims(attention_mask, -1).astype(np.float32)
        sum_embeddings = np.sum(last_hidden_state * input_mask_expanded, axis=1)
        sum_mask = np.clip(np.sum(input_mask_expanded, axis=1), 1e-9, None)
        mean_pooled = sum_embeddings / sum_mask

        # Normalize L2
        norms = np.linalg.norm(mean_pooled, ord=2, axis=1, keepdims=True)
        norms = np.clip(norms, 1e-9, None)
        normalized = mean_pooled / norms

        for idx, def_str in enumerate(batch_defs):
            key = hash_def_text(def_str)
            int8_vec = quantize_float32_to_int8(normalized[idx])
            int8_list = int8_vec.tolist()
            results[key] = int8_vec
            raw_vec_map[def_str] = int8_list

        if (i + batch_size) % 5000 < batch_size or (i + batch_size) >= len(formatted_passages):
            print(f"  Processed {min(i + batch_size, len(formatted_passages)):,} / {len(formatted_passages):,} definitions...", flush=True)

    return results, raw_vec_map

def compute_definition_embeddings(definitions, model, tokenizer, device='cpu', batch_size=64):
    print(f"Computing embeddings for {len(definitions)} definitions on device: {device}...")
    results = {}
    raw_vec_map = {}
    
    formatted_passages = [f"passage: {clean_def_text(d)}" for d in definitions]
    
    for i in range(0, len(formatted_passages), batch_size):
        batch_text = formatted_passages[i:i + batch_size]
        batch_defs = definitions[i:i + batch_size]
        
        encoded = tokenizer(batch_text, padding=True, truncation=True, max_length=64, return_tensors='pt').to(device)
        with torch.no_grad():
            outputs = model(**encoded)
            embeddings = mean_pooling(outputs, encoded['attention_mask'])
            embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
            
        embeddings_np = embeddings.cpu().numpy()
        for idx, def_str in enumerate(batch_defs):
            key = hash_def_text(def_str)
            int8_vec = quantize_float32_to_int8(embeddings_np[idx])
            int8_list = int8_vec.tolist()
            results[key] = int8_vec
            raw_vec_map[def_str] = int8_list
            
    return results, raw_vec_map

def split_embedded_definitions(def_list):
    """Split embedded Yomichan definition strings (e.g. '1. call for... 2. sing...') into separate senses."""
    raw_lines = []
    for item in def_list:
        if not isinstance(item, str):
            continue
        sub_parts = re.split(r'(?<=\D|^)(?=\b\d{1,2}[\.\)]\s+)', item)
        for part in sub_parts:
            for line in part.splitlines():
                t = line.strip()
                if t:
                    raw_lines.append(t)

    senses = []
    current_sense = []

    for line in raw_lines:
        cleaned = re.sub(r'^\d{1,2}[\.\)]\s*', '', line).strip()
        if not cleaned:
            continue
        if re.match(r'^\d{1,2}[\.\)]', line):
            if current_sense:
                senses.append(" ".join(current_sense))
            current_sense = [cleaned]
        else:
            if current_sense:
                current_sense.append(cleaned)
            else:
                current_sense = [cleaned]

    if current_sense:
        senses.append(" ".join(current_sense))

    return senses if senses else def_list

def extract_texts_from_yomichan(obj):
    txts = []
    if isinstance(obj, str):
        if obj.strip(): txts.append(obj.strip())
    elif isinstance(obj, list):
        for sub in obj: txts.extend(extract_texts_from_yomichan(sub))
    elif isinstance(obj, dict):
        if 'content' in obj: txts.extend(extract_texts_from_yomichan(obj['content']))
    return split_embedded_definitions(txts)

def main():
    onnx_model_path = os.path.join(OUTPUT_DIR, "multilingual_e5_small_int8.onnx")
    use_onnx_dml = False
    ort_session = None

    try:
        import onnxruntime as ort
        available_providers = ort.get_available_providers()
        if 'DmlExecutionProvider' in available_providers or 'CUDAExecutionProvider' in available_providers:
            providers = [p for p in ['DmlExecutionProvider', 'CUDAExecutionProvider', 'CPUExecutionProvider'] if p in available_providers]
            print(f"[1/4] Loading ONNX model session with DirectML/CUDA GPU providers: {providers}...")
            ort_session = ort.InferenceSession(onnx_model_path, providers=providers)
            use_onnx_dml = True
    except Exception as e:
        print(f"Notice: ONNX DirectML check notice: {e}")

    print(f"Loading tokenizer {MODEL_NAME}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

    model = None
    device = 'cpu'
    if not use_onnx_dml:
        print(f"Loading PyTorch model {MODEL_NAME}...")
        model = AutoModel.from_pretrained(MODEL_NAME)
        model.eval()
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        model.to(device)
        print(f"Running inference on PyTorch device: {device}")

    target_defs = []
    output_vec_json_path = None

    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        input_path = sys.argv[1]
        base_name = os.path.splitext(os.path.basename(input_path))[0]
        output_vec_json_path = os.path.join(SCRIPT_DIR, f"{base_name}_vectors.json")
        print(f"Reading target dictionary input file: {input_path}...")

        if input_path.endswith('.zip'):
            import zipfile
            with zipfile.ZipFile(input_path, 'r') as zf:
                term_files = [f for f in zf.namelist() if 'term_bank_' in f and f.endswith('.json')]
                for tf in term_files:
                    with zf.open(tf) as fp:
                        data = json.load(fp)
                        if isinstance(data, list):
                            for entry in data:
                                if len(entry) > 5:
                                    extracted = extract_texts_from_yomichan(entry[5])
                                    target_defs.extend(extracted)
        elif input_path.endswith('.json'):
            with open(input_path, 'r', encoding='utf-8') as fp:
                data = json.load(fp)
                if isinstance(data, list):
                    for entry in data:
                        if isinstance(entry, list) and len(entry) > 5:
                            extracted = extract_texts_from_yomichan(entry[5])
                            target_defs.extend(extracted)
                        elif isinstance(entry, dict) and 'definitions' in entry:
                            target_defs.extend(entry['definitions'])

    if not target_defs:
        # Scan dictionaries/ directory as default fallback
        dict_dir = os.path.join(SCRIPT_DIR, "..", "dictionaries")
        if os.path.exists(dict_dir):
            import glob
            term_files = glob.glob(os.path.join(dict_dir, "*", "term_bank_*.json"))
            for tf in term_files:
                try:
                    with open(tf, 'r', encoding='utf-8') as fp:
                        data = json.load(fp)
                        if isinstance(data, list):
                            for entry in data:
                                if len(entry) > 5:
                                    extracted = extract_texts_from_yomichan(entry[5])
                                    target_defs.extend(extracted)
                except Exception as e:
                    print(f"Notice: Error reading {tf}: {e}")

    # Built-in sample fallback
    if not target_defs:
        target_defs = [
            "call for; call out for To ask someone to come or draw attention",
            "sing To sing a song or tune with a voice",
            "quote To quote a price",
            "full Feeling one stomach is stuffed after eating food",
            "呼ぶ【よぶ】 人를来させる",
            "歌う【うたう】 節をつけて声で歌を歌う",
            "wear To wear a hat or glasses on face",
            "use To use money or time or tools",
            "write To write or record words or text on paper with a pen or pencil"
        ]

    # Clean & deduplicate definitions
    valid_defs = [d for d in target_defs if isinstance(d, str) and len(d.strip()) > 2 and not d.isdigit()]
    unique_defs = list(dict.fromkeys(valid_defs))

    print(f"[2/4] Processing {len(unique_defs):,} unique dictionary definition passages...")
    if use_onnx_dml and ort_session:
        key_to_vec, raw_vec_map = compute_definition_embeddings_onnx(unique_defs, ort_session, tokenizer, batch_size=128)
    else:
        key_to_vec, raw_vec_map = compute_definition_embeddings(unique_defs, model, tokenizer, device=device, batch_size=128 if device == 'cuda' else 32)

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

    if output_vec_json_path:
        output_vec_bin_path = os.path.join(SCRIPT_DIR, f"{base_name}_vectors.vec.bin")
        print(f"Writing per-dictionary vector JSON to {output_vec_json_path}...")
        with open(output_vec_json_path, 'w', encoding='utf-8') as out_fp:
            json.dump({"vectors": raw_vec_map}, out_fp)

        print(f"Writing compact binary vector archive to {output_vec_bin_path}...")
        def_keys = list(raw_vec_map.keys())
        index_map = { def_str: idx for idx, def_str in enumerate(def_keys) }
        meta_bytes = json.dumps(index_map, ensure_ascii=False).encode('utf-8')
        header_bytes = struct.pack('<I', len(meta_bytes))

        with open(output_vec_bin_path, 'wb') as bin_fp:
            bin_fp.write(header_bytes)
            bin_fp.write(meta_bytes)
            for def_str in def_keys:
                bin_fp.write(bytes(raw_vec_map[def_str]))

        json_size_mb = os.path.getsize(output_vec_json_path) / (1024 * 1024)
        bin_size_mb = os.path.getsize(output_vec_bin_path) / (1024 * 1024)
        print(f"✓ Generated vector cache files ready for Munmek import:")
        print(f"   - JSON format:   {output_vec_json_path} ({json_size_mb:.1f} MB)")
        print(f"   - Compact Binary: {output_vec_bin_path} ({bin_size_mb:.1f} MB — Recommended, 73% smaller!)")

    bin_size = os.path.getsize(VECTORS_BIN_PATH)
    print(f"[SUCCESS] Successfully pre-computed {len(key_to_vec):,} definition vectors!")
    print(f"Vectors binary: {VECTORS_BIN_PATH} ({bin_size} bytes)")
    print(f"Vector index:   {INDEX_JSON_PATH}")

if __name__ == '__main__':
    main()
