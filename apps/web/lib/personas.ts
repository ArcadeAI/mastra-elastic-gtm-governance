import "server-only";

export const PERSONA_KEYS = ["dana", "sam", "riley", "morgan"] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

const ENV_BY_PERSONA: Record<PersonaKey, string> = {
  dana: "PERSONA_DANA_EMAIL",
  sam: "PERSONA_SAM_EMAIL",
  riley: "PERSONA_RILEY_EMAIL",
  morgan: "PERSONA_MORGAN_EMAIL",
};

export function isPersonaKey(value: string | null): value is PersonaKey {
  return value !== null && PERSONA_KEYS.some((key) => key === value);
}

export function personaEmail(persona: PersonaKey): string {
  const envName = ENV_BY_PERSONA[persona];
  const email = process.env[envName]?.trim();
  if (!email) throw new Error(`${envName} is not configured.`);
  return email;
}
