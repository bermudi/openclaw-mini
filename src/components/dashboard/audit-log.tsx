'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield } from 'lucide-react';
import { SeverityBadge } from './status-badges';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  severity: string;
  createdAt: string;
}

interface AuditLogProps {
  auditLogs: AuditLog[];
}

export function AuditLog({ auditLogs }: AuditLogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400 font-mono text-xs">
          {auditLogs.length} events
        </Badge>
      </div>

      {auditLogs.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-card/30">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-violet-400" />
            </div>
            <h3 className="text-lg font-medium mb-2">No audit events</h3>
            <p className="text-muted-foreground">
              Events will be logged here as agents perform actions.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
          <ScrollArea className="h-[600px]">
            <div className="divide-y divide-border/30">
              {auditLogs.map((log, i) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02, duration: 0.2 }}
                  className="p-4 hover:bg-white/[0.02] transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{log.action}</span>
                        <SeverityBadge severity={log.severity} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <span className="text-zinc-500">{log.entityType}:</span>{' '}
                        <span className="font-mono text-xs">{log.entityId}</span>
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                      </p>
                      {expandedId === log.id && Object.keys(log.details).length > 0 && (
                        <motion.pre
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          className="text-xs text-zinc-400 mt-2 bg-zinc-900/50 p-3 rounded-lg overflow-x-auto font-mono"
                        >
                          {JSON.stringify(log.details, null, 2)}
                        </motion.pre>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
