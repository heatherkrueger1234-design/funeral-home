import { useRef, useState } from "react";
import {
  ACCEPTED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  uploadFile,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ImagePlus, Loader2, X } from "lucide-react";

type ImageFieldProps = {
  label: string;
  /** The stored value: a path returned by an upload, or empty. */
  value: string;
  onChange: (value: string) => void;
  helpText?: string;
};

const MEGABYTE = 1024 * 1024;

/**
 * Choosing a photograph used to mean pasting a URL, which quietly required
 * uploading the picture to some other website first. For a wall of photographs
 * of a child who has died, asking a grieving parent to go and host them
 * somewhere public was the wrong thing to ask.
 */
export function ImageField({ label, value, onChange, helpText }: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      toast({
        title: "That photo is a little too large",
        description: `The limit is ${Math.round(MAX_UPLOAD_BYTES / MEGABYTE)} MB. This one is ${(file.size / MEGABYTE).toFixed(1)} MB.`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const uploaded = await uploadFile(file);
      onChange(uploaded.url);
    } catch (error) {
      toast({
        title: "Couldn't add that file",
        description:
          error instanceof Error
            ? error.message
            : "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      // Allow re-picking the same file after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {value ? (
        <div className="relative rounded-xl overflow-hidden border border-white/10 bg-background/50">
          <img
            src={value}
            alt=""
            className="w-full max-h-56 object-contain bg-secondary/40"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange("")}
            aria-label="Remove this photo"
            className="absolute top-2 right-2 h-8 w-8 bg-black/60 hover:bg-black/80 text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="w-full rounded-xl border border-dashed border-white/15 bg-background/40 px-4 py-8 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-60"
        >
          {isUploading ? (
            <Loader2 className="w-6 h-6 animate-spin text-primary/70" />
          ) : (
            <ImagePlus className="w-6 h-6 text-primary/60" />
          )}
          <span className="text-sm">
            {isUploading ? "Adding…" : "Choose a photo from this device"}
          </span>
          <span className="text-xs opacity-70">
            {helpText ?? "JPEG, PNG, GIF, WebP or PDF, up to 15 MB"}
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_UPLOAD_TYPES.join(",")}
        className="sr-only"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
