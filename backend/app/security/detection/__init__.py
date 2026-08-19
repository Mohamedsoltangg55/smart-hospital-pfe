"""Algorithmic anomaly-detection layer (non-LLM).

The PyTorch autoencoder produces a raw reconstruction error; this package
normalizes it, applies rule-based hard overrides, and assigns the final
NORMAL / SUSPICIOUS / CRITICAL status. `classifier.classify()` is the single
source of truth for an event's status.
"""
