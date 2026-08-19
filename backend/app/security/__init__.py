"""Security feature package: algorithmic detection + (later) LLM explanation.

`detection/`  -- autoencoder scoring + rule engine + 3-tier classification.
`analysis/`   -- LLM contextual analysis (added in a later phase).

These two layers are kept physically separate on purpose: the detection layer
DECIDES (status, score); the analysis layer only EXPLAINS. The LLM never
computes or changes a score or a status.
"""
