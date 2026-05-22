"""
AI Security Module - Local Deep Learning Anomaly Detection for Hospital Audit Logs.

This module trains a PyTorch Autoencoder on healthcare audit-log behavior and
flags suspicious activity (off-hours access, rapid folder exfiltration,
unusual action patterns) at the moment each log is written to the database.

Entry points:
    - run_initial_setup.py : one-shot training pipeline
    - predict.check_live_log(entry, db) : production inference hook
"""

__version__ = "1.0.0"
