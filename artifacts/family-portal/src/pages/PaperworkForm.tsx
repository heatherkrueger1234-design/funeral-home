import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFamilyForm,
  useGetFamilySession,
  useSetFamilyFormAnswers,
  useAuthorizeFamilyForm,
  getGetFamilyFormQueryKey,
  getGetFamilyFormsQueryKey,
  renderFamilyForm,
  type CaseFormField,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Lock, Printer } from "lucide-react";

/**
 * One of the funeral home's forms, filled in on a phone.
 *
 * Built for stopping and coming back: every box saves when it loses focus,
 * nothing is required to save, and no box is ever emptied by leaving the
 * page. A form that will not let go of somebody until they have found their
 * mother's maiden name is a form they abandon at midnight.
 *
 * Two things on this screen are not ordinary form furniture.
 *
 * A box the case already knows the answer to arrives already filled, marked
 * as where it came from. The family's job is to correct rather than to type,
 * and being asked twice for a date of birth the home already has is the exact
 * thing that makes software feel like it is not listening.
 *
 * An authorization is signed rather than saved. It asks for a password and a
 * typed name, and what it records is a statement made at a moment by a named
 * person — so once it is signed the boxes stop moving, and the screen says so
 * rather than quietly refusing an edit later.
 */

/** `adult_children` is a statute's word for it, not a person's. */
function inPlainWords(tier: string): string {
  return tier.replace(/_/g, " ");
}

function Suggested({ field }: { field: CaseFormField }) {
  if (field.hasValue || !field.suggested) return null;

  return (
    <p className="text-sm text-muted-foreground">
      Filled in from what the funeral home already has. Please change it if it
      is not right.
    </p>
  );
}

export default function PaperworkForm() {
  const params = useParams<{ id: string }>();
  const caseFormId = Number(params.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useGetFamilyForm(caseFormId, {
    query: {
      queryKey: getGetFamilyFormQueryKey(caseFormId),
      enabled: Number.isInteger(caseFormId),
    },
  });
  const session = useGetFamilySession();

  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [signedName, setSignedName] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetFamilyFormQueryKey(caseFormId),
    });
    void queryClient.invalidateQueries({ queryKey: getGetFamilyFormsQueryKey() });
  };

  const save = useSetFamilyFormAnswers({
    mutation: {
      onSuccess: () => {
        setSavedAt(Date.now());
        refresh();
      },
    },
  });

  const sign = useAuthorizeFamilyForm({
    mutation: {
      onSuccess: () => {
        setPassword("");
        refresh();
        toast({
          title: "Signed",
          description:
            "The funeral home has it. You can print a copy from this page.",
        });
      },
    },
  });

  if (form.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!form.data) return null;

  const detail = form.data;
  const isAuthorization = detail.kind === "authorization";
  const signedAlready = detail.authorizations.length > 0;
  const frozen = signedAlready;
  const tier = session.data?.contact.dispositionTier ?? null;

  const put = (fieldKey: string, value: string) =>
    save.mutate({ caseFormId, data: { answers: [{ fieldKey, value }] } });

  /**
   * Print, or save, without an account and without us in the way.
   *
   * The sheet is rendered by the server and handed to the browser whole, so
   * what the family ends up holding is a file on their own phone rather than
   * a link back here. The window is opened before the fetch, because a popup
   * opened after an await is a popup a browser blocks.
   */
  const print = async () => {
    const sheet = window.open("", "_blank");

    try {
      const html = await renderFamilyForm(caseFormId);

      if (!sheet) {
        toast({
          title: "Your browser stopped the page opening",
          description:
            "Allow pop-ups for this site and try again, and it will open in a new tab.",
        });
        return;
      }

      sheet.document.write(html);
      sheet.document.close();
    } catch {
      sheet?.close();
      toast({
        title: "That didn't open",
        description: "Please check your connection and try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl mb-1">{detail.name}</h1>
        {detail.note && <p className="text-muted-foreground">{detail.note}</p>}
      </header>

      {frozen && (
        <p className="flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <Lock className="size-4 shrink-0 mt-0.5" />
          This was signed on{" "}
          {new Date(detail.authorizations[0].signedAt).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          , so it stays exactly as it was signed. If something needs changing,
          tell the funeral home and they will record it again.
        </p>
      )}

      {savedAt !== null && !frozen && (
        <p className="flex items-center gap-1.5 text-sm text-[var(--accent-deep)]">
          <Check className="size-4" />
          Saved
        </p>
      )}

      <div className="space-y-6">
        {detail.fields.length === 0 && (
          <p className="text-muted-foreground">
            There are no questions on this one. It is here so you can read it
            and keep a copy.
          </p>
        )}

        {detail.fields.map((field) => {
          const value = field.value ?? "";
          const starting = field.hasValue ? value : (field.suggested ?? "");

          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>{field.label}</Label>

              {field.help && (
                <p className="text-sm text-muted-foreground">{field.help}</p>
              )}

              {/*
                A note a director left against this box, in their words. Calm
                and in the flow of the form rather than red and shouting: the
                person reading it has already had a hard week.
              */}
              {field.note && (
                <p className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-2 text-sm">
                  {field.note}
                </p>
              )}

              {field.sensitive && (
                <p className="text-sm text-muted-foreground">
                  Stored encrypted. Once you save it, it cannot be read back on
                  this page — the funeral home sees only the last few
                  characters, so it cannot be read off a phone left on a table.
                  {field.hasValue && " We have this one already."}
                </p>
              )}

              {field.kind === "textarea" ? (
                <Textarea
                  id={field.key}
                  rows={4}
                  disabled={frozen}
                  defaultValue={starting}
                  onBlur={(event) => {
                    if (event.target.value.trim() === value.trim()) return;
                    put(field.key, event.target.value);
                  }}
                />
              ) : field.kind === "checkbox" ? (
                <label className="flex items-start gap-3 min-h-11">
                  <Checkbox
                    id={field.key}
                    className="mt-0.5"
                    disabled={frozen}
                    checked={value === "yes"}
                    onCheckedChange={(checked) =>
                      put(field.key, checked === true ? "yes" : "")
                    }
                  />
                  <span className="text-sm">Yes</span>
                </label>
              ) : field.kind === "select" ? (
                <Select
                  disabled={frozen}
                  value={value || undefined}
                  onValueChange={(next) => put(field.key, next)}
                >
                  <SelectTrigger id={field.key} className="h-11">
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={field.key}
                  type={
                    field.kind === "date"
                      ? "date"
                      : field.kind === "number"
                        ? "number"
                        : "text"
                  }
                  className="h-11"
                  disabled={frozen}
                  autoComplete={field.sensitive ? "off" : undefined}
                  defaultValue={field.sensitive ? "" : starting}
                  onBlur={(event) => {
                    if (event.target.value.trim() === value.trim()) return;
                    put(field.key, event.target.value);
                  }}
                />
              )}

              <Suggested field={field} />
            </div>
          );
        })}
      </div>

      {isAuthorization && !signedAlready && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="font-display text-lg">Signing this</h2>
          <p className="text-sm text-muted-foreground">
            This is the funeral home's own authorization, and signing it
            records that you authorized it{" "}
            {tier ? (
              <>
                as the funeral home has recorded you:{" "}
                <span className="font-medium">{inPlainWords(tier)}</span>.
              </>
            ) : (
              "under the standing the funeral home has recorded for you."
            )}{" "}
            It asks for your password because a text message can be forwarded,
            and this should need more than holding one.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="signed-name">Your full name</Label>
            <Input
              id="signed-name"
              className="h-11"
              value={signedName}
              onChange={(event) => setSignedName(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="signing-password">Your password</Label>
            <Input
              id="signing-password"
              type="password"
              className="h-11"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              The one you chose, or the one the funeral home gave you. They can
              send you another if you need it.
            </p>
          </div>

          <Button
            className="w-full h-11"
            disabled={
              sign.isPending || signedName.trim() === "" || password === ""
            }
            onClick={() =>
              sign.mutate({
                caseFormId,
                data: { password, signedName: signedName.trim() },
              })
            }
          >
            Sign this authorization
          </Button>
        </section>
      )}

      {signedAlready && (
        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="font-display text-lg">Who signed it</h2>
          {detail.authorizations.map((authorization) => (
            <div key={authorization.id} className="text-sm">
              <p className="font-medium">{authorization.signedName}</p>
              <p className="text-muted-foreground">
                {inPlainWords(authorization.claimedTier)} ·{" "}
                {new Date(authorization.signedAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              {authorization.consents.length > 1 && (
                <ul className="mt-1 text-muted-foreground">
                  {authorization.consents.map((consent) => (
                    <li key={consent.id}>
                      Also {consent.personName}
                      {consent.relationship ? `, ${consent.relationship}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          You can print this or save it to your own phone. It is yours, and it
          does not depend on this page still being here.
        </p>
        <Button variant="outline" className="w-full h-11" onClick={() => void print()}>
          <Printer className="size-4" />
          Print or save a copy
        </Button>
      </div>
    </div>
  );
}
