/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, spyOn, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { storageErrorResponse } from '../src/lib/api/storage-errors'
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture'

const TEST_DB_PATH = path.join(process.cwd(), 'db', 'sqlite-concurrency-strategy.test.db')
const TEST_DB_URL = `file:${TEST_DB_PATH}`
const AUTH_TOKEN = 'sqlite-concurrency-secret'

let db: PrismaClient
let runtimeConfigFixture: RuntimeConfigFixture | null = null

let taskQueue: typeof import('../src/lib/services/task-queue').taskQueue
let triggerService: typeof import('../src/lib/services/trigger-service').triggerService
let schedulerModule: typeof import('../mini-services/scheduler/index')
let schedulerHealthRoute: typeof import('../src/app/api/scheduler/health/route')
let taskRoute: typeof import('../src/app/api/tasks/route')
let triggerFireRoute: typeof import('../src/app/api/internal/triggers/[id]/fire/route')
let triggerManualFireRoute: typeof import('../src/app/api/triggers/[id]/fire/route')
let wsClient: typeof import('../src/lib/services/ws-client').wsClient
let sqliteConcurrency: typeof import('../src/lib/sqlite-concurrency')

function bearerRequest(url: string, init: RequestInit = {}): NextRequest {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${AUTH_TOKEN}`)

  return new NextRequest(url, {
    method: init.method,
    body: init.body,
    cache: init.cache,
    credentials: init.credentials,
    headers,
    integrity: init.integrity,
    keepalive: init.keepalive,
    mode: init.mode,
    redirect: init.redirect,
    referrer: init.referrer,
    referrerPolicy: init.referrerPolicy,
    signal: init.signal ?? undefined,
  })
}

async function routeInternalFetch(url: string, init?: RequestInit): Promise<Response> {
  const request = bearerRequest(url, init)
  const parsedUrl = new URL(url)
  const pathname = parsedUrl.pathname

  if (parsedUrl.port === '3003' && pathname === '/broadcast') {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (pathname === '/api/tasks') {
    return taskRoute.POST(request)
  }

  if (pathname.startsWith('/api/internal/triggers/') && pathname.endsWith('/fire')) {
    const segments = pathname.split('/')
    const triggerId = segments[4]
    return triggerFireRoute.POST(request, { params: Promise.resolve({ id: triggerId ?? '' }) })
  }

  if (pathname === '/api/scheduler/health') {
    return schedulerHealthRoute.POST(request)
  }

  throw new Error(`Unhandled internal fetch in test: ${url}`)
}

async function resetDb(): Promise<void> {
  await db.sessionMessage.deleteMany()
  await db.outboundDelivery.deleteMany()
  await db.task.deleteMany()
  await db.session.deleteMany()
  await db.channelBinding.deleteMany()
  await db.trigger.deleteMany()
  await db.webhookLog.deleteMany()
  await db.memory.deleteMany()
  await db.auditLog.deleteMany()
  await db.agent.deleteMany()
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DB_URL
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key'
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key'
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key'
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key'
  process.env.OPENCLAW_API_KEY = AUTH_TOKEN

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-sqlite-concurrency-', {
    runtime: {
      retention: {
        tasks: 30,
      },
    },
  })
  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true })
  }

  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true })

  const dbPush = Bun.spawnSync({
    cmd: ['bunx', 'prisma', 'db', 'push'],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (dbPush.exitCode !== 0) {
    throw new Error(`Failed to prepare sqlite concurrency test database: ${dbPush.stderr.toString()}`)
  }

  const dbModule = await import('../src/lib/db')
  db = dbModule.db

  ;({ taskQueue } = await import('../src/lib/services/task-queue'))
  ;({ triggerService } = await import('../src/lib/services/trigger-service'))
  schedulerModule = await import('../mini-services/scheduler/index')
  schedulerHealthRoute = await import('../src/app/api/scheduler/health/route')
  taskRoute = await import('../src/app/api/tasks/route')
  triggerFireRoute = await import('../src/app/api/internal/triggers/[id]/fire/route')
  triggerManualFireRoute = await import('../src/app/api/triggers/[id]/fire/route')
  ;({ wsClient } = await import('../src/lib/services/ws-client'))
  sqliteConcurrency = await import('../src/lib/sqlite-concurrency')
})

beforeEach(async () => {
  await resetDb()
  sqliteConcurrency.resetSqliteBusyMetricsForTests()
  await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000')
})

afterAll(async () => {
  await resetDb()
  await db.$disconnect()
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir)
    runtimeConfigFixture = null
  }
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { force: true })
  }
})

test('single-writer flow routes scheduler lifecycle writes through APIs', async () => {
  const agent = await db.agent.create({
    data: { name: 'writer-agent' },
  })
  const trigger = await triggerService.createTrigger({
    agentId: agent.id,
    name: 'heartbeat-trigger',
    type: 'heartbeat',
    config: { interval: 30 },
    enabled: true,
  })
  await db.trigger.update({
    where: { id: trigger.id },
    data: {
      nextTrigger: new Date('2026-03-25T00:00:00.000Z'),
    },
  })

  const fetchSpy = spyOn(global, 'fetch').mockImplementation((async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    return routeInternalFetch(url, init)
  }) as typeof fetch)
  const broadcastsBefore = sqliteConcurrency.getSqliteBusyMetrics()

  const triggerTaskResult = await schedulerModule.createTaskViaApi({
    agentId: agent.id,
    type: 'heartbeat',
    priority: 7,
    payload: { triggerId: trigger.id, timestamp: new Date().toISOString() },
    source: 'heartbeat:test',
  })
  expect(triggerTaskResult.success).toBe(true)

  const createdTask = await db.task.findFirst({
    where: { agentId: agent.id, source: 'heartbeat:test' },
    orderBy: { createdAt: 'desc' },
  })
  expect(createdTask).not.toBeNull()

  const recordResult = await schedulerModule.fireTriggerViaApi({
    triggerId: trigger.id,
    referenceTime: '2026-03-25T00:00:00.000Z',
  })
  expect(recordResult.success).toBe(true)

  const updatedTrigger = await db.trigger.findUnique({ where: { id: trigger.id } })
  expect(updatedTrigger?.lastTriggered?.toISOString()).toBe('2026-03-25T00:00:00.000Z')
  expect(updatedTrigger?.nextTrigger?.toISOString()).toBe('2026-03-25T00:30:00.000Z')

  const maintenanceResult = await schedulerModule.runSchedulerMaintenanceViaApi({
    processDeliveries: false,
    sweepOrphanedSubagents: false,
    cleanupOldTasks: true,
  })
  expect(maintenanceResult.success).toBe(true)

  const calledUrls = fetchSpy.mock.calls.map(call => String(call[0]))
  expect(calledUrls.some(url => url.includes('/api/tasks'))).toBe(true)
  expect(calledUrls.some(url => url.includes(`/api/internal/triggers/${trigger.id}/fire`))).toBe(true)
  expect(calledUrls.some(url => url.includes('/api/scheduler/health'))).toBe(true)
  expect(sqliteConcurrency.getSqliteBusyMetrics().busyEvents).toBe(broadcastsBefore.busyEvents)

  fetchSpy.mockRestore()
})

test('retry helper logs contention and records success metrics', async () => {
  const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})

  let attempts = 0
  const result = await sqliteConcurrency.retrySqliteBusy('test.operation', async () => {
    attempts += 1
    if (attempts < 3) {
      throw new Error('SQLITE_BUSY: database is locked')
    }
    return 'ok'
  })

  expect(result).toBe('ok')
  expect(attempts).toBe(3)

  const metrics = sqliteConcurrency.getSqliteBusyMetrics()
  expect(metrics.busyEvents).toBe(2)
  expect(metrics.retryAttempts).toBe(2)
  expect(metrics.retrySuccesses).toBe(1)
  expect(metrics.retryExhausted).toBe(0)
  expect(metrics.retrySuccessRate).toBe(1)
  expect(warnSpy).toHaveBeenCalled()

  warnSpy.mockRestore()
})

test('busy retry wrapper exhausts under lock contention', async () => {
  const handler = sqliteConcurrency.buildSqliteConcurrencyQueryExtension('test').query.$allModels.$allOperations
  let attempts = 0

  await expect(handler({
    model: 'Agent',
    operation: 'update',
    args: {},
    query: async () => {
      attempts += 1
      throw new Error('SQLITE_BUSY: database is locked')
    },
  })).rejects.toThrow('SQLITE_BUSY')

  const metrics = sqliteConcurrency.getSqliteBusyMetrics()
  expect(attempts).toBe(5)
  expect(metrics.retryAttempts).toBe(4)
  expect(metrics.retryExhausted).toBe(1)
})

test('scheduler health endpoint exposes sqlite busy counters and maintenance results', async () => {
  const agent = await db.agent.create({
    data: { name: 'health-agent' },
  })
  const staleTask = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    payload: { text: 'stale' },
  })
  const recentTask = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    payload: { text: 'recent' },
  })
  await db.task.update({
    where: { id: staleTask.id },
    data: {
      status: 'completed',
      completedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    },
  })
  await db.task.update({
    where: { id: recentTask.id },
    data: {
      status: 'completed',
      completedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    },
  })

  await sqliteConcurrency.retrySqliteBusy('health.metrics', async () => {
    throw new Error('SQLITE_BUSY: database is locked')
  }).catch(() => {})

  const response = await schedulerHealthRoute.POST(bearerRequest('http://localhost/api/scheduler/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      processDeliveries: false,
      sweepOrphanedSubagents: false,
      cleanupOldTasks: true,
    }),
  }))
  const body = await response.json() as {
    success: boolean
    data: {
      tasksCleaned: number
      sqliteBusy: {
        busyEvents: number
        retryAttempts: number
        retryExhausted: number
      }
    }
  }

  expect(response.status).toBe(200)
  expect(body.success).toBe(true)
  expect(body.data.tasksCleaned).toBe(1)
  expect(body.data.sqliteBusy.busyEvents).toBeGreaterThan(0)
  expect(body.data.sqliteBusy.retryAttempts).toBeGreaterThan(0)
  expect(body.data.sqliteBusy.retryExhausted).toBe(1)

  const remainingTasks = await db.task.findMany({
    where: { id: { in: [staleTask.id, recentTask.id] } },
  })
  expect(remainingTasks.some(task => task.id === recentTask.id)).toBe(true)
  expect(remainingTasks.some(task => task.id === staleTask.id)).toBe(false)
})

test('restarted worker cannot claim a second task for the same agent', async () => {
  const agent = await db.agent.create({
    data: { name: 'restart-agent' },
  })
  const activeTask = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    payload: { text: 'active' },
    source: 'restart:test',
  })
  const queuedTask = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    payload: { text: 'queued' },
    source: 'restart:test',
  })

  const claimed = await taskQueue.startTask(activeTask.id)
  expect(claimed?.status).toBe('processing')

  const restart = Bun.spawnSync({
    cmd: [
      'bun',
      '--eval',
      `process.env.DATABASE_URL = ${JSON.stringify(TEST_DB_URL)}; const { taskQueue } = await import('./src/lib/services/task-queue'); const result = await taskQueue.startTask(${JSON.stringify(queuedTask.id)}); console.log(JSON.stringify({ claimed: Boolean(result), status: result?.status ?? null }));`,
    ],
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  expect(restart.exitCode).toBe(0)

  const restartOutput = restart.stdout.toString().trim().split(/\r?\n/).filter(Boolean).at(-1) ?? ''
  const restartResult = JSON.parse(restartOutput) as {
    claimed: boolean;
    status: string | null;
  }

  expect(restartResult.claimed).toBe(false)
  expect(restartResult.status).toBeNull()

  const queuedRecord = await db.task.findUnique({ where: { id: queuedTask.id } })
  expect(queuedRecord?.status).toBe('pending')
})

test('startTask returns null for non-pending tasks instead of throwing', async () => {
  const agent = await db.agent.create({
    data: { name: 'invalid-claim-agent' },
  })
  const task = await taskQueue.createTask({
    agentId: agent.id,
    type: 'message',
    payload: { text: 'done' },
    source: 'invalid-state:test',
  })

  await db.task.update({
    where: { id: task.id },
    data: {
      status: 'completed',
      completedAt: new Date(),
    },
  })

  await expect(taskQueue.startTask(task.id)).resolves.toBeNull()
})

test('scheduler health sweep resets stale busy agents without active tasks', async () => {
  const agent = await db.agent.create({
    data: { name: 'stale-busy-agent' },
  })
  await db.agent.update({ where: { id: agent.id }, data: { status: 'busy' } })

  const response = await schedulerHealthRoute.POST(bearerRequest('http://localhost/api/scheduler/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      processDeliveries: false,
      sweepOrphanedSubagents: false,
      sweepStaleBusyAgents: true,
      cleanupOldTasks: false,
    }),
  }))

  const body = await response.json() as {
    success: boolean;
    data: {
      staleBusyAgents: {
        inspected: number;
        recovered: number;
        errored: number;
      } | null;
    };
  }

  expect(response.status).toBe(200)
  expect(body.success).toBe(true)
  expect(body.data.staleBusyAgents?.recovered).toBe(1)
  expect(body.data.staleBusyAgents?.errored).toBe(0)

  const updatedAgent = await db.agent.findUnique({ where: { id: agent.id } })
  expect(updatedAgent?.status).toBe('idle')

  const auditLog = await db.auditLog.findFirst({
    where: {
      entityType: 'agent',
      entityId: agent.id,
      action: 'agent_recovered_idle',
    },
    orderBy: { createdAt: 'desc' },
  })
  expect(auditLog).not.toBeNull()
})

test('scheduler health sweep uses processing-task timestamps for stale detection', async () => {
  const agent = await db.agent.create({
    data: { name: 'timestamp-stale-agent' },
  })
  const task = await db.task.create({
    data: {
      agentId: agent.id,
      type: 'message',
      status: 'processing',
      payload: JSON.stringify({ text: 'stuck' }),
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  })

  await db.agent.update({
    where: { id: agent.id },
    data: { status: 'busy' },
  })

  const response = await schedulerHealthRoute.POST(bearerRequest('http://localhost/api/scheduler/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      processDeliveries: false,
      sweepOrphanedSubagents: false,
      sweepStaleBusyAgents: true,
      cleanupOldTasks: false,
    }),
  }))

  const body = await response.json() as {
    success: boolean;
    data: {
      staleBusyAgents: {
        inspected: number;
        recovered: number;
        errored: number;
      } | null;
    };
  }

  expect(response.status).toBe(200)
  expect(body.success).toBe(true)
  expect(body.data.staleBusyAgents?.errored).toBe(1)

  const updatedAgent = await db.agent.findUnique({ where: { id: agent.id } })
  expect(updatedAgent?.status).toBe('error')

  const updatedTask = await db.task.findUnique({ where: { id: task.id } })
  expect(updatedTask?.status).toBe('processing')
})

test('scheduler health sweep marks unrecoverable stale busy agents as error', async () => {
  const agent = await db.agent.create({
    data: { name: 'stale-error-agent' },
  })
  const task = await db.task.create({
    data: {
      agentId: agent.id,
      type: 'message',
      status: 'processing',
      payload: JSON.stringify({ text: 'stuck' }),
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
  })
  await db.agent.update({ where: { id: agent.id }, data: { status: 'busy' } })

  const response = await schedulerHealthRoute.POST(bearerRequest('http://localhost/api/scheduler/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      processDeliveries: false,
      sweepOrphanedSubagents: false,
      sweepStaleBusyAgents: true,
      cleanupOldTasks: false,
    }),
  }))

  const body = await response.json() as {
    success: boolean;
    data: {
      staleBusyAgents: {
        inspected: number;
        recovered: number;
        errored: number;
      } | null;
    };
  }

  expect(response.status).toBe(200)
  expect(body.success).toBe(true)
  expect(body.data.staleBusyAgents?.recovered).toBe(0)
  expect(body.data.staleBusyAgents?.errored).toBe(1)

  const updatedAgent = await db.agent.findUnique({ where: { id: agent.id } })
  expect(updatedAgent?.status).toBe('error')

  const auditLog = await db.auditLog.findFirst({
    where: {
      entityType: 'agent',
      entityId: agent.id,
      action: 'agent_recovery_failed',
    },
    orderBy: { createdAt: 'desc' },
  })
  expect(auditLog).not.toBeNull()

  const taskRecord = await db.task.findUnique({ where: { id: task.id } })
  expect(taskRecord?.status).toBe('processing')
})

test('sqlite busy helper maps lock errors to 503 guidance', () => {
  const response = storageErrorResponse(new Error('SQLITE_BUSY: database is locked'))

  expect(response?.status).toBe(503)
})

test('concurrent scheduler and API task writes keep both updates through the single-writer API', async () => {
  const agent = await db.agent.create({
    data: { name: 'concurrent-agent' },
  })
  const fetchSpy = spyOn(global, 'fetch').mockImplementation((async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    return routeInternalFetch(url, init)
  }) as typeof fetch)

  const [schedulerResult, apiResponse] = await Promise.all([
    schedulerModule.createTaskViaApi({
      agentId: agent.id,
      type: 'heartbeat',
      priority: 7,
      payload: { triggerId: 'trigger-1', timestamp: '2026-03-25T00:00:00.000Z' },
      source: 'heartbeat:scheduler',
    }),
    taskRoute.POST(bearerRequest('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: agent.id,
        type: 'message',
        priority: 5,
        payload: { text: 'dashboard task' },
        source: 'dashboard:manual',
      }),
    })),
  ])

  expect(schedulerResult.success).toBe(true)
  expect(apiResponse.status).toBe(200)

  const tasks = await db.task.findMany({
    where: { agentId: agent.id },
    orderBy: { createdAt: 'asc' },
  })
  expect(tasks).toHaveLength(2)
  expect(tasks.some(task => task.source === 'heartbeat:scheduler')).toBe(true)
  expect(tasks.some(task => task.source === 'dashboard:manual')).toBe(true)

  const auditLogs = await db.auditLog.findMany({
    where: { action: 'task_created' },
  })
  expect(auditLogs).toHaveLength(2)
  expect(fetchSpy.mock.calls.some(call => String(call[0]).includes('/api/tasks'))).toBe(true)

  fetchSpy.mockRestore()
})

test('scheduled trigger fire updates trigger through internal API boundary', async () => {
  const agent = await db.agent.create({
    data: { name: 'trigger-agent' },
  })
  const trigger = await triggerService.createTrigger({
    agentId: agent.id,
    name: 'cron-trigger',
    type: 'cron',
    config: { cronExpression: '0 9 * * *' },
    enabled: true,
  })
  await db.trigger.update({
    where: { id: trigger.id },
    data: {
      nextTrigger: new Date('2026-03-25T09:00:00.000Z'),
    },
  })

  const response = await triggerFireRoute.POST(
    bearerRequest(`http://localhost/api/internal/triggers/${trigger.id}/fire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referenceTime: '2026-03-25T09:00:00.000Z' }),
    }),
    { params: Promise.resolve({ id: trigger.id }) },
  )

  expect(response.status).toBe(200)
  const updated = await db.trigger.findUnique({ where: { id: trigger.id } })
  expect(updated?.lastTriggered?.toISOString()).toBe('2026-03-25T09:00:00.000Z')
  expect(updated?.nextTrigger?.toISOString()).toBe('2026-03-26T09:00:00.000Z')
  const body = await response.json() as { data?: { task?: { source?: string } } }
  expect(body.data?.task?.source).toBe('cron:cron-trigger')
})

test('cron utility calculates next runs in UTC and rejects invalid expressions', async () => {
  const { calculateNextTimeTrigger, validateCronExpression } = await import('../src/lib/services/time-trigger')

  expect(calculateNextTimeTrigger('cron', { cronExpression: '0 9 * * *' }, new Date('2026-03-26T08:30:00Z'))?.toISOString()).toBe('2026-03-26T09:00:00.000Z')
  expect(calculateNextTimeTrigger('cron', { cronExpression: '0 9 * * *' }, new Date('2026-03-26T10:00:00Z'))?.toISOString()).toBe('2026-03-27T09:00:00.000Z')
  expect(calculateNextTimeTrigger('cron', { cronExpression: '0 * * * *' }, new Date('2026-03-26T10:15:00Z'))?.toISOString()).toBe('2026-03-26T11:00:00.000Z')
  expect(calculateNextTimeTrigger('cron', { cronExpression: '0 9 * * 1' }, new Date('2026-03-24T08:30:00Z'))?.toISOString()).toBe('2026-03-30T09:00:00.000Z')

  expect(() => validateCronExpression('not-a-cron')).toThrow('Invalid cron expression')
})

test('manual fire keeps schedule state while enqueuing a manual task', async () => {
  const agent = await db.agent.create({
    data: { name: 'manual-fire-agent' },
  })
  const trigger = await triggerService.createTrigger({
    agentId: agent.id,
    name: 'manual-cron',
    type: 'cron',
    config: { cronExpression: '0 9 * * *' },
    enabled: true,
  })
  const initialNextTrigger = trigger.nextTrigger?.toISOString()

  const response = await triggerManualFireRoute.POST(
    bearerRequest(`http://localhost/api/triggers/${trigger.id}/fire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: trigger.id }) },
  )

  expect(response.status).toBe(200)
  const body = await response.json() as { data?: { task?: { source?: string } } }
  expect(body.data?.task?.source).toBe('manual:cron:manual-cron')

  const updated = await db.trigger.findUnique({ where: { id: trigger.id } })
  expect(updated?.lastTriggered).toBeNull()
  expect(updated?.nextTrigger?.toISOString()).toBe(initialNextTrigger)
})

test('task creation still emits websocket-backed side effects through authoritative API', async () => {
  const agent = await db.agent.create({
    data: { name: 'event-agent' },
  })
  const broadcastSpy = spyOn(wsClient, 'broadcast').mockResolvedValue(true)

  const response = await taskRoute.POST(bearerRequest('http://localhost/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agentId: agent.id,
      type: 'message',
      payload: { text: 'queued' },
      source: 'scheduler:test',
    }),
  }))

  expect(response.status).toBe(200)
  expect(broadcastSpy).toHaveBeenCalled()
  const auditLog = await db.auditLog.findFirst({
    where: { action: 'task_created' },
    orderBy: { createdAt: 'desc' },
  })
  expect(auditLog).not.toBeNull()

  broadcastSpy.mockRestore()
})
