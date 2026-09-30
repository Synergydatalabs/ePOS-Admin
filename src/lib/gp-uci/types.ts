// UCI — shared types (trimmed to what pingTerminal needs).
// Full type surface lives in tap-app; only auth + api error classes are used
// here because the admin only calls pingTerminal.

export interface UciAccessToken {
  token: string;
  type: string; // "Bearer"
  expiresAt: Date;
  scope: string;
}

export class UciAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UciAuthError";
  }
}

export class UciApiError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string
  ) {
    super(message);
    this.name = "UciApiError";
  }
}
