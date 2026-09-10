import { ICalendar } from '@core/ports/calendar.port';
import { ICrm } from '@core/ports/crm.port';
import { IEmailSender } from '@core/ports/email-sender.port';
import { IKnowledgeBase } from '@core/ports/knowledge-base.port';
import { ITool } from '@core/ports/tool.port';
import { AppendLeadNoteTool } from './append-lead-note.tool';
import { CancelAppointmentTool } from './cancel-appointment.tool';
import { CheckAvailabilityTool } from './check-availability.tool';
import { RequestHumanTool } from './request-human.tool';
import { RescheduleAppointmentTool } from './reschedule-appointment.tool';
import { SaveLeadTool } from './save-lead.tool';
import { ScheduleAppointmentTool } from './schedule-appointment.tool';
import { SearchKnowledgeBaseTool } from './search-knowledge-base.tool';
import { SearchLeadTool } from './search-lead.tool';
import { SendEmailTool } from './send-email.tool';
import { SendInternalAlertTool } from './send-internal-alert.tool';
import { IToolContext } from './tool-context';

import { IFollowupScheduler } from '@core/ports/followup-scheduler.port';
import { ISchedulingPolicyProvider } from '@core/ports/scheduling-policy.port';
import { IAppointmentRepository } from '@core/ports/appointment-repository.port';
import { ScheduleFollowupTool } from './schedule-followup.tool';

import { IToolPolicy } from '@core/ports/tool-policy.port';
import { IToolSecurityLogger } from '@core/ports/tool-security-logger.port';
import { ToolGuard } from './tool-guard.decorator';

export interface FrontAgentToolDeps {
  readonly crm: ICrm;
  readonly calendar: ICalendar;
  readonly email: IEmailSender;
  readonly knowledge: IKnowledgeBase;
  readonly internalAlertEmail: string;
  readonly followupScheduler?: IFollowupScheduler;
  readonly schedulingPolicy?: ISchedulingPolicyProvider;
  readonly appointmentRepo?: IAppointmentRepository;
  readonly policies?: readonly IToolPolicy[];
  readonly logger?: IToolSecurityLogger;
}

export function createFrontAgentTools(deps: FrontAgentToolDeps, ctx: IToolContext): ITool[] {
  const tools: ITool[] = [
    new SearchLeadTool(deps.crm, ctx),
    new SaveLeadTool(deps.crm, ctx),
    new AppendLeadNoteTool(deps.crm, ctx),
    new CheckAvailabilityTool(deps.calendar, deps.schedulingPolicy, deps.appointmentRepo),
    new ScheduleAppointmentTool(
      deps.calendar,
      ctx,
      deps.followupScheduler,
      deps.email,
      deps.internalAlertEmail,
      deps.appointmentRepo,
    ),
    new RescheduleAppointmentTool(
      deps.calendar,
      ctx,
      deps.email,
      deps.internalAlertEmail,
      deps.appointmentRepo,
      deps.followupScheduler,
    ),
    new CancelAppointmentTool(
      deps.calendar,
      ctx,
      deps.email,
      deps.internalAlertEmail,
      deps.appointmentRepo,
      deps.followupScheduler,
    ),
    new SendEmailTool(deps.email, ctx, deps.internalAlertEmail),
    new RequestHumanTool(deps.email, ctx, deps.internalAlertEmail),
    new SendInternalAlertTool(deps.email, ctx, deps.internalAlertEmail),
    new SearchKnowledgeBaseTool(deps.knowledge),
  ];

  if (deps.followupScheduler) {
    tools.push(new ScheduleFollowupTool(deps.followupScheduler, ctx));
  }

  if (deps.policies && deps.policies.length > 0) {
    return tools.map((tool) => new ToolGuard(tool, deps.policies!, ctx.conversationId, deps.logger));
  }

  return tools;
}
