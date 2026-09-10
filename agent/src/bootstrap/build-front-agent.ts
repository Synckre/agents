import { createFrontAgentTools, FrontAgentToolDeps } from '@adapters/tools/create-front-agent-tools';
import { ConversationSession, IToolContext } from '@adapters/tools/tool-context';
import { FrontAgent } from '@agents/front-agent';
import { env } from '@config/env';
import { SECURITY_POLICY } from '@config/security-policy';
import { ICalendar } from '@core/ports/calendar.port';
import { ICrm } from '@core/ports/crm.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { IKnowledgeBase } from '@core/ports/knowledge-base.port';
import { IMemoryStore } from '@core/ports/memory-store.port';
import { IToolCallingLlm } from '@core/ports/tool-calling-llm.port';
import { IToolPolicy } from '@core/ports/tool-policy.port';
import { IToolSecurityLogger } from '@core/ports/tool-security-logger.port';

import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';
import { IAppointmentRepository } from '@core/ports/appointment-repository.port';

export interface BuildFrontAgentDeps {
  readonly llm: IToolCallingLlm;
  readonly memory: IMemoryStore;
  readonly crm: ICrm;
  readonly calendar: ICalendar;
  readonly email: IEmailSender;
  readonly knowledge: IKnowledgeBase;
  readonly internalAlertEmail: string;
  readonly followupScheduler?: IFollowupScheduler;
  readonly scheduling?: ISchedulingPolicyProvider & IAppointmentRepository;
  readonly policies: readonly IToolPolicy[];
  readonly securityLogger: IToolSecurityLogger;
}

export function buildFrontAgent(deps: BuildFrontAgentDeps): { agent: FrontAgent } {
  const toolDeps: FrontAgentToolDeps = {
    crm: deps.crm,
    calendar: deps.calendar,
    email: deps.email,
    knowledge: deps.knowledge,
    internalAlertEmail: deps.internalAlertEmail,
    followupScheduler: deps.followupScheduler,
    schedulingPolicy: deps.scheduling,
    appointmentRepo: deps.scheduling,
    policies: deps.policies,
    logger: deps.securityLogger,
  };

  const agent = new FrontAgent(
    deps.llm,
    ({ conversationId, getState }) => {
      const ctx: IToolContext = {
        conversationId,
        maxAppointments: SECURITY_POLICY.maxAppointmentsPerConversation,
        memory: deps.memory,
        getState,
      };
      // Sesión con caché en memoria por turno para reducir consultas a Postgres
      ctx.session = new ConversationSession(ctx);
      return createFrontAgentTools(toolDeps, ctx);
    },
    {
      maxIterations: env.MAX_TOOL_ITERATIONS,
      timeZone: env.GOOGLE_CALENDAR_TIMEZONE,
    },
  );

  return { agent };
}
