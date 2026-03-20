export function credentialRefToEnvVarName(credentialRef: string): string {
  const normalized = credentialRef
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `OPENCLAW_CREDENTIAL_${normalized}`;
}

export function loadCredentialRef(credentialRef: string): string {
  const envKey = credentialRef.startsWith('env:')
    ? credentialRef.slice(4).trim()
    : credentialRefToEnvVarName(credentialRef);

  const value = process.env[envKey];

  if (!value) {
    throw new Error(
      `Credential reference '${credentialRef}' could not be resolved via environment variable '${envKey}'`,
    );
  }

  return value;
}
