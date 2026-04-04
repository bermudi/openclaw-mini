'use client';

import { Badge } from '@/components/ui/badge';
import {
  Pause,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  MessageSquare,
  Heart,
  Calendar,
  Webhook,
  Zap,
  Bot,
  Activity,
} from 'lucide-react';

export function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { color: string; icon: React.ReactNode }> = {
    idle: { color: 'bg-zinc-600', icon: <Pause className="w-3 h-3" /> },
    busy: { color: 'bg-emerald-500 shadow-emerald-500/30 shadow-sm', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    error: { color: 'bg-red-500 shadow-red-500/30 shadow-sm', icon: <AlertCircle className="w-3 h-3" /> },
    disabled: { color: 'bg-zinc-700', icon: <Pause className="w-3 h-3 opacity-50" /> },
    pending: { color: 'bg-amber-500 shadow-amber-500/20 shadow-sm', icon: <Clock className="w-3 h-3" /> },
    processing: { color: 'bg-sky-500 shadow-sky-500/30 shadow-sm', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { color: 'bg-emerald-500 shadow-emerald-500/30 shadow-sm', icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { color: 'bg-red-500 shadow-red-500/30 shadow-sm', icon: <AlertCircle className="w-3 h-3" /> },
  };

  const variant = variants[status] || variants.idle;

  return (
    <Badge variant="secondary" className={`${variant.color} text-white gap-1 text-[10px] uppercase tracking-wider font-medium border-0`}>
      {variant.icon}
      <span>{status}</span>
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    info: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
    critical: 'bg-red-700/20 text-red-300 border-red-700/30',
  };

  return (
    <Badge variant="outline" className={`${colors[severity] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'} text-[10px] uppercase tracking-wider`}>
      {severity}
    </Badge>
  );
}

export function TaskTypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    message: <MessageSquare className="w-4 h-4 text-sky-400" />,
    heartbeat: <Heart className="w-4 h-4 text-rose-400" />,
    cron: <Calendar className="w-4 h-4 text-violet-400" />,
    webhook: <Webhook className="w-4 h-4 text-amber-400" />,
    hook: <Zap className="w-4 h-4 text-emerald-400" />,
    a2a: <Bot className="w-4 h-4 text-teal-400" />,
    subagent: <Bot className="w-4 h-4 text-indigo-400" />,
  };

  return <>{icons[type] || <Activity className="w-4 h-4 text-zinc-400" />}</>;
}
