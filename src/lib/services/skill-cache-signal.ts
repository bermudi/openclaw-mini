let skillCacheDirty = false;

export function markSkillCacheDirty(): void {
  skillCacheDirty = true;
}

export function consumeSkillCacheDirty(): boolean {
  const dirty = skillCacheDirty;
  skillCacheDirty = false;
  return dirty;
}

export function resetSkillCacheDirtyForTests(): void {
  skillCacheDirty = false;
}
