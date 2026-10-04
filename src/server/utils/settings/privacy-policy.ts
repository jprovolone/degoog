import { getInstanceSettings } from "./server-settings";
import { asString } from "./plugin-settings";

export const PRIVACY_POLICY_KEY = "privacyPolicy";

export const readPrivacyPolicy = async (): Promise<string> =>
  asString((await getInstanceSettings())[PRIVACY_POLICY_KEY]).trim();
