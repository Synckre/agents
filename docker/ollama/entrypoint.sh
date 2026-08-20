#!/bin/sh
set -e

# Iniciar servidor Ollama en segundo plano
ollama serve &
SERVER_PID=$!

echo "Esperando a que el servidor de Ollama esté disponible..."
until ollama list > /dev/null 2>&1; do
    sleep 2
done

MODEL_NAME=${EMBEDDING_MODEL:-qwen3-embedding:0.6b}
echo "Verificando el modelo de embeddings: ${MODEL_NAME}..."

if ! ollama list | grep -q "${MODEL_NAME}"; then
    echo "Descargando modelo de embeddings '${MODEL_NAME}' por primera vez..."
    ollama pull "${MODEL_NAME}"
    echo "Modelo '${MODEL_NAME}' descargado correctamente."
else
    echo "El modelo '${MODEL_NAME}' ya existe en el volumen persistente de Ollama."
fi

# Esperar al proceso principal de Ollama
wait $SERVER_PID
