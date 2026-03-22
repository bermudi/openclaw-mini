// OpenClaw Agent Runtime - Audit Service
// Security audit trail and event logging

import { db } from '@/lib/db';
import { getRuntimeConfig } from '@/lib/config/runtime';

export interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'error' | 'critical';
}

class AuditService {
  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await db.auditLog.create({
        data: {
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          details: JSON.stringify(entry.details || {}),
          severity: entry.severity || 'info',
        },
      });
    } catch (error) {
      // Don't throw on audit log failures - just console log
      console.error('[Audit] Failed to log event:', entry, error);
    }
  }

  /**
   * Get audit logs for an entity
   */
  async getEntityLogs(
    entityType: string,
    entityId: string,
    limit: number = 50
  ): Promise<Array<{
    id: string;
    action: string;
    details: Record<string, unknown>;
    severity: string;
    createdAt: Date;
  }>> {
    const logs = await db.auditLog.findMany({
      where: {
        entityType,
        entityId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs.map(log => ({
      id: log.id,
      action: log.action,
      details: JSON.parse(log.details),
      severity: log.severity,
      createdAt: log.createdAt,
    }));
  }

  /**
   * Get recent audit logs
   */
  async getRecentLogs(
    options?: {
      severity?: 'info' | 'warning' | 'error' | 'critical';
      action?: string;
      limit?: number;
    }
  ): Promise<Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    details: Record<string, unknown>;
    severity: string;
    createdAt: Date;
  }>> {
    const logs = await db.auditLog.findMany({
      where: {
        ...(options?.severity && { severity: options.severity }),
        ...(options?.action && { action: options.action }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 100,
    });

    return logs.map(log => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      details: JSON.parse(log.details),
      severity: log.severity,
      createdAt: log.createdAt,
    }));
  }

  /**
   * Get audit statistics
   */
  async getStats(days: number = 7): Promise<{
    total: number;
    bySeverity: Record<string, number>;
    byAction: Record<string, number>;
  }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const logs = await db.auditLog.findMany({
      where: { createdAt: { gte: cutoff } },
    });

    const bySeverity: Record<string, number> = {};
    const byAction: Record<string, number> = {};

    for (const log of logs) {
      bySeverity[log.severity] = (bySeverity[log.severity] || 0) + 1;
      byAction[log.action] = (byAction[log.action] || 0) + 1;
    }

    return {
      total: logs.length,
      bySeverity,
      byAction,
    };
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(daysOld?: number): Promise<number> {
    const resolvedDays = daysOld ?? getRuntimeConfig().retention.auditLogs;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - resolvedDays);

    const result = await db.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return result.count;
  }

  /**
   * Check for suspicious activity
   */
  async detectAnomalies(): Promise<Array<{
    type: string;
    details: Record<string, unknown>;
    count: number;
  }>> {
    const anomalies: Array<{ type: string; details: Record<string, unknown>; count: number }> = [];

    // Check for high failure rate in last hour
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentFailures = await db.auditLog.count({
      where: {
        action: 'task_failed',
        createdAt: { gte: oneHourAgo },
      },
    });

    if (recentFailures > 10) {
      anomalies.push({
        type: 'high_failure_rate',
        details: { threshold: 10, actual: recentFailures, period: '1 hour' },
        count: recentFailures,
      });
    }

    // Check for critical errors
    const criticalErrors = await db.auditLog.count({
      where: {
        severity: 'critical',
        createdAt: { gte: oneHourAgo },
      },
    });

    if (criticalErrors > 0) {
      anomalies.push({
        type: 'critical_errors',
        details: { count: criticalErrors },
        count: criticalErrors,
      });
    }

    // Check for unusual activity volume
    const recentActivity = await db.auditLog.count({
      where: { createdAt: { gte: oneHourAgo } },
    });

    if (recentActivity > 100) {
      anomalies.push({
        type: 'high_activity_volume',
        details: { threshold: 100, actual: recentActivity },
        count: recentActivity,
      });
    }

    return anomalies;
  }
}

export const auditService = new AuditService();
