import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCaseForms,
  useGetCaseForm,
  useGetHomeForms,
  useAssignCaseForm,
  useUpdateCaseForm,
  useSetCaseFormAnswers,
  useFlagCaseFormField,
  useGetDeathCertificateRecord,
  useUpdateDeathCertificateRecord,
  useGetCaseAuthorizations,
  useVerifyCaseAuthorization,
  useAddAuthorizationConsent,
  getGetCaseFormsQueryKey,
  getGetCaseFormQueryKey,
  getGetCaseAuthorizationsQueryKey,
  getGetDeathCertificateRecordQueryKey,
  getRenderCaseFormUrl,
  type CaseAuthorization,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Printer } from "lucide-react";

/**
 * The paperwork on one case, and the clock it is all on.
 *
 * The panel leads with the 72 hours because that is the director's actual
 * question — not "what has the family answered" but "can this be filed by
 * Thursday, and if not, who do I ring". Everything below it is ordered by
 * the same logic: what the certificate needs first.
 *
 * The one thing this screen must never do is imply we file anything. We do
 * not integrate with EDRS and never will; the sentence saying so is returned
 * by the API rather than written here, so that it cannot drift between this
 * console, the portal and the print sheet.
 */

/** A `datetime-local` value from a Date, in the reader's own timezone. */
function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * How long is left, in words.
 *
 * Words rather than a red number, and the same restraint the family portal
 * uses. A director who is late knows they are late; what they need from this
 * line is how late, stated once, calmly enough to read past.
 */
function timeLeft(hours: number | null): string {
  if (hours === null) return "";
  if (hours < 0) {
    const over = Math.abs(Math.round(hours));
    return over < 24
      ? `Past due by about ${over} ${over === 1 ? "hour" : "hours"}.`
      : `Past due by about ${Math.round(over / 24)} days.`;
  }
  const left = Math.round(hours);
  return left < 24
    ? `About ${left} ${left === 1 ? "hour" : "hours"} left.`
    : `About ${Math.round(left / 24)} days left.`;
}

/** `adult_children` is a statute's word for it, not a director's. */
const inPlainWords = (tier: string) => tier.replace(/_/g, " ");

function CertificateClock({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const record = useGetDeathCertificateRecord(caseId);

  const save = useUpdateDeathCertificateRecord({
    mutation: {
      onSuccess: () =>
        void queryClient.invalidateQueries({
          queryKey: getGetDeathCertificateRecordQueryKey(caseId),
        }),
    },
  });

  if (record.isPending || !record.data) return null;

  const data = record.data;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="font-medium">The death certificate</h3>
        <p className="text-sm text-muted-foreground">{data.filingNotice}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="custody">When you took custody</Label>
          <Input
            id="custody"
            type="datetime-local"
            defaultValue={toLocalInput(data.custodyTakenAt)}
            onBlur={(event) =>
              save.mutate({
                caseId,
                data: {
                  custodyTakenAt:
                    event.target.value === ""
                      ? null
                      : new Date(event.target.value).toISOString(),
                },
              })
            }
          />
          <p className="text-sm text-muted-foreground">
            The 72 hours run from here, not from the death.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edrs">When you requested certification</Label>
          <Input
            id="edrs"
            type="datetime-local"
            defaultValue={toLocalInput(data.edrsRequestedAt)}
            onBlur={(event) =>
              save.mutate({
                caseId,
                data: {
                  edrsRequestedAt:
                    event.target.value === ""
                      ? null
                      : new Date(event.target.value).toISOString(),
                },
              })
            }
          />
          <p className="text-sm text-muted-foreground">
            The certifying physician has 72 hours of their own from this.
          </p>
        </div>
      </div>

      {data.dueAt && (
        <p className="text-sm">
          <span className="font-medium">Due {formatWhen(data.dueAt)}.</span>{" "}
          {timeLeft(data.hoursRemaining)}
        </p>
      )}

      {data.certificationDueAt && (
        <p className="text-sm text-muted-foreground">
          Certification due {formatWhen(data.certificationDueAt)}
          {data.certifyingProvider ? ` · ${data.certifyingProvider}` : ""}.
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="provider">Who is certifying it</Label>
        <Input
          id="provider"
          defaultValue={data.certifyingProvider ?? ""}
          onBlur={(event) =>
            save.mutate({
              caseId,
              data: { certifyingProvider: event.target.value || null },
            })
          }
        />
      </div>

      {data.outstanding.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Still with the family</p>
          <p className="text-sm text-muted-foreground mb-2">
            Nobody here can answer these, which is why they hold the
            certificate up.
          </p>
          <ul className="space-y-1 text-sm">
            {data.outstanding.map((entry) => (
              <li key={entry.caseFormId}>
                <span className="text-muted-foreground">{entry.formName}: </span>
                {entry.fields.map((field) => field.label).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={data.filedAt !== null}
            onCheckedChange={(checked) =>
              save.mutate({ caseId, data: { filed: checked } })
            }
          />
          I have filed it
        </label>

        <Input
          className="w-56"
          aria-label="State file number"
          placeholder="State file number"
          defaultValue={data.stateFileNumber ?? ""}
          onBlur={(event) =>
            save.mutate({
              caseId,
              data: { stateFileNumber: event.target.value || null },
            })
          }
        />

        {data.filedAt && (
          <p className="text-sm text-muted-foreground">
            Filed {formatWhen(data.filedAt)}
            {data.filedByName ? ` by ${data.filedByName}` : ""}.
          </p>
        )}
      </div>
    </section>
  );
}

function AuthorizationCard({
  caseId,
  authorization,
}: {
  caseId: number;
  authorization: CaseAuthorization;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [person, setPerson] = useState("");
  const [channel, setChannel] = useState("telephone");

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetCaseAuthorizationsQueryKey(caseId),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetCaseFormQueryKey(caseId, authorization.caseFormId),
    });
  };

  const verify = useVerifyCaseAuthorization({
    mutation: { onSuccess: () => { setNote(""); refresh(); } },
  });
  const addConsent = useAddAuthorizationConsent({
    mutation: { onSuccess: () => { setPerson(""); refresh(); } },
  });

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div>
        <p className="font-medium">{authorization.signedName}</p>
        <p className="text-sm text-muted-foreground">
          Claimed as {inPlainWords(authorization.claimedTier)} ·{" "}
          {formatWhen(authorization.signedAt)}
          {authorization.recordedByName
            ? ` · recorded by ${authorization.recordedByName}`
            : ""}
        </p>
      </div>

      {authorization.requiresMajority && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">
            This tier needs a majority
            {authorization.tierMemberCount !== null
              ? ` of ${authorization.tierMemberCount}`
              : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            {authorization.majorityRecorded === null
              ? "Record how many people are in that tier, and each one who consents, and this will say where you have got to."
              : authorization.majorityRecorded
                ? `${authorization.consentCount} recorded — a majority.`
                : `${authorization.consentCount} recorded so far. Not yet a majority.`}
          </p>

          <ul className="mt-2 space-y-1 text-sm">
            {authorization.consents.map((consent) => (
              <li key={consent.id}>
                {consent.personName}
                {consent.relationship ? `, ${consent.relationship}` : ""}
                <span className="text-muted-foreground">
                  {" "}
                  · {formatWhen(consent.consentedAt)} ·{" "}
                  {consent.channel.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              className="flex-1 min-w-48"
              aria-label="Who else consented"
              placeholder="Who else consented"
              value={person}
              onChange={(event) => setPerson(event.target.value)}
            />
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-40" aria-label="How they told you">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_person">In person</SelectItem>
                <SelectItem value="telephone">By telephone</SelectItem>
                <SelectItem value="email">By email</SelectItem>
                <SelectItem value="paper">On paper</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={addConsent.isPending || person.trim() === ""}
              onClick={() =>
                addConsent.mutate({
                  caseId,
                  authorizationId: authorization.id,
                  data: {
                    personName: person.trim(),
                    channel: channel as "telephone",
                  },
                })
              }
            >
              Record it
            </Button>
          </div>
        </div>
      )}

      {authorization.verifiedAt ? (
        <p className="text-sm text-muted-foreground">
          Verified by {authorization.verifiedByName} on{" "}
          {formatWhen(authorization.verifiedAt)}
          {authorization.verificationNote
            ? ` — ${authorization.verificationNote}`
            : ""}
        </p>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`verify-${authorization.id}`}>
            What you saw that supports this claim
          </Label>
          <Textarea
            id={`verify-${authorization.id}`}
            rows={2}
            placeholder="A marriage certificate, a court order, a driving licence…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Recorded once and never changed. If what you see later changes
            things, record a new authorization rather than editing this.
          </p>
          <Button
            size="sm"
            disabled={verify.isPending || note.trim() === ""}
            onClick={() =>
              verify.mutate({
                caseId,
                authorizationId: authorization.id,
                data: { verificationNote: note.trim() },
              })
            }
          >
            Verify it
          </Button>
        </div>
      )}
    </div>
  );
}

function CaseFormDetail({ caseId, caseFormId }: { caseId: number; caseFormId: number }) {
  const queryClient = useQueryClient();
  const detail = useGetCaseForm(caseId, caseFormId);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getGetCaseFormQueryKey(caseId, caseFormId),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetCaseFormsQueryKey(caseId),
    });
    void queryClient.invalidateQueries({
      queryKey: getGetDeathCertificateRecordQueryKey(caseId),
    });
  };

  const save = useSetCaseFormAnswers({ mutation: { onSuccess: refresh } });
  const flag = useFlagCaseFormField({
    mutation: {
      onSuccess: () => {
        setFlagging(null);
        setNote("");
        refresh();
      },
    },
  });

  if (detail.isPending) {
    return (
      <p className="py-4 text-center">
        <Loader2 className="size-4 animate-spin mx-auto text-muted-foreground" />
      </p>
    );
  }

  if (!detail.data) return null;

  const form = detail.data;
  const signed = form.authorizations.length > 0;

  return (
    <div className="space-y-4 border-t border-border pt-3">
      {signed && (
        <p className="text-sm text-muted-foreground">
          Signed, so the answers stay as they were signed. A change is a new
          authorization.
        </p>
      )}

      {form.fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`${caseFormId}-${field.key}`}>
            {field.label}
            {field.onlyFamilyKnows && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                only the family knows this
              </span>
            )}
          </Label>

          {field.sensitive ? (
            <p className="text-sm text-muted-foreground">
              {field.hasValue
                ? `Held encrypted, ending ${field.masked}.`
                : "Stored encrypted when it is answered."}
            </p>
          ) : (
            <Input
              id={`${caseFormId}-${field.key}`}
              disabled={signed}
              defaultValue={field.value ?? field.suggested ?? ""}
              onBlur={(event) => {
                if (event.target.value.trim() === (field.value ?? "").trim()) return;
                save.mutate({
                  caseId,
                  caseFormId,
                  data: {
                    answers: [{ fieldKey: field.key, value: event.target.value }],
                  },
                });
              }}
            />
          )}

          {!field.hasValue && field.suggested && (
            <p className="text-sm text-muted-foreground">
              Suggested from the case. It counts as answered once somebody
              confirms it.
            </p>
          )}

          {field.source === "self" && (
            <p className="text-sm text-muted-foreground">
              Answered by them, in advance, on{" "}
              {formatWhen(field.answeredAt)}.
            </p>
          )}

          {field.note ? (
            <p className="text-sm text-muted-foreground">
              Sent back to the family: “{field.note}”
            </p>
          ) : flagging === field.key ? (
            <div className="flex flex-wrap gap-2">
              <Input
                className="flex-1 min-w-48"
                aria-label="What to tell the family about this box"
                placeholder="What the family needs to know about this one"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button
                size="sm"
                disabled={flag.isPending || note.trim() === ""}
                onClick={() =>
                  flag.mutate({
                    caseId,
                    caseFormId,
                    data: { fieldKey: field.key, note: note.trim() },
                  })
                }
              >
                Send it back
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFlagging(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            !signed && (
              <button
                type="button"
                className="text-sm text-muted-foreground underline"
                onClick={() => {
                  setFlagging(field.key);
                  setNote("");
                }}
              >
                Ask the family about this box
              </button>
            )
          )}
        </div>
      ))}

      {form.authorizations.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium">Authorizations</h4>
          {form.authorizations.map((authorization) => (
            <AuthorizationCard
              key={authorization.id}
              caseId={caseId}
              authorization={authorization}
            />
          ))}
        </div>
      )}

      <a
        className="inline-flex items-center gap-2 text-sm underline"
        href={getRenderCaseFormUrl(caseId, caseFormId)}
        target="_blank"
        rel="noreferrer"
      >
        <Printer className="size-4" />
        Print this, or save a copy
      </a>
    </div>
  );
}

export function FormsPanel({ caseId }: { caseId: number }) {
  const queryClient = useQueryClient();
  const forms = useGetCaseForms(caseId);
  const library = useGetHomeForms();
  const authorizations = useGetCaseAuthorizations(caseId);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState("");

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetCaseFormsQueryKey(caseId),
    });

  const assign = useAssignCaseForm({
    mutation: {
      onSuccess: (created) => {
        setAdding("");
        setOpen(created.id);
        refresh();
      },
    },
  });
  const update = useUpdateCaseForm({ mutation: { onSuccess: refresh } });

  if (forms.isPending) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  const rows = forms.data ?? [];
  const onCase = new Set(rows.map((row) => row.formId));
  const available = (library.data ?? []).filter((form) => !onCase.has(form.id));

  return (
    <div className="space-y-6">
      <CertificateClock caseId={caseId} />

      <section className="space-y-3">
        <h3 className="font-medium">Forms on this case</h3>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on this case yet. Add one from your library below — or add
            it to the library once, on every new case, in Settings.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((form) => (
              <li key={form.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{form.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {form.kind === "authorization"
                        ? form.authorizationCount > 0
                          ? "Signed"
                          : "Waiting to be signed by the authorizing contact"
                        : form.complete || form.requiredCount === 0
                          ? "Nothing outstanding"
                          : `${form.requiredCount - form.answeredCount} of ${form.requiredCount} still to answer`}
                      {form.blocksCertificate ? " · feeds the certificate" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={form.sharedWithFamily}
                        onCheckedChange={(checked) =>
                          update.mutate({
                            caseId,
                            caseFormId: form.id,
                            data: { sharedWithFamily: checked },
                          })
                        }
                      />
                      Shared
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setOpen(open === form.id ? null : form.id)}
                    >
                      {open === form.id ? "Close" : "Open"}
                    </Button>
                  </div>
                </div>

                {open === form.id && (
                  <CaseFormDetail caseId={caseId} caseFormId={form.id} />
                )}
              </li>
            ))}
          </ul>
        )}

        {available.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger className="w-72" aria-label="A form from your library">
                <SelectValue placeholder="A form from your library" />
              </SelectTrigger>
              <SelectContent>
                {available.map((form) => (
                  <SelectItem key={form.id} value={String(form.id)}>
                    {form.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={assign.isPending || adding === ""}
              onClick={() =>
                assign.mutate({ caseId, data: { formId: Number(adding) } })
              }
            >
              <Plus className="size-4" />
              Put it on this case
            </Button>
          </div>
        )}
      </section>

      {(authorizations.data ?? []).length > 0 && (
        <section className="space-y-3">
          <h3 className="font-medium">Everything authorized on this case</h3>
          <p className="text-sm text-muted-foreground">
            Append-only. Nothing here is edited after it is written.
          </p>
          {(authorizations.data ?? []).map((authorization) => (
            <AuthorizationCard
              key={authorization.id}
              caseId={caseId}
              authorization={authorization}
            />
          ))}
        </section>
      )}
    </div>
  );
}
