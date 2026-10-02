import { useRef, useState } from "react"
import { FileText, UploadCloud, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The server accepts exactly these two and rejects anything else, so the picker
// is narrowed to match rather than offering formats that would bounce.
const ACCEPTED = ".pdf,.docx"
const MAX_BYTES = 5 * 1024 * 1024

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ResumeUploader({ onSubmit, isSubmitting = false }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  function validate(candidate) {
    if (!candidate) return "Pick a file to analyse."

    const extension = candidate.name.split(".").pop()?.toLowerCase()
    if (extension !== "pdf" && extension !== "docx") {
      return "That format is not supported. Upload a PDF or a DOCX."
    }

    if (candidate.size > MAX_BYTES) {
      return "That file is over 5 MB. Trim it and try again."
    }

    return null
  }

  function accept(candidate) {
    const message = validate(candidate)
    setError(message)
    setFile(message ? null : candidate)
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    accept(event.dataTransfer.files?.[0])
  }

  function clear() {
    setFile(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className="grid gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "grid place-items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition-colors",
          isDragging ? "border-primary bg-secondary/60" : "border-border bg-card",
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <UploadCloud className="size-5" />
        </span>

        <div className="grid gap-1">
          <p className="text-lg">Drop your resume here</p>
          <p className="text-sm text-muted-foreground">
            PDF or DOCX &middot; up to 5 MB &middot; scanned PDFs are read with OCR
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          onChange={(event) => accept(event.target.files?.[0])}
        />

        <Button variant="outline" size="lg" onClick={() => inputRef.current?.click()}>
          Choose a file
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {file && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <FileText className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={clear}
            disabled={isSubmitting}
            aria-label="Remove file"
          >
            <X />
          </Button>
        </div>
      )}

      <Button
        size="lg"
        className="inset-button h-10 w-full px-4"
        disabled={!file || isSubmitting}
        onClick={() => onSubmit?.(file)}
      >
        {isSubmitting ? "Analysing…" : "Analyse resume"}
      </Button>
    </div>
  )
}

export default ResumeUploader
