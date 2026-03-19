import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  initializeWorkspace,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '@/lib/services/workspace-service';

const updateWorkspaceFileSchema = z.object({
  file: z.string().min(1),
  content: z.string(),
});

export async function GET(request: NextRequest) {
  try {
    initializeWorkspace();

    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get('file');

    if (fileName) {
      const content = readWorkspaceFile(fileName);
      if (content === null) {
        return NextResponse.json(
          { success: false, error: 'Workspace file not found' },
          { status: 404 },
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          name: fileName,
          size: Buffer.byteLength(content, 'utf-8'),
          content,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: listWorkspaceFiles(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid workspace filename') {
      return NextResponse.json(
        { success: false, error: 'Invalid workspace filename' },
        { status: 400 },
      );
    }

    console.error('[Workspace API] Failed to read workspace files:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    initializeWorkspace();

    const body = await request.json();
    const parsedBody = updateWorkspaceFileSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: parsedBody.error.flatten(),
        },
        { status: 400 },
      );
    }

    const result = writeWorkspaceFile(parsedBody.data.file, parsedBody.data.content);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.message === 'Invalid workspace filename') {
      return NextResponse.json(
        { success: false, error: 'Invalid workspace filename' },
        { status: 400 },
      );
    }

    console.error('[Workspace API] Failed to update workspace file:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
