import { ITool } from '@core/ports/tool.port';
import { IToolPolicy } from '@core/ports/tool-policy.port';
import { IToolSecurityLogger } from '@core/ports/tool-security-logger.port';

/**
 * Excepción lanzada cuando una herramienta es bloqueada por una política de seguridad.
 */
export class ToolPolicyViolation extends Error {
  readonly toolName: string;
  readonly reason: string;

  constructor(toolName: string, reason: string) {
    super(`Tool policy violation for "${toolName}": ${reason}`);
    this.name = 'ToolPolicyViolation';
    this.toolName = toolName;
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Decorador que intercepta la ejecución de cualquier ITool aplicando una lista de políticas de seguridad.
 */
export class ToolGuard<TInput = unknown, TOutput = unknown> implements ITool<TInput, TOutput> {
  constructor(
    private readonly inner: ITool<TInput, TOutput>,
    private readonly policies: readonly IToolPolicy[],
    private readonly conversationId: string,
    private readonly logger?: IToolSecurityLogger,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  get description(): string {
    return this.inner.description;
  }

  get schema(): unknown {
    return this.inner.schema;
  }

  async execute(args: TInput): Promise<TOutput> {
    for (const policy of this.policies) {
      const decision = await policy.check({
        toolName: this.name,
        conversationId: this.conversationId,
        args,
      });

      if (!decision.allowed) {
        const reason = decision.reason ?? `Policy ${policy.name} rejected tool execution`;
        await this.logAttempt(false, reason, args);
        throw new ToolPolicyViolation(this.name, reason);
      }
    }

    await this.logAttempt(true, undefined, args);
    return this.inner.execute(args);
  }

  private async logAttempt(allowed: boolean, reason?: string, args?: unknown): Promise<void> {
    const timestamp = new Date();
    const entry: Record<string, unknown> = {
      timestamp: timestamp.toISOString(),
      toolName: this.name,
      conversationId: this.conversationId,
      allowed,
    };
    if (reason !== undefined) {
      entry.reason = reason;
    }
    console.log(JSON.stringify(entry));

    if (this.logger) {
      try {
        await this.logger.log({
          toolName: this.name,
          conversationId: this.conversationId,
          allowed,
          reason,
          args,
          timestamp,
        });
      } catch (error) {
        console.error('[ToolGuard] Error persisting security log:', error);
      }
    }
  }
}
