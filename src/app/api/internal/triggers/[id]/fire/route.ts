import { NextRequest, NextResponse } from 'next/server'
import { requireInternalAuth } from '@/lib/api-auth'
import { storageErrorResponse } from '@/lib/api/storage-errors'
import { triggerService } from '@/lib/services/trigger-service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResponse = await requireInternalAuth(request)
    if (authResponse) return authResponse

    const { id } = await params
    const body = await request.json() as {
      lastTriggered?: string
      nextTrigger?: string
    }

    if (!body.lastTriggered || !body.nextTrigger) {
      return NextResponse.json(
        { success: false, error: 'lastTriggered and nextTrigger are required' },
        { status: 400 },
      )
    }

    const trigger = await triggerService.recordTriggerFire(id, {
      lastTriggered: new Date(body.lastTriggered),
      nextTrigger: new Date(body.nextTrigger),
    })

    if (!trigger) {
      return NextResponse.json(
        { success: false, error: 'Trigger not found' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      data: trigger,
      message: 'Trigger fire recorded successfully',
    })
  } catch (error) {
    const storageResponse = storageErrorResponse(error)
    if (storageResponse) return storageResponse

    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    )
  }
}
