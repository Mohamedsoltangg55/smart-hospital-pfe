# 1. Use the official Python base image
FROM python:3.10-slim

# 2. Set the working directory inside the container
WORKDIR /app

# 3. 🛠️ THE FIX: Install the C-compilers required for Web3 cryptography
RUN apt-get update && apt-get install -y \
    gcc \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# 4. Copy your requirements file first
COPY requirements.txt .

# 5. Install all your Python libraries (Web3 will successfully build now!)
RUN pip install --no-cache-dir -r requirements.txt

# 6. Copy the rest of your hospital backend code
COPY . .

# 7. Expose the port for your React frontend to connect to
EXPOSE 8000

# 8. Start the FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]