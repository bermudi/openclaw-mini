// API Route: /api/skills
// Skill discovery endpoint

import { NextResponse } from 'next/server';
import { loadAllSkills } from '@/lib/services/skill-service';

// GET /api/skills - List all discovered skills
export async function GET() {
  try {
    const skills = await loadAllSkills();

    const data = skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      enabled: skill.enabled,
      gatingReason: skill.gatingReason,
      source: skill.source,
    }));

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[Skills API] Failed to load skills:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
