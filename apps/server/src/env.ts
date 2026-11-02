export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
};

export function requireDatabaseUrl(): string {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  return env.databaseUrl;
}
