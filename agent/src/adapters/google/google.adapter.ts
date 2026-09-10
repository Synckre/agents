import { calendar_v3, drive_v3, google } from 'googleapis';

export interface GoogleAdapterConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly refreshToken?: string;
}

/**
 * Adapter de infraestructura de Google: OAuth2 (client id + secret + refresh token) vía googleapis.
 * No implementa puertos de dominio; cada servicio (Calendar, Gmail, …) tiene el suyo.
 */
export class GoogleAdapter {
  private authClient: InstanceType<typeof google.auth.OAuth2> | null = null;
  private calendarClient: calendar_v3.Calendar | null = null;
  private driveClient: drive_v3.Drive | null = null;

  constructor(private readonly config: GoogleAdapterConfig = {}) {}

  calendar(): calendar_v3.Calendar {
    if (!this.calendarClient) {
      this.calendarClient = google.calendar({ version: 'v3', auth: this.auth() });
    }
    return this.calendarClient;
  }

  getDriveClient(): drive_v3.Drive {
    if (!this.driveClient) {
      this.driveClient = google.drive({ version: 'v3', auth: this.auth() });
    }
    return this.driveClient;
  }

  private auth(): InstanceType<typeof google.auth.OAuth2> {
    if (this.authClient) {
      return this.authClient;
    }

    const clientId = this.config.clientId;
    const clientSecret = this.config.clientSecret;

    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured');
    }

    this.authClient = new google.auth.OAuth2(clientId, clientSecret);
    if (this.config.refreshToken) {
      this.authClient.setCredentials({
        refresh_token: this.config.refreshToken,
      });
    }
    return this.authClient;
  }
}
