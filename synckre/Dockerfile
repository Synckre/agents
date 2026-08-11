# syntax=docker/dockerfile:1

########## STAGE 1: build (instala dependencias) ##########
FROM python:3.12-slim AS build

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# pyproject.toml referencia README.md, excluido del contexto por .dockerignore:
# se crea un stub para que el build de metadatos de setuptools no falle.
COPY pyproject.toml ./
COPY src ./src
RUN echo "Synckre agent" > README.md \
    && python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip \
    && /opt/venv/bin/pip install .

########## STAGE 2: final (mínima, sin toolchain de compilación) ##########
FROM python:3.12-slim AS final

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# Usuario no-root: nunca correr como root dentro del contenedor.
RUN groupadd --system appuser \
    && useradd --system --gid appuser --create-home --shell /usr/sbin/nologin appuser

# Solo el venv con las dependencias + el paquete instalado (agente + api).
COPY --from=build /opt/venv /opt/venv

WORKDIR /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

# ProxyHeadersMiddleware de uvicorn: confía en X-Forwarded-* SOLO desde las IPs
# de FORWARDED_ALLOW_IPS (proxy interno de Coolify), nunca ciegamente.
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${FORWARDED_ALLOW_IPS:-127.0.0.1}\""]
