"""
Modelos Pydantic del Modelo de Dominio de Synckre Agent V2.
Define las entidades del sistema: User, Role, Policy, Capability, Conversation, Message, Customer,
Prospect, Contract, Task, ToolExecution, Approval, KnowledgeSource, Document, AuditLog.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, EmailStr


class ChannelEnum(str, Enum):
    WEB = "web"
    API = "api"
    EMAIL = "email"
    INTERNAL = "internal"


class AutonomyLevel(int, Enum):
    LEVEL_1_READ = 1            # Consultar, buscar, RAG, responder
    LEVEL_2_SAFE_ACTION = 2     # Emails informativos autorizados, agendar citas, crear tickets, leads
    LEVEL_3_SENSITIVE_ACTION = 3  # Aprobar contratos, ops financieras, modificar datos sensibles (Requiere Aprobación Humana)


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    WAITING_USER = "waiting_user"
    WAITING_HUMAN = "waiting_human"
    WAITING_EXTERNAL = "waiting_external"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CHANGES_REQUESTED = "changes_requested"


class ContractStatus(str, Enum):
    DRAFT = "draft"
    WAITING_APPROVAL = "waiting_approval"
    APPROVED = "approved"
    FINAL = "final"
    SENT = "sent"
    SIGNED = "signed"
    CANCELLED = "cancelled"


# ==========================================
# ROLES, POLICIES & CAPABILITIES
# ==========================================

class CapabilityModel(BaseModel):
    name: str
    description: str


class PolicyModel(BaseModel):
    name: str
    description: str
    allowed_capabilities: List[str] = Field(default_factory=list)
    restrictions: List[str] = Field(default_factory=list)


class RoleModel(BaseModel):
    name: str
    description: str
    system_policy: str
    allowed_tools: List[str] = Field(default_factory=list)
    allowed_knowledge_sources: List[str] = Field(default_factory=list)
    autonomy_level: AutonomyLevel = AutonomyLevel.LEVEL_1_READ
    approval_policy: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ==========================================
# CONVERSATIONS & MESSAGES
# ==========================================

class MessageModel(BaseModel):
    id: Optional[str] = None
    conversation_id: str
    sender: str  # 'user', 'agent', 'system', 'human'
    content: str
    message_type: str = "text"  # 'text', 'tool_call', 'tool_result', 'system_event'
    tool_calls: Optional[List[Dict[str, Any]]] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ConversationModel(BaseModel):
    id: str
    channel: ChannelEnum = ChannelEnum.API
    user_id: Optional[str] = None
    customer_id: Optional[str] = None
    role: str = "customer_support"
    status: str = "active"  # 'active', 'paused_human', 'closed'
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ==========================================
# CUSTOMERS, PROSPECTS & CONTRACTS
# ==========================================

class CustomerModel(BaseModel):
    id: Optional[str] = None
    name: str
    company: Optional[str] = None
    email: str
    phone: Optional[str] = None
    preferences: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class LeadModel(BaseModel):
    id: Optional[int] = None
    workflow_id: Optional[str] = None
    nombre: str
    email: str
    empresa: Optional[str] = ""
    telefono: Optional[str] = ""
    mensaje: Optional[str] = ""
    origen: str = "web"
    erp_id: Optional[str] = ""
    erp_destino: str = "local"
    status: str = "new"  # 'new', 'contacted', 'qualified', 'converted'
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ContractModel(BaseModel):
    id: Optional[str] = None
    customer_id: str
    title: str
    status: ContractStatus = ContractStatus.DRAFT
    template_name: str
    content: str
    created_by: str = "agent"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ContractVersionModel(BaseModel):
    id: Optional[str] = None
    contract_id: str
    version_number: int
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ==========================================
# TASKS, TOOL EXECUTIONS & APPROVALS
# ==========================================

class TaskModel(BaseModel):
    id: str
    conversation_id: str
    type: str  # 'support_incident', 'appointment', 'contract', 'lead', 'email', 'human_escalation'
    goal: str
    status: TaskStatus = TaskStatus.PENDING
    priority: str = "normal"  # 'low', 'normal', 'high', 'urgent'
    context: Dict[str, Any] = Field(default_factory=dict)
    result: Optional[Dict[str, Any]] = None
    approval_required: bool = False
    approval_status: Optional[ApprovalStatus] = None
    temporal_workflow_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ToolExecutionModel(BaseModel):
    id: Optional[str] = None
    task_id: Optional[str] = None
    conversation_id: str
    tool_name: str
    input_data: Dict[str, Any]
    output_data: Optional[Dict[str, Any]] = None
    status: str = "success"  # 'success', 'temporary_failure', 'permanent_failure', 'requires_human'
    execution_time_ms: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ApprovalModel(BaseModel):
    id: str
    task_id: str
    target_type: str  # 'contract', 'email', 'sensitive_operation'
    target_id: Optional[str] = None
    action: str  # 'approve_contract', 'send_sensitive_email', etc.
    status: ApprovalStatus = ApprovalStatus.PENDING
    requested_by: str = "agent"
    approved_by: Optional[str] = None
    previous_value: Optional[str] = None
    new_value: Optional[str] = None
    reason: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ==========================================
# KNOWLEDGE & RAG
# ==========================================

class KnowledgeSourceModel(BaseModel):
    id: Optional[str] = None
    title: str
    domain: str  # 'public', 'internal', 'customer', 'project', 'department'
    source_type: str  # 'pdf', 'text', 'url', 'faq'
    file_path: Optional[str] = None
    status: str = "indexed"
    chunk_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class DocumentChunkModel(BaseModel):
    id: Optional[int] = None
    source_id: Optional[str] = None
    filename: str
    chunk_index: int
    content: str
    embedding: Optional[List[float]] = None
    domain: str = "public"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ==========================================
# AUDIT LOGS
# ==========================================

class AuditLogModel(BaseModel):
    id: Optional[int] = None
    user_id: Optional[str] = None
    agent_role: str
    tool_name: Optional[str] = None
    task_id: Optional[str] = None
    workflow_id: Optional[str] = None
    action: str
    input_summary: Optional[str] = None
    output_summary: Optional[str] = None
    authorization_result: str = "authorized"  # 'authorized', 'denied', 'approval_requested'
    approval_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
