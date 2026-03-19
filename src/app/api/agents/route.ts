// API Route: /api/agents
// Agent management endpoints

import { NextRequest, NextResponse } from 'next/server';
import { agentService } from '@/lib/services/agent-service';
import { memoryService } from '@/lib/services/memory-service';
import { z } from 'zod';

const createAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  description: z.string().optional(),
  skills: z.array(z.string().min(1)).optional(),
});

// GET /api/agents - List all agents
export async function GET() {
  try {
    const agents = await agentService.getAgents();
    return NextResponse.json({
      success: true,
      data: agents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// POST /api/agents - Create a new agent
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = createAgentSchema.safeParse(body);

    if (!parsed.success) {
      const { formErrors, fieldErrors } = parsed.error.flatten();
      const fieldMessages = Object.values(fieldErrors).flat().filter(Boolean);
      const message = [...formErrors, ...fieldMessages].join(', ') || 'Invalid request payload';
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }

    const { name, description, skills } = parsed.data;

    const agent = await agentService.createAgent({
      name,
      description,
      skills: skills ?? [],
    });

    // Initialize default memories for the agent
    await memoryService.initializeAgentMemory(agent.id, agent.name);

    return NextResponse.json({
      success: true,
      data: agent,
      message: `Agent "${name}" created successfully`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
