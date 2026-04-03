## ADDED Requirements

### Requirement: Delivery service accepts injected Prisma client
The `processPendingDeliveries()` function SHALL accept an optional `PrismaClient` parameter. When provided, it SHALL use the injected client for all database operations. When not provided, it SHALL fall back to the default `db` singleton for backward compatibility.

#### Scenario: Scheduler passes its own Prisma client
- **WHEN** the scheduler calls `processPendingDeliveries(schedulerPrisma)`
- **THEN** all delivery database operations use the scheduler's Prisma client

#### Scenario: Main app uses default db singleton
- **WHEN** `processPendingDeliveries()` is called without arguments
- **THEN** all delivery database operations use the default `db` singleton

### Requirement: All delivery service internal functions accept Prisma client
The internal functions `dispatchDelivery()`, `markDeliveryFailed()`, and `getDeliveryModel()` SHALL accept a `PrismaClient` parameter or operate within a context where the client is available. The `enqueueDelivery()` and `enqueueDeliveryTx()` functions SHALL continue to accept a transaction/client parameter as they already do.

#### Scenario: dispatchDelivery uses injected client
- **WHEN** `dispatchDelivery(delivery, schedulerPrisma)` is called
- **THEN** all database updates for that delivery use the injected client

#### Scenario: markDeliveryFailed uses injected client
- **WHEN** `markDeliveryFailed(id, error, schedulerPrisma)` is called
- **THEN** the delivery status update uses the injected client

### Requirement: Scheduler passes its Prisma client to delivery processing
The scheduler's `runDeliveryLoop` SHALL pass its own Prisma client (obtained via `getSchedulerPrisma()`) to `processPendingDeliveries()`.

#### Scenario: Delivery loop uses scheduler Prisma
- **WHEN** `runDeliveryLoop` processes deliveries
- **THEN** it calls `processPendingDeliveries(schedulerPrisma)` with the scheduler's client