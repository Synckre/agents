"""Límites del canal público. Constantes de producto: no hace falta un .env por umbral."""

CHAT_PER_MINUTE = 6
CHAT_PER_HOUR = 20
CHAT_PER_DAY = 60
CHAT_MAX_TURNS = 16
CONTACT_PER_MINUTE = 5
CONTACT_PER_HOUR = 15

# Tras registrar el lead, el cualificador escribe (no al instante).
FOLLOW_UP_DELAY_MINUTES = 20
FOLLOW_UP_ROLE = "sales_assistant"

PUBLIC_CONTINUE_PATH = "/continue"
