export type EmailCodeFactor = {
  strategy: 'email_code';
  emailAddressId: string;
};

export type SignInAttempt = {
  status: string | null;
  createdSessionId: string | null;
  supportedFirstFactors?: Array<{ strategy: string; emailAddressId?: string }> | null;
  supportedSecondFactors?: Array<{ strategy: string; emailAddressId?: string }> | null;
};

export function findEmailCodeFactor(
  factors: Array<{ strategy: string; emailAddressId?: string }> | null | undefined,
): EmailCodeFactor | undefined {
  const match = factors?.find((factor) => factor.strategy === 'email_code' && factor.emailAddressId);
  return match as EmailCodeFactor | undefined;
}
