// API Route: /api/agents/[id]
// Single agent operations

import { NextRequest, NextResponse } from 'next/server';
import { agentService } from '@/lib/services/agent-service';
import { z } from 'zod';

const updateAgentSchema = z.object({
  name: z.string().min(1, 'Agent name must not be empty').optional(),
  description: z.string().nullable().optional(),
  model: z.string().min(1, 'Model must not be empty').nullable().optional(),
  contextWindowOverride: z.number().int('Context window override must be an integer').min(1000, 'Context window override must be at least 1000').nullable().optional(),
  compactionThreshold: z.number().min(0.1, 'Compaction threshold must be between 0.1 and 0.9').max(0.9, 'Compaction threshold must be between 0.1 and 0.9').nullable().optional(),
  status: z.enum(['idle', 'busy', 'error', 'disabled']).optional(),
  skills: z.array(z.string().min(1)).optional(),
});

// GET /api/agents/[id] - Get agent by ID with stats
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await agentService.getAgentWithStats(id);
    
    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// PUT /api/agents/[id] - Update agent
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = updateAgentSchema.safeParse(body);

    if (!parsed.success) {
      const { formErrors, fieldErrors } = parsed.error.flatten();
      const fieldMessages = Object.values(fieldErrors).flat().filter(Boolean);
      const message = [...formErrors, ...fieldMessages].join(', ') || 'Invalid request payload';
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
    
    const agent = await agentService.updateAgent(id, parsed.data);
    
    if (!agent) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: agent,
      message: 'Agent updated successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// DELETE /api/agents/[id] - Delete agent
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await agentService.deleteAgent(id);
    
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Agent deleted successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
