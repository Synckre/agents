"""Seguimiento comercial diferido y enlace de continuación."""

from app.application.follow_up import continue_url
from app.application.public_limits import FOLLOW_UP_DELAY_MINUTES, FOLLOW_UP_ROLE
from app.infrastructure.integrations.email_templates import (
    email_cita_interna,
    email_continuar_conversacion,
)


def test_follow_up_is_sales_assistant_not_instant():
    assert FOLLOW_UP_ROLE == "sales_assistant"
    assert FOLLOW_UP_DELAY_MINUTES >= 10


def test_continue_url_uses_site_and_token():
    url = continue_url("abcTOKEN")
    assert "token=abcTOKEN" in url
    assert url.startswith("http")


def test_continue_email_bilingual():
    _, h_es, _ = email_continuar_conversacion("Ana", "https://www.synckre.com/continue?token=x", lang="es")
    assert "Continuar la conversación" in h_es
    _, h_en, _ = email_continuar_conversacion("Ana", "https://www.synckre.com/continue?token=x", lang="en")
    assert "Continue the conversation" in h_en


def test_internal_meeting_email_is_spanish():
    _, html, _ = email_cita_interna("Ana", "ana@x.com", "2026-08-20T10:00:00+00:00", "Kickoff", meet_url="https://meet.google.com/abc")
    assert "Cita comercial" in html
    assert "ana@x.com" in html
    assert "meet.google.com/abc" in html
