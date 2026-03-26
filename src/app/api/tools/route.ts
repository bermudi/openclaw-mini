// API Route: /api/tools
// Tool management endpoints

import { NextRequest, NextResponse } from 'next/server';
import { getTool, getToolMeta, getToolSchemas } from '@/lib/tools';
import { requireInternalAuth } from '@/lib/api-auth';

// GET /api/tools - List all available tools
export async function GET(request: NextRequest) {
  try {
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

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

      const toolMeta = getToolMeta(toolName);
      const schemas = await getToolSchemas();
      const toolSchema = schemas.find(schema => schema.name === toolName);

      if (!toolSchema || !toolMeta) {
        return NextResponse.json(
          { success: false, error: 'Tool schema not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: toolSchema,
      });
    }

    const tools = await getToolSchemas();

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
    const authResponse = await requireInternalAuth(request);
    if (authResponse) return authResponse;

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

    if (!tool.execute) {
      return NextResponse.json(
        { success: false, error: 'Tool execution not available' },
        { status: 400 }
      );
    }

    const result = await tool.execute(params || {}, {
      toolCallId: `manual-${Date.now()}`,
      messages: [],
    });

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
