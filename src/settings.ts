/** The app's switches, read once from the environment. Each is off unless set to exactly "true". */
export interface Settings {
  /**
   * SMS_NOTIFICATIONS (off by default): send an SMS after every transfer, as well as the push notification and the
   * e-mail. A trial of the draft "SMS after every transfer" (BRD 3.5, not approved); while it is off no SMS is sent.
   */
  smsNotifications: boolean;
}

export const DEFAULT_SETTINGS: Settings = { smsNotifications: false };

export function settingsFrom(env: Record<string, string | undefined>): Settings {
  return { smsNotifications: env.SMS_NOTIFICATIONS === "true" };
}
