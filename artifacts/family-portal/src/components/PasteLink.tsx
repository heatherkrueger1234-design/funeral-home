import { useState } from "react";
import { tokenFromPasted } from "@/lib/paste-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Somewhere to put the link when tapping it is not an option.
 *
 * The link is meant to be tapped, and for most people it is. But an email
 * app that opens links in its own little browser, a link copied from a
 * laptop to a phone, or a director reading it out over the telephone all
 * leave someone holding a link with nowhere to put it — and a screen that
 * says "open your link" without a box to open it in reads as a locked door.
 *
 * It navigates to the link's own address rather than setting the token in
 * place, so it goes through exactly the arrival path a tapped link does
 * (see lib/link.tsx for why that ordering is load-bearing).
 */
export function PasteLink({ label = "Or paste your link here" }: { label?: string }) {
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const token = tokenFromPasted(value);
        if (!token) {
          setInvalid(true);
          return;
        }
        window.location.assign(`/f/${encodeURIComponent(token)}`);
      }}
    >
      <Label htmlFor="pasted-link">{label}</Label>
      <div className="flex gap-2">
        <Input
          id="pasted-link"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          placeholder="https://…/f/…"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          aria-invalid={invalid}
          aria-describedby={invalid ? "pasted-link-error" : undefined}
        />
        <Button type="submit" disabled={value.trim().length === 0}>
          Open
        </Button>
      </div>
      {invalid && (
        <p id="pasted-link-error" className="text-sm text-destructive">
          That does not look like one of the funeral home's links. It should
          have <span className="whitespace-nowrap">/f/</span> in it, followed
          by a long run of letters and numbers.
        </p>
      )}
    </form>
  );
}
