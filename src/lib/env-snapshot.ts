export function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of Object.keys(process.env)) {
    snap[key] = process.env[key];
  }
  return snap;
}

export function restoreEnvSnapshot(snap: Record<string, string | undefined>): void {
  for (const key of Object.keys(snap)) {
    if (process.env[key] !== snap[key]) {
      if (snap[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snap[key];
      }
    }
  }
  for (const key of Object.keys(process.env)) {
    if (!(key in snap)) {
      delete process.env[key];
    }
  }
}
