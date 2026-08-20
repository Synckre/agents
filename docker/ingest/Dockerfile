FROM python:3.12-slim

WORKDIR /app
ENV SKIP_LLM_KEY_CHECK=true
ENV PYTHONPATH=/app/AI

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY AI/requirements.txt /app/AI/requirements.txt
RUN pip install --no-cache-dir -r /app/AI/requirements.txt

COPY AI/app /app/AI/app
COPY AI/scripts /app/AI/scripts

WORKDIR /app/AI
ENTRYPOINT ["python3", "scripts/ingest.py"]
