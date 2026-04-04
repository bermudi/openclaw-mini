'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { FileText, Save, Plus, X, Check, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { runtimeJson } from '@/lib/dashboard-runtime-client';

interface WorkspaceFile {
  name: string;
  size: number;
}

const FILE_NAME_REGEX = /^[A-Za-z0-9_-]+\.md$/;

export function WorkspaceEditor() {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchFiles = useCallback(async () => {
    try {
      const data = await runtimeJson<{ success: boolean; data?: WorkspaceFile[] }>('/api/workspace');
      if (data.success) {
        setFiles([...(data.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch (err) {
      console.error('Failed to fetch workspace files:', err);
    }
  }, []);

  const fetchFileContent = useCallback(async (fileName: string) => {
    setLoading(true);
    try {
      const data = await runtimeJson<{
        success: boolean;
        data?: { content: string };
        error?: string;
      }>(`/api/workspace?file=${encodeURIComponent(fileName)}`);

      if (data.success) {
        const nextContent = data.data?.content ?? '';
        setContent(nextContent);
        setOriginalContent(nextContent);
        setSelectedFile(fileName);
      } else {
        toast({ title: 'Error', description: data.error || 'Failed to load file', variant: 'destructive' });
        fetchFiles();
      }
    } catch (err) {
      console.error('Failed to fetch file content:', err);
      toast({ title: 'Error', description: 'Failed to load file', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, fetchFiles]);

  const handleSave = useCallback(async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      const data = await runtimeJson<{ success: boolean; error?: string }>('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: selectedFile, content }),
      });

      if (data.success) {
        setOriginalContent(content);
        toast({ title: 'Saved', description: `${selectedFile} updated successfully` });
        fetchFiles();
      } else {
        toast({ title: 'Save failed', description: data.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (err) {
      console.error('Failed to save file:', err);
      toast({ title: 'Save failed', description: 'Network error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [selectedFile, content, toast, fetchFiles]);

  const handleCreateFile = useCallback(async () => {
    let name = newFileName.trim();
    if (!name) return;

    if (!name.endsWith('.md')) name += '.md';

    if (!FILE_NAME_REGEX.test(name)) {
      setFileError('Filename must match [A-Za-z0-9_-]+.md');
      return;
    }

    setSaving(true);
    try {
      const data = await runtimeJson<{ success: boolean; error?: string }>('/api/workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: name, content: `# ${name.replace('.md', '')}\n` }),
      });

      if (data.success) {
        setCreating(false);
        setNewFileName('');
        setFileError(null);
        toast({ title: 'Created', description: `${name} created` });
        await fetchFiles();
        fetchFileContent(name);
      } else {
        toast({ title: 'Failed', description: data.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (err) {
      console.error('Failed to create file:', err);
      toast({ title: 'Failed', description: 'Network error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [newFileName, toast, fetchFiles, fetchFileContent]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const hasChanges = content !== originalContent;

  return (
    <div className="grid grid-cols-4 gap-4 h-[650px]">
      {/* File List */}
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <div className="p-3 border-b border-border/30 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400">Files</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-emerald-500/10 hover:text-emerald-400"
            onClick={() => { setCreating(true); setFileError(null); }}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
        <ScrollArea className="h-[calc(100%-45px)]">
          <AnimatePresence>
            {creating && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="p-2 border-b border-border/30"
              >
                <div className="flex gap-1">
                  <Input
                    value={newFileName}
                    onChange={(e) => { setNewFileName(e.target.value); setFileError(null); }}
                    placeholder="filename.md"
                    className="h-7 text-xs bg-background/50 border-border/50"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 hover:text-emerald-400" onClick={handleCreateFile}>
                    <Check className="w-3 h-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 hover:text-red-400" onClick={() => { setCreating(false); setNewFileName(''); setFileError(null); }}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
                {fileError && (
                  <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {fileError}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {files.length === 0 ? (
            <div className="p-4 text-center text-zinc-500 text-sm">No workspace files</div>
          ) : (
            <div className="divide-y divide-border/30">
              {files.map((file) => (
                <motion.div
                  key={file.name}
                  className={`p-3 cursor-pointer transition-colors hover:bg-white/[0.02] ${
                    selectedFile === file.name ? 'bg-emerald-500/5 border-l-2 border-l-emerald-500' : ''
                  }`}
                  onClick={() => fetchFileContent(file.name)}
                  whileHover={{ x: 2 }}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="text-sm font-mono truncate">{file.name}</span>
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-0.5 pl-5.5">
                    {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                  </p>
                </motion.div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>

      {/* Editor */}
      <Card className="col-span-3 bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden flex flex-col">
        <div className="p-3 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-zinc-400">
              {selectedFile || 'Select a file'}
            </h3>
            {hasChanges && (
              <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                unsaved
              </Badge>
            )}
          </div>
          {selectedFile && (
            <Button
              size="sm"
              disabled={!hasChanges || saving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-30"
              onClick={handleSave}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
        <div className="flex-1 p-3">
          {loading ? (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading...</div>
          ) : !selectedFile ? (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
              <div className="text-center">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>Click a file to view and edit</p>
              </div>
            </div>
          ) : (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-full min-h-[550px] resize-none bg-zinc-900/50 border-border/30 font-mono text-sm leading-relaxed focus-visible:ring-emerald-500/30"
              placeholder="File content..."
            />
          )}
        </div>
      </Card>
    </div>
  );
}
