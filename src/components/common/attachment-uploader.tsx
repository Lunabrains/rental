"use client";

import { useActions } from "@/components/actions/action-provider";
import { useRef, useState } from "react";
import { Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { addDocument, type AddDocumentInput } from "@/lib/commands";
import { useStoreContext } from "@/lib/data/store-context";
import { cn } from "@/lib/utils";
import type { DocumentCategory, StoredDocument } from "@/types";

interface AttachmentUploaderProps {
  /** What the file belongs to — filled onto the document record. */
  links: AddDocumentInput["links"];
  category?: DocumentCategory;
  /** Restrict to images (before / after photos). */
  photos?: boolean;
  label?: string;
  onAdded?: (doc: StoredDocument) => void;
  /** Open the review screen right after the upload (plan §Phase 15). */
  review?: boolean;
  className?: string;
  compact?: boolean;
}

/**
 * Attaches files to any entity. Files never leave the browser in this demo:
 * an object URL is kept for preview and the record joins the document centre
 * with its links, category and audit trail.
 */
export function AttachmentUploader({ links, category = "other", photos, label, onAdded, review, className, compact }: AttachmentUploaderProps) {
  const { run } = useStoreContext();
  const { reviewDocument } = useActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    for (const file of list) {
      const dataUrl = URL.createObjectURL(file);
      const { result, undo } = run(
        addDocument({
          title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeKb: file.size / 1024,
          category: photos ? "photo" : category,
          dataUrl,
          links,
        }),
      );
      onAdded?.(result);
      if (review && list.length === 1 && !photos) reviewDocument(result.id);
      toast.success(`${photos ? "Photo" : "Document"} added — ${file.name}`, { action: undo ? { label: "Undo", onClick: undo } : undefined });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  const accept = photos ? "image/*" : ".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx,.txt";

  if (compact) {
    return (
      <>
        <input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <Button type="button" size="sm" variant="outline" className={className} onClick={() => inputRef.current?.click()}>
          {photos ? <Upload className="size-4" /> : <Paperclip className="size-4" />}
          {label ?? (photos ? "Add photos" : "Attach file")}
        </Button>
      </>
    );
  }

  return (
    <div
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
        dragging ? "border-brand bg-brand-muted/40" : "hover:bg-accent/40",
        className,
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept={accept} multiple className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">{photos ? <Upload className="size-4" /> : <Paperclip className="size-4" />}</span>
      <p className="mt-2 text-sm font-medium">{label ?? (photos ? "Add photos" : "Attach a file")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Drop here or click to browse{photos ? " · images" : " · PDF, images, spreadsheets"}</p>
    </div>
  );
}
