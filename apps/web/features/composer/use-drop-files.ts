'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

export function useDropFiles(maxFiles = 8, maxBytes = 10 * 1024 * 1024) {
  const idCounter = useRef(0);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      for (const f of files) {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revokeFile = useCallback((p: PendingFile) => {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      setRejected(null);
      const array = Array.from(incoming);
      const allowed = array.filter((f) => {
        if (f.size > maxBytes) {
          setRejected(
            `"${f.name}" 超过 ${Math.round(maxBytes / 1048576)}MB 限制`,
          );
          return false;
        }
        return true;
      });
      setFiles((prev) => {
        const remaining = maxFiles - prev.length;
        if (remaining <= 0) return prev;
        const toAdd = allowed.slice(0, remaining);
        if (allowed.length > remaining) {
          setRejected(`最多添加 ${maxFiles} 个文件`);
        }
        const added: PendingFile[] = toAdd.map((file) => {
          idCounter.current += 1;
          const isImage = file.type.startsWith('image/');
          return {
            id: `pending-${idCounter.current}`,
            file,
            previewUrl: isImage ? URL.createObjectURL(file) : null,
          };
        });
        return [...prev, ...added];
      });
    },
    [maxFiles, maxBytes],
  );

  const removeFile = useCallback(
    (id: string) => {
      setFiles((prev) => {
        const target = prev.find((f) => f.id === id);
        if (target) revokeFile(target);
        return prev.filter((f) => f.id !== id);
      });
    },
    [revokeFile],
  );

  const clearFiles = useCallback(() => {
    setFiles((prev) => {
      for (const f of prev) revokeFile(f);
      return [];
    });
    setRejected(null);
  }, [revokeFile]);

  return { files, rejected, addFiles, removeFile, clearFiles };
}
