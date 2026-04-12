// Dashboard-only Next.js instrumentation entry point.
// Intentionally no-op so the dashboard app does not pick up the root app's
// instrumentation file and its server-only dependencies.

export async function register(): Promise<void> {}
