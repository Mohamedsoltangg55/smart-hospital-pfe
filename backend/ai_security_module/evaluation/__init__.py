"""
ai_security_module.evaluation
-----------------------------
Self-contained offline evaluation module: extends the synthetic dataset,
trains four anomaly-detection models on the same folds via stratified
K-Fold cross-validation, and writes a side-by-side comparison report.

NOTHING in this package is imported by the live FastAPI request path. It
is invoked exclusively via:

    docker exec hospital_backend python -m ai_security_module.evaluation.run_comparison
"""
