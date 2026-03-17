// API Route: /api/agents
// Agent management endpoints

import { NextRequest, NextResponse } from 'next/server';
import { agentService } from '@/lib/services/agent-service';
import { memoryService } from '@/lib/services/memory-service';

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
    const { name, description, skills } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: 'Agent name is required' },
        { status: 400 }
      );
    }

    const agent = await agentService.createAgent({
      name,
      description,
      skills,
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
