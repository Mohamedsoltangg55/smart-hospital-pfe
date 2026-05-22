FROM python:3.9-slim
WORKDIR /app

# System libs: libgomp1 is required by PyTorch (OpenMP runtime),
# curl is used by the docker-compose healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install CPU-only PyTorch + AI deps FIRST, from the PyTorch CPU wheel index.
# Without this, plain `pip install torch` pulls the ~2GB CUDA build from PyPI.
RUN pip install --no-cache-dir \
    torch>=2.0.0 numpy>=1.24.0 pandas>=2.0.0 scikit-learn>=1.3.0 joblib>=1.3.0 \
    --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple

# Remaining deps (torch/numpy/pandas/scikit-learn/joblib already satisfied above).
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
