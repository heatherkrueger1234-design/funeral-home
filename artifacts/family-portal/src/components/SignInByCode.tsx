import { useState } from "react";
import {
  ApiError,
  useRequestFamilySignIn,
  useVerifyFamilySignIn,
  type FamilySignInChoice,
} from "@workspace/api-client-react";
import { BASE_PATH } from "@/lib/base-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The way back in for someone whose link is gone.
 *
 * The text message is still how a family is first let in, and for most
 * people tapping it is all there is to do. But a message gets deleted, a
 * phone gets replaced, and an address typed into a laptop has no message to
 * tap. For those people this page used to say "ask the funeral home", which
 * on a Sunday night is a locked door.
 *
 * So: type the mobile number or email address the home has for you, get a
 * six-digit code there, type it back. What comes of that is a fresh link,
 * and it is opened through the address a tapped link opens through (as
 * `PasteLink` does), so the arrival is the same one.
 *
 * It says "if that is on file" and never "we sent it": the server answers
 * the same whoever is asked about, and this must not be the place that
 * gives the game away.
 */

type Step =
  | { name: "ask" }
  | { name: "code"; challenge: string; kind: "phone" | "email" }
  | { name: "choose"; challenge: string; choices: FamilySignInChoice[] };

function messageOf(error: unknown): string {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return error.message;
  }
  return "That did not go through. Please check your connection and try again.";
}

function openPage(token: string): void {
  window.location.assign(`${BASE_PATH}/f/${encodeURIComponent(token)}`);
}

export function SignInByCode() {
  const [step, setStep] = useState<Step>({ name: "ask" });
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const request = useRequestFamilySignIn();
  const verify = useVerifyFamilySignIn();
  const busy = request.isPending || verify.isPending;

  function ask(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    if (busy || identifier.trim().length === 0) return;
    setError(null);
    request.mutate(
      { data: { identifier: identifier.trim() } },
      {
        onSuccess: (sent) => {
          setCode("");
          setStep({ name: "code", challenge: sent.challenge, kind: sent.kind });
        },
        onError: (err) => setError(messageOf(err)),
      },
    );
  }

  function answer(
    challenge: string,
    body: { code?: string; contactId?: number },
  ) {
    if (busy) return;
    setError(null);
    verify.mutate(
      { data: { challenge, ...body } },
      {
        onSuccess: (result) => {
          if (result.token) {
            openPage(result.token);
          } else if (result.choices && result.choices.length > 0) {
            setStep({ name: "choose", challenge, choices: result.choices });
          } else {
            setError("That did not work. Please ask for a new code.");
          }
        },
        onError: (err) => setError(messageOf(err)),
      },
    );
  }

  if (step.name === "choose") {
    return (
      <div className="space-y-3">
        <p className="eyebrow">Which page is yours?</p>
        <p className="text-sm text-muted-foreground">
          That number or address is on more than one file.
        </p>
        <ul className="space-y-2">
          {step.choices.map((choice) => (
            <li key={choice.contactId}>
              <Button
                type="button"
                variant="outline"
                className="h-auto w-full justify-start whitespace-normal px-4 py-3 text-left"
                disabled={busy}
                onClick={() => answer(step.challenge, { contactId: choice.contactId })}
              >
                <span className="block">
                  <span className="block font-medium">{choice.subjectName}</span>
                  <span className="block text-sm font-normal text-muted-foreground">
                    {choice.homeName}
                    {choice.relationship ? ` · you are the ${choice.relationship.toLowerCase()}` : ""}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm font-medium text-[var(--notice)]">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (step.name === "code") {
    const where = step.kind === "email" ? "email address" : "mobile number";
    return (
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.replace(/\s/g, "").length === 6) answer(step.challenge, { code });
        }}
      >
        <Label htmlFor="sign-in-code">Your six-digit code</Label>
        <p className="text-sm text-muted-foreground">
          If that {where} is on file with your funeral home, a code is on its
          way. It works for ten minutes.
        </p>
        <div className="flex gap-2">
          <Input
            id="sign-in-code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError(null);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8}
            placeholder="123456"
            className="tabular tracking-widest"
            aria-invalid={error !== null}
            aria-describedby={error ? "sign-in-error" : undefined}
          />
          <Button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6}>
            Open
          </Button>
        </div>
        {error && (
          <p id="sign-in-error" role="alert" className="text-sm font-medium text-[var(--notice)]">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
          <button
            type="button"
            className="min-h-11 underline underline-offset-2 text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => ask()}
          >
            Send another code
          </button>
          <button
            type="button"
            className="min-h-11 underline underline-offset-2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setError(null);
              setStep({ name: "ask" });
            }}
          >
            Use a different number or address
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="space-y-2" onSubmit={ask}>
      <Label htmlFor="sign-in-identifier">Or get a code, if you have lost the link</Label>
      <p className="text-sm text-muted-foreground">
        Type the mobile number or email address your funeral home has for you,
        and we will send a code to it.
      </p>
      <div className="flex gap-2">
        <Input
          id="sign-in-identifier"
          value={identifier}
          onChange={(event) => {
            setIdentifier(event.target.value);
            setError(null);
          }}
          placeholder="Mobile number or email"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error ? "sign-in-error" : undefined}
        />
        <Button type="submit" disabled={busy || identifier.trim().length === 0}>
          Send code
        </Button>
      </div>
      {error && (
        <p id="sign-in-error" role="alert" className="text-sm font-medium text-[var(--notice)]">
          {error}
        </p>
      )}
    </form>
  );
}
