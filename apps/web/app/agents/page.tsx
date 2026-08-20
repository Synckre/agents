'use client';

import React from 'react';
import { Bot, ShieldCheck, Sparkles } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PageHeader } from '@/components/PageHeader';
import { PageTransition } from '@/components/PageTransition';

const ROLES_LIST = [
  {
    name: 'contact_form_agent',
    description: 'Formulario de contacto inteligente: pre-solicita los datos del lead, registra el lead en ERPNext, agenda citas y envía la confirmación por correo.',
    autonomy: 'Level 2 — SAFE ACTION',
    tools: ['read_public_knowledge', 'read_customer', 'request_information', 'check_availability', 'create_event', 'create_lead', 'escalate_ticket'],
  },
  {
    name: 'customer_support',
    description: 'Atención al cliente y soporte postventa para incidencias de ingeniería.',
    autonomy: 'Level 2 — SAFE ACTION',
    tools: ['read_public_knowledge', 'check_availability', 'create_event', 'create_ticket', 'update_ticket', 'send_email', 'request_information', 'escalate_ticket'],
  },
  {
    name: 'sales_assistant',
    description: 'Atención a leads y evaluación de nuevos proyectos o encargos.',
    autonomy: 'Level 2 — SAFE ACTION',
    tools: ['read_public_knowledge', 'check_availability', 'create_event', 'create_lead', 'send_email', 'generate_document', 'escalate_ticket'],
  },
  {
    name: 'operations_assistant',
    description: 'Asistente de operaciones internas, proyectos e inventario para empleados.',
    autonomy: 'Level 2 — SAFE ACTION',
    tools: ['read_internal_knowledge', 'read_customer', 'read_invoice', 'search_documents', 'send_email', 'escalate_ticket'],
  },
  {
    name: 'administrative_assistant',
    description: 'Asistente de gestión documental, contratos y administración.',
    autonomy: 'Level 2 — SAFE ACTION',
    tools: ['read_internal_knowledge', 'search_documents', 'generate_document', 'generate_contract', 'send_email', 'escalate_ticket'],
  },
  {
    name: 'management_assistant',
    description: 'Asistente directivo con acceso amplio a información interna.',
    autonomy: 'Level 3 — SENSITIVE ACTION',
    tools: ['read_internal_knowledge', 'read_customer', 'read_invoice', 'search_documents', 'generate_contract', 'approve_contract', 'escalate_ticket'],
  },
];

export default function AgentsPage() {
  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <PageHeader
          icon={Bot}
          title="Roles, políticas y herramientas"
          description="Permisos, capacidades y nivel de autonomía asignados a cada rol del Agent Runtime."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {ROLES_LIST.map((role) => (
            <Card key={role.name}>
              <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="chip-icon">
                      <Bot />
                    </span>
                    <CardTitle>{role.name}</CardTitle>
                  </div>
                  <Badge variant={role.autonomy.includes('3') ? 'warning' : 'success'} className="shrink-0">
                    <ShieldCheck className="mr-1 size-3.5" />
                    {role.autonomy}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-5 flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{role.description}</p>

                <Separator />

                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Herramientas autorizadas
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {role.tools.map((tool) => (
                      <code
                        key={tool}
                        className="font-mono text-xs text-foreground bg-muted border border-border rounded-md px-2 py-1"
                      >
                        {tool}
                      </code>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="size-3.5" />
                  Autonomía {role.autonomy.split(' — ')[0]}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageTransition>
  );
}
