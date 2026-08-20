"""
Capa de dominio: entidades y reglas de negocio puras (sin dependencias de
infraestructura ni de interfaces). Los consumidores importan desde `app.domain`.
"""

from app.domain.entities import (
    ApprovalModel,
    ApprovalStatus,
    AuditLogModel,
    AutonomyLevel,
    CapabilityModel,
    ChannelEnum,
    ContractModel,
    ContractStatus,
    ContractVersionModel,
    ConversationModel,
    CustomerModel,
    DocumentChunkModel,
    KnowledgeSourceModel,
    MessageModel,
    PolicyModel,
    LeadModel,
    RoleModel,
    TaskModel,
    TaskStatus,
    ToolExecutionModel,
)

__all__ = [
    "ApprovalModel",
    "ApprovalStatus",
    "AuditLogModel",
    "AutonomyLevel",
    "CapabilityModel",
    "ChannelEnum",
    "ContractModel",
    "ContractStatus",
    "ContractVersionModel",
    "ConversationModel",
    "CustomerModel",
    "DocumentChunkModel",
    "KnowledgeSourceModel",
    "MessageModel",
    "PolicyModel",
    "LeadModel",
    "RoleModel",
    "TaskModel",
    "TaskStatus",
    "ToolExecutionModel",
]
