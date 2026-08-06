import os
import sys
import torch

# Force UTF-8 encoding for Windows terminal output
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from transformers import AutoTokenizer, AutoModel
import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType

MODEL_NAME = "intfloat/multilingual-e5-small"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "lib", "models")
ONNX_FP32_PATH = os.path.join(OUTPUT_DIR, "multilingual_e5_small_fp32.onnx")
ONNX_INT8_PATH = os.path.join(OUTPUT_DIR, "multilingual_e5_small_int8.onnx")
VOCAB_JSON_PATH = os.path.join(OUTPUT_DIR, "multilingual_vocab.json")

class ModelWrapper(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask):
        outputs = self.model(input_ids=input_ids, attention_mask=attention_mask)
        return outputs.last_hidden_state

def export_to_onnx():
    print(f"[1/3] Loading PyTorch model & tokenizer for {MODEL_NAME}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    base_model = AutoModel.from_pretrained(MODEL_NAME)
    base_model.eval()

    model = ModelWrapper(base_model)
    model.eval()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    text = "query: 하늘에서 눈이 내려와요"
    inputs = tokenizer(text, return_tensors="pt", max_length=64, padding="max_length", truncation=True)

    print(f"[2/3] Exporting FP32 ONNX model to {ONNX_FP32_PATH}...")
    torch.onnx.export(
        model,
        (inputs["input_ids"], inputs["attention_mask"]),
        ONNX_FP32_PATH,
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            "input_ids": {0: "batch_size", 1: "sequence_length"},
            "attention_mask": {0: "batch_size", 1: "sequence_length"},
            "last_hidden_state": {0: "batch_size", 1: "sequence_length"}
        },
        opset_version=14,
        dynamo=False
    )

    print(f"[3/3] Quantizing FP32 ONNX model to INT8: {ONNX_INT8_PATH}...")
    quantize_dynamic(
        model_input=ONNX_FP32_PATH,
        model_output=ONNX_INT8_PATH,
        weight_type=QuantType.QUInt8
    )

    # Save tokenizer vocab/config for JS execution
    tokenizer.save_pretrained(OUTPUT_DIR)

    # Remove temporary FP32 ONNX binary
    if os.path.exists(ONNX_FP32_PATH):
        os.remove(ONNX_FP32_PATH)

    print("[SUCCESS] Multilingual E5 Small INT8 ONNX model exported successfully!")
    print(f"INT8 Model File: {ONNX_INT8_PATH}")

if __name__ == "__main__":
    export_to_onnx()
