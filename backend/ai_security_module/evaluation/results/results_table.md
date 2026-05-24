# Model comparison

Cross-validation: mean ± std over 5 stratified folds. Test: single held-out 20% slice never seen during CV.

| Model | CV accuracy | CV precision | CV recall | CV f1 | CV roc_auc | Test accuracy | Test precision | Test recall | Test f1 | Test roc_auc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Autoencoder | 0.9163 ± 0.0195 | 0.7965 ± 0.0340 | 0.7800 ± 0.0897 | 0.7867 ± 0.0574 | 0.9387 ± 0.0066 | 0.9297 | 0.7988 | 0.8667 | 0.8313 | 0.9459 |
| IsolationForest | 0.8419 ± 0.0086 | 0.6038 ± 0.0261 | 0.6133 ± 0.0136 | 0.6083 ± 0.0153 | 0.8703 ± 0.0156 | 0.8257 | 0.5630 | 0.5733 | 0.5681 | 0.8544 |
| OneClassSVM | 0.8178 ± 0.0082 | 0.5252 ± 0.0121 | 0.9383 ± 0.0073 | 0.6734 ± 0.0101 | 0.9701 ± 0.0019 | 0.8183 | 0.5253 | 0.9533 | 0.6773 | 0.9728 |
| RandomForest | 0.9923 ± 0.0016 | 0.9813 ± 0.0058 | 0.9804 ± 0.0092 | 0.9808 ± 0.0041 | 0.9985 ± 0.0008 | 0.9940 | 0.9866 | 0.9833 | 0.9850 | 0.9976 |
