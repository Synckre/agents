"""El idioma de la respuesta lo marca el usuario, no el prompt en español."""

from app.application.agent.language import detect_text_language, detect_user_language, language_lock
from app.application.agent.prompts import build_system_prompt
from app.application.agent.roles import RoleSystem


def test_detects_english():
    lang, conf = detect_text_language("Hi, I need to schedule a meeting with your team tomorrow")
    assert lang == "en"
    assert conf >= 50


def test_detects_spanish():
    lang, conf = detect_text_language("Hola, quiero agendar una cita para mañana por la tarde")
    assert lang == "es"
    assert conf >= 50


def test_ignores_email_when_scoring():
    lang, conf = detect_text_language("Please write to ebrahim.buceta@gmail.com and book a meeting")
    assert lang == "en"


def test_short_yes_keeps_stored_english():
    lang, confident = detect_user_language("yes", history=[], stored="en")
    assert lang == "en"
    lang2, _ = detect_user_language("ok", history=["I need help with a meeting"], stored=None)
    assert lang2 == "en"


def test_short_si_is_spanish():
    lang, _ = detect_user_language("sí, confirmo", stored="es")
    assert lang == "es"


def test_history_beats_weak_ok():
    lang, _ = detect_user_language(
        "ok",
        history=["Hello, I want to book an appointment please"],
        stored=None,
    )
    assert lang == "en"


def test_prompt_lock_english_first():
    role = RoleSystem.get_role("customer_support")
    prompt = build_system_prompt(
        role=role,
        tools=[],
        context={"messages": [], "rag_context": [], "user_language": "en"},
        json_loop=False,
    )
    assert prompt.startswith("BILINGUAL MASTERY")
    assert "natively fluent in Spanish AND English" in prompt
    assert "OUTPUT LANGUAGE THIS TURN: ENGLISH" in prompt
    assert prompt.index("BILINGUAL MASTERY") < prompt.index(role.system_policy[:20])
    assert "Reply ONLY in English" in prompt


def test_prompt_lock_spanish_default():
    role = RoleSystem.get_role("customer_support")
    prompt = build_system_prompt(role=role, tools=[], context={"messages": [], "rag_context": []})
    assert "BILINGUAL MASTERY" in prompt
    assert "IDIOMA DE SALIDA DE ESTE TURNO: ESPAÑOL" in prompt
    assert language_lock("es").split("\n")[0] in prompt


def test_mixed_message_picks_dominant_but_understands_both():
    lang, conf = detect_text_language(
        "Hola, I would like to schedule a meeting with your team please"
    )
    assert lang == "en"
    assert conf >= 40
