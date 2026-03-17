// API Route: /api/tools
// Tool management endpoints

import { NextRequest, NextResponse } from 'next/server';
import { getAvailableTools, getTool } from '@/lib/tools';

// GET /api/tools - List all available tools
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const toolName = searchParams.get('name');

    if (toolName) {
      const tool = getTool(toolName);
      if (!tool) {
        return NextResponse.json(
          { success: false, error: 'Tool not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        data: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          riskLevel: tool.riskLevel,
        },
      });
    }

    const tools = getAvailableTools().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      riskLevel: tool.riskLevel,
    }));

    return NextResponse.json({
      success: true,
      data: tools,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// POST /api/tools - Execute a tool directly (for testing)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tool: toolName, params } = body;

    if (!toolName) {
      return NextResponse.json(
        { success: false, error: 'Tool name is required' },
        { status: 400 }
      );
    }

    const tool = getTool(toolName);
    if (!tool) {
      return NextResponse.json(
        { success: false, error: 'Tool not found' },
        { status: 404 }
      );
    }

    const result = await tool.execute(params || {});

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
