"""
Export monologg/koelectra-small-v3-discriminator to INT8 Quantized ONNX format.
Saves model into lib/models/koelectra_small_v3_int8.onnx and vocab.txt.
"""
import os
import sys
import shutil
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')
import torch
from transformers import AutoTokenizer, AutoModel
from onnxruntime.quantization import quantize_dynamic, QuantType

class ElectraONNXWrapper(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask):
        outputs = self.model(input_ids=input_ids, attention_mask=attention_mask)
        return outputs.last_hidden_state

def main():
    out_dir = Path(__file__).parent.parent / "lib" / "models"
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Loading KoELECTRA Small v3 Discriminator model...")
    model_name = "monologg/koelectra-small-v3-discriminator"
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    
    # Save vocab.txt
    vocab_file = out_dir / "vocab.txt"
    tokenizer.save_vocabulary(str(out_dir))
    print(f"Saved vocabulary to {vocab_file}")

    # Export base PyTorch model to ONNX
    base_model = AutoModel.from_pretrained(model_name)
    base_model.eval()

    wrapper = ElectraONNXWrapper(base_model)
    wrapper.eval()

    raw_onnx_path = out_dir / "koelectra_raw.onnx"
    quant_onnx_path = out_dir / "koelectra_small_v3_int8.onnx"

    dummy_input = tokenizer("음악을 들어요", return_tensors="pt")
    input_ids = dummy_input["input_ids"]
    attention_mask = dummy_input["attention_mask"]

    print("Exporting model to ONNX...")
    torch.onnx.export(
        wrapper,
        (input_ids, attention_mask),
        str(raw_onnx_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        dynamic_axes={
            "input_ids": {0: "batch_size", 1: "sequence_length"},
            "attention_mask": {0: "batch_size", 1: "sequence_length"},
            "last_hidden_state": {0: "batch_size", 1: "sequence_length"}
        },
        opset_version=17
    )

    print(f"Raw ONNX exported to {raw_onnx_path} ({raw_onnx_path.stat().st_size / 1024 / 1024:.2f} MB)")

    # Quantize to INT8
    print("Quantizing model to INT8...")
    quantize_dynamic(
        model_input=str(raw_onnx_path),
        model_output=str(quant_onnx_path),
        weight_type=QuantType.QUInt8
    )

    if raw_onnx_path.exists():
        raw_onnx_path.unlink()

    print(f"SUCCESS! Quantized INT8 ONNX model saved to {quant_onnx_path} ({quant_onnx_path.stat().st_size / 1024 / 1024:.2f} MB)")

if __name__ == "__main__":
    main()
