---
name: internal-alerts
description: Guidelines and procedure for sending internal notifications, alerts, and operational updates to the Synckre team using the official template (256c273c-1059-41d4-894e-3b3aaa8aca4a).
---

# Internal Alerts & Notifications (Synckre Team)

Use this skill whenever internal notices, alerts, or important operational information must be communicated to the internal Synckre team.

## Official Template ID
- **Template ID**: `256c273c-1059-41d4-894e-3b3aaa8aca4a`
- **Provider**: Resend (`RESEND_TEMPLATES.INTERNAL_ALERT`)
- **Recipient**: Configured via environment variable `INTERNAL_ALERT_EMAIL`.

## Tool Usage: `send_internal_alert`

The agent provides the `send_internal_alert` tool to dispatch internal notices directly during a conversation without interrupting or pausing the customer chat:

```typescript
send_internal_alert({
  subject: "Lead de alto valor solicita cotización personalizada",
  message: "El cliente requiere integración ERP con más de 50 usuarios. Presupuesto estimado: $10,000 USD.",
  priority: "high" // 'normal' | 'high' | 'urgent'
})
```

### When to Send Internal Alerts
1. **High Priority Leads**: Potential high-ticket clients, enterprise inquiries, or immediate closing opportunities.
2. **Specialized Inquiries**: Queries that require technical validation or partner approvals.
3. **Operational Notices**: Custom follow-up requests or notes that the sales/support team should review.
4. **Human Escalations**: Triggered automatically via `request_human` tool (which pauses the chat).
5. **Appointment Lifecycle**: Triggered automatically when appointments are scheduled, rescheduled, or cancelled.

## Template Payload Variables

The template receives the following official variables:
- `ACTION`: Headline or action type (e.g., `[URGENT] Lead Alert`, `New Appointment`, `Human Escalation Required`).
- `CLIENT_NAME`: Name or email of the lead/visitor.
- `CLIENT_EMAIL`: Contact email if provided.
- `NOTES`: Core message or detailed notes.
- `SUMMARY`: Contextual summary of the conversation.
- `CONVERSATION_LINK`: Link to review the conversation (`https://synckre.com/conversations/{id}`).
- `TIME_ZONE`: Standard company timezone (`EDT / New York`).
- `HOST`: Host or team name (`Synckre Team`).
