"""LLM contextual-analysis layer.

Explains audit events that the `detection` layer has ALREADY flagged. The LLM
receives anomaly_score / status / severity as READ-ONLY facts and never
recomputes them. This package is physically separate from `detection/` on
purpose: detection DECIDES, analysis only EXPLAINS.
"""
