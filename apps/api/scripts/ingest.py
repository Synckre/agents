import os
import sys
import glob
import hashlib
import logging
import fitz  # PyMuPDF
import click
import psycopg
import ollama

# Agregar el directorio raíz al path para poder importar módulos de app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.infrastructure.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("ingest")

def compute_file_hash(filepath: str) -> str:
    """Calcula el hash SHA-256 del contenido de un archivo PDF."""
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()

def extract_chunks_from_pdf(filepath: str, chunk_size: int = 800, overlap: int = 120):
    """
    Extrae texto de un archivo PDF usando PyMuPDF y lo divide en chunks con solapamiento.
    """
    doc = fitz.open(filepath)
    full_text = ""
    for page in doc:
        full_text += page.get_text() + "\n"
    doc.close()
    
    full_text = full_text.strip()
    if not full_text:
        return []
        
    chunks = []
    start = 0
    text_length = len(full_text)
    
    while start < text_length:
        end = start + chunk_size
        chunk_str = full_text[start:end].strip()
        if chunk_str:
            chunks.append(chunk_str)
        start += chunk_size - overlap
        
    return chunks

def generate_embedding_with_ollama(client: ollama.Client, model: str, text: str):
    """Genera el vector de embedding usando la instancia local de Ollama."""
    try:
        response = client.embeddings(model=model, prompt=text)
        return response["embedding"]
    except Exception as e:
        logger.error(f"Error generando embedding con Ollama (modelo={model}): {e}")
        raise e

@click.command()
@click.option(
    "--domain", 
    type=click.Choice(["public", "internal"], case_sensitive=False), 
    required=True, 
    help="Ámbito de seguridad de los documentos (public | internal)."
)
@click.option(
    "--carpeta", 
    type=str, 
    default=None, 
    help="Ruta al directorio con archivos PDF. Por defecto ./documentos/<domain>."
)
def main(domain: str, carpeta: str):
    """
    Script de Ingesta RAG con Aislamiento por Dominio.
    Procesa PDFs, calcula hash para evitar reindexación, genera embeddings locales con Ollama
    e inserta los vectores en PostgreSQL con el tag de dominio correspondiente.
    """
    domain = domain.lower()
    target_dir = carpeta or os.path.join(".", "documentos", domain)
    
    logger.info(f"=== Iniciando Ingesta RAG Aislada ===")
    logger.info(f"Dominio: {domain}")
    logger.info(f"Directorio de PDFs: {target_dir}")
    logger.info(f"Modelo Ollama: {settings.EMBEDDING_MODEL}")
    logger.info(f"Ollama URL: {settings.OLLAMA_BASE_URL}")

    if not os.path.exists(target_dir):
        logger.error(f"El directorio '{target_dir}' no existe.")
        sys.exit(1)

    pdf_files = glob.glob(os.path.join(target_dir, "*.pdf"))
    if not pdf_files:
        logger.warning(f"No se encontraron archivos PDF en '{target_dir}'.")
        return

    # Inicializar cliente de Ollama
    ollama_client = ollama.Client(host=settings.OLLAMA_BASE_URL)
    
    # Conexión sincrónica a PostgreSQL para el script CLI
    try:
        conn = psycopg.connect(conninfo=settings.POSTGRES_URI, autocommit=True)
    except Exception as e:
        logger.error(f"No se pudo conectar a PostgreSQL: {e}")
        sys.exit(1)

    processed_count = 0
    skipped_count = 0

    for pdf_path in pdf_files:
        filename = os.path.basename(pdf_path)
        content_hash = compute_file_hash(pdf_path)

        # Verificar si el documento ya fue indexado sin cambios (por dominio y hash)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, content_hash FROM synckre.knowledge_sources WHERE domain = %s AND title = %s;",
                (domain, filename)
            )
            existing = cur.fetchone()

            if existing and existing[1] == content_hash:
                logger.info(f"⏩ Omitiendo '{filename}' (Sin cambios, hash coincidente).")
                skipped_count += 1
                continue

            # Si el archivo cambió, eliminar la versión previa (fuente + chunks)
            if existing:
                logger.info(f"🔄 Reindexando '{filename}' (Se detectaron cambios en el archivo).")
                cur.execute(
                    "DELETE FROM synckre.document_chunks WHERE source_id = %s;",
                    (existing[0],)
                )
                cur.execute(
                    "DELETE FROM synckre.knowledge_sources WHERE id = %s;",
                    (existing[0],)
                )

        logger.info(f"📄 Procesando '{filename}'...")
        chunks = extract_chunks_from_pdf(pdf_path)
        if not chunks:
            logger.warning(f"No se extrajo texto de '{filename}'.")
            continue

        # Registrar la fuente del documento (mismo esquema que usa el runtime)
        source_id = f"SRC-{os.urandom(4).hex()}"
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO synckre.knowledge_sources
                    (id, title, domain, source_type, file_path, content_hash, status, chunk_count)
                VALUES (%s, %s, %s, 'pdf', %s, %s, 'indexed', %s);
                """,
                (source_id, filename, domain, pdf_path, content_hash, len(chunks))
            )

            for idx, chunk_text in enumerate(chunks):
                embedding = generate_embedding_with_ollama(
                    ollama_client, settings.EMBEDDING_MODEL, chunk_text
                )
                embedding_str = f"[{','.join(map(str, embedding))}]"

                cur.execute(
                    """
                    INSERT INTO synckre.document_chunks
                        (source_id, filename, domain, chunk_index, content, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s::vector);
                    """,
                    (source_id, filename, domain, idx + 1, chunk_text, embedding_str)
                )

        logger.info(f"✅ Ingestados {len(chunks)} chunks para '{filename}'.")
        processed_count += 1

    conn.close()
    logger.info(f"=== Ingesta Finalizada ===")
    logger.info(f"Archivos procesados: {processed_count} | Omitidos: {skipped_count}")

if __name__ == "__main__":
    main()
