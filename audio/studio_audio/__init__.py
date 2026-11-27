import os

# Must be set before torch is imported anywhere: lets any op MPS lacks fall back to CPU.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
