"""Identidad literal: el modelo no puede cambiar letras de lo que escribió el usuario."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.application.agent.prepare_args import prepare_tool_args
from app.application.agent.verbatim import (
    extraer_datos,
    extraer_emails,
    pin_tool_args,
    snapshot_from_texts,
)
from app.application.services.memory_service import extraer_datos as extraer_datos_mem


def test_email_exacto_con_puntos_y_plus():
    texto = "Mi correo es ebrahim.buceta+tag@gmail.com, gracias."
    assert extraer_emails(texto) == ["ebrahim.buceta+tag@gmail.com"]
    assert extraer_datos(texto)["email"] == "ebrahim.buceta+tag@gmail.com"
    assert extraer_datos_mem(texto)["email"] == "ebrahim.buceta+tag@gmail.com"


def test_email_no_pierde_letras():
    texto = "soy Juan Pérez, escribe a juan.perez@synckre.com por favor"
    assert extraer_datos(texto)["email"] == "juan.perez@synckre.com"


def test_ultimo_email_en_correccion():
    texto = "el correo no es juan.peres@gmail.com, es juan.perez@gmail.com"
    assert extraer_datos(texto)["email"] == "juan.perez@gmail.com"
    assert extraer_emails(texto) == ["juan.peres@gmail.com", "juan.perez@gmail.com"]


def test_pin_descarta_typo_del_llm():
    snap = snapshot_from_texts(
        ["Hola, soy Ebrahim Buceta, mi correo es ebrahim.buceta@gmail.com"]
    )
    pinned = pin_tool_args(
        {
            "nombre": "Ebraim Buceta",
            "email": "ebrahim.buceta@gmal.com",
            "mensaje": "hola",
        },
        snap,
        user_input="sí, confirmo",
    )
    assert pinned["email"] == "ebrahim.buceta@gmail.com"
    assert pinned["nombre"] == "Ebrahim Buceta"


def test_pin_correccion_en_mensaje_actual():
    snap = snapshot_from_texts(
        [
            "mi correo es viejo@empresa.com",
            "el correo no es viejo@empresa.com, es nuevo.contacto@empresa.com",
        ]
    )
    pinned = pin_tool_args(
        {"email_actual": "viejo@emprsa.com", "email_nuevo": "nuevo.contacto@emprsa.com"},
        snap,
        user_input="el correo no es viejo@empresa.com, es nuevo.contacto@empresa.com",
    )
    assert pinned["email_actual"] == "viejo@empresa.com"
    assert pinned["email_nuevo"] == "nuevo.contacto@empresa.com"


def test_prepare_args_con_historial(monkeypatch):
    msgs = [
        SimpleNamespace(
            sender="user",
            content="Soy Ana López, mi email es ana.lopez@cliente.com y el teléfono +34 600 111 222",
        )
    ]
    conv = SimpleNamespace(metadata={"customer_email": "ana.lopez@cliente.com"})
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager.get_conversation",
        AsyncMock(return_value=conv),
    )
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager.get_messages",
        AsyncMock(return_value=msgs),
    )
    monkeypatch.setattr(
        "app.infrastructure.db.manager.db_manager.get_lead_erp_id_for_conversation",
        AsyncMock(return_value=""),
    )

    args = asyncio.run(
        prepare_tool_args(
            "create_lead",
            {"nombre": "Ana Lopez", "email": "ana.lopes@cliente.com", "mensaje": "ok"},
            conversation_id="CONV-1",
            user_input="sí, está bien",
        )
    )
    assert args["email"] == "ana.lopez@cliente.com"
    assert args["nombre"] == "Ana López"
    assert args["telefono"] == "+34 600 111 222"
