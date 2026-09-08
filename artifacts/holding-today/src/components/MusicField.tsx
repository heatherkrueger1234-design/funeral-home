import { useRef, useState } from "react";
import {
  ACCEPTED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  uploadFile,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Music, X } from "lucide-react";

const MEGABYTE = 1024 * 1024;

/**
 * The song that plays under an album's slideshow.
 *
 * The file is uploaded like any other and is encrypted at rest with
 * everything else, so it is private in exactly the way a photograph is. It is
 * never played on this page — only inside the slideshow, when the person
 * presses play.
 */
export function MusicField({
  musicFilename,
  onChoose,
  onClear,
  isSaving,
}: {
  musicFilename: string | null | undefined;
  onChoose: (uploadId: number) => void;
  onClear: () => void;
  isSaving?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    if (file.size > MAX_AUDIO_BYTES) {
      toast({
        title: "That file is a little too large",
        description: `The limit is ${Math.round(MAX_AUDIO_BYTES / MEGABYTE)} MB and this one is ${(file.size / MEGABYTE).toFixed(1)} MB. An MP3 of the same track will usually fit.`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const uploaded = await uploadFile(file);
      onChoose(uploaded.id);
    } catch (error) {
      toast({
        title: "That didn't upload",
        description:
          error instanceof Error
            ? error.message
            : "Please check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="glass-panel rounded-xl p-4 flex flex-wrap items-center gap-3">
      <Music className="w-5 h-5 text-muted-foreground/60 shrink-0" />
      <div className="min-w-0 flex-1">
        {musicFilename ? (
          <>
            <p className="text-sm truncate">{musicFilename}</p>
            <p className="text-xs text-muted-foreground">
              Plays when the slideshow is playing.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">No music on this album</p>
            <p className="text-xs text-muted-foreground/70">
              MP3, M4A, WAV, OGG or FLAC. It stays private, like everything else here.
            </p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_AUDIO_TYPES.join(",")}
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUploading || isSaving}
          onClick={() => inputRef.current?.click()}
          className="border-white/15 bg-white/5 hover:bg-white/10"
        >
          {isUploading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          {musicFilename ? "Change" : "Choose a song"}
        </Button>
        {musicFilename && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            disabled={isSaving}
            aria-label="Remove the music from this album"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
