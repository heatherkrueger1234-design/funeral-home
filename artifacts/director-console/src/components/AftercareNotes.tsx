import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAftercareSettings,
  useUpdateAftercareSettings,
  getGetAftercareSettingsQueryKey,
  type AftercareMessage,
  type AftercareSettings,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

/**
 * The home's own wording for each aftercare note, and the extra touchpoints
 * it offers. Families still opt in to the extras one by one; turning one on
 * here only puts the question in front of them.
 */

const TOUCHPOINT_LABELS: Record<string, string> = {
  birthday: "Their birthday",
  holidays: "Before the first holidays (mid-December)",
  death_anniversary: "A year since the death",
};

type Touchpoint = AftercareSettings["touchpoints"][number];

export function AftercareNotes({ readOnly }: { readOnly: boolean }) {
  const queryClient = useQueryClient();
  const settings = useGetAftercareSettings();
  const [open, setOpen] = useState<string | null>(null);

  const update = useUpdateAftercareSettings({
    mutation: {
      onSuccess: (saved) => {
        queryClient.setQueryData(getGetAftercareSettingsQueryKey(), saved);
        toast({ title: "Saved" });
      },
      onError: (error: unknown) =>
        toast({
          title: "Not saved",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        }),
    },
  });

  if (!settings.data) return null;
  const { touchpoints, messages } = settings.data;
  const offered = new Set<string>(touchpoints);

  const toggle = (kind: Touchpoint, on: boolean) => {
    const next = (Object.keys(TOUCHPOINT_LABELS) as Touchpoint[]).filter((k) =>
      k === kind ? on : offered.has(k),
    );
    update.mutate({ data: { touchpoints: next } });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Offer families extra notes on the harder days</p>
        {(Object.keys(TOUCHPOINT_LABELS) as Touchpoint[]).map((kind) => (
          <label key={kind} className="flex items-center gap-3 text-sm">
            <Switch
              checked={offered.has(kind)}
              disabled={readOnly || update.isPending}
              onCheckedChange={(checked) => toggle(kind, checked)}
            />
            {TOUCHPOINT_LABELS[kind]}
          </label>
        ))}
        <p className="text-sm leading-snug text-muted-foreground">
          Off until you turn them on. Each family is asked separately and can
          say no to these while keeping the check-ins.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">What each note says</p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {messages
            .filter((m) => /^\d+$/.test(m.key) || offered.has(m.key))
            .map((message) => (
              <li key={message.key} className="px-3 py-2.5">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-left text-sm"
                  onClick={() => setOpen(open === message.key ? null : message.key)}
                  aria-expanded={open === message.key}
                >
                  <span className="font-medium">{message.label}</span>
                  <span className="truncate text-muted-foreground">
                    {message.custom ? "Your wording" : "Our wording"} · {message.subject}
                  </span>
                </button>
                {open === message.key && (
                  <MessageEditor
                    message={message}
                    readOnly={readOnly}
                    pending={update.isPending}
                    onSave={(subject, body) =>
                      update.mutate({ data: { messages: [{ key: message.key, subject, body }] } })
                    }
                  />
                )}
              </li>
            ))}
        </ul>
        <p className="text-sm leading-snug text-muted-foreground">
          Write <code>{"{name}"}</code> where their name should go. A text, if
          the family asked for one, carries the first paragraph.
        </p>
      </div>
    </div>
  );
}

function MessageEditor({
  message,
  readOnly,
  pending,
  onSave,
}: {
  message: AftercareMessage;
  readOnly: boolean;
  pending: boolean;
  onSave: (subject: string | null, body: string | null) => void;
}) {
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const id = `aftercare-${message.key}`;

  return (
    <div className="mt-3 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-subject`}>Subject</Label>
        <Input
          id={`${id}-subject`}
          value={subject}
          maxLength={120}
          disabled={readOnly}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-body`}>Message</Label>
        <Textarea
          id={`${id}-body`}
          rows={7}
          value={body}
          maxLength={2000}
          disabled={readOnly}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending || !subject.trim() || !body.trim()}
            onClick={() => onSave(subject, body)}
          >
            Save
          </Button>
          {message.custom && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setSubject(message.defaultSubject);
                setBody(message.defaultBody);
                onSave(null, null);
              }}
            >
              Go back to our wording
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
