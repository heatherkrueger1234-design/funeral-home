import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetHomeForms,
  useCreateHomeForm,
  useUpdateHomeForm,
  useGetHomeForm,
  useSetHomeFormFields,
  getGetHomeFormsQueryKey,
  getGetHomeFormQueryKey,
  type HomeFormFieldInput,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, X } from "lucide-react";

/**
 * The home's own forms.
 *
 * Empty to start with, and that is the whole product decision. We ship no
 * cremation authorization, no disposition authorization, no vital statistics
 * worksheet — not because it would be hard, but because a national vendor
 * shipping its own authorization form hands every home it sells to a
 * liability and hands every family a document nobody's counsel has read.
 *
 * So this is where a home puts the forms it already has, once, with the boxes
 * it already asks for. What the software then does is fill them in from what
 * the case knows, route them to the right person, and refuse them to the
 * wrong one.
 */

const KINDS = [
  { value: "text", label: "One line" },
  { value: "textarea", label: "A paragraph" },
  { value: "date", label: "A date" },
  { value: "number", label: "A number" },
  { value: "select", label: "Choose one" },
  { value: "checkbox", label: "Yes or no" },
  { value: "signature", label: "A signature" },
];

/**
 * Where a box's answer can come from, in a director's words rather than the
 * API's. Anything not on this list gets an empty box, which is honest.
 */
const PREFILL = [
  { value: "", label: "Ask for it" },
  { value: "decedent.fullName", label: "Their name" },
  { value: "decedent.firstName", label: "Their first name" },
  { value: "decedent.lastName", label: "Their last name" },
  { value: "decedent.dateOfBirth", label: "Date of birth" },
  { value: "decedent.dateOfDeath", label: "Date of death" },
  { value: "vitals.nameAtBirth", label: "Name at birth" },
  { value: "vitals.birthCity", label: "Town of birth" },
  { value: "vitals.birthState", label: "State of birth" },
  { value: "vitals.motherMaidenName", label: "Mother's maiden name" },
  { value: "vitals.fatherLastName", label: "Father's last name" },
  { value: "vitals.residenceLine1", label: "Their address" },
  { value: "vitals.residenceCity", label: "Their town" },
  { value: "vitals.residenceState", label: "Their state" },
  { value: "vitals.informantName", label: "Informant's name" },
  { value: "vitals.informantPhone", label: "Informant's phone" },
  { value: "contact.name", label: "The person filling it in" },
  { value: "home.name", label: "This funeral home" },
];

type Draft = HomeFormFieldInput & { options?: string[] };

function FormBoxes({ formId, readOnly }: { formId: number; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const form = useGetHomeForm(formId);
  const [draft, setDraft] = useState<Draft[] | null>(null);

  const save = useSetHomeFormFields({
    mutation: {
      onSuccess: () => {
        setDraft(null);
        void queryClient.invalidateQueries({
          queryKey: getGetHomeFormQueryKey(formId),
        });
        void queryClient.invalidateQueries({ queryKey: getGetHomeFormsQueryKey() });
      },
    },
  });

  if (form.isPending) {
    return (
      <p className="py-4 text-center">
        <Loader2 className="size-4 animate-spin mx-auto text-muted-foreground" />
      </p>
    );
  }

  if (!form.data) return null;

  const boxes: Draft[] =
    draft ??
    form.data.fields.map((field) => ({
      key: field.key,
      label: field.label,
      kind: field.kind,
      options: field.options,
      help: field.help,
      required: field.required,
      onlyFamilyKnows: field.onlyFamilyKnows,
      prefillFrom: field.prefillFrom,
      sensitive: field.sensitive,
    }));

  const edit = (index: number, patch: Partial<Draft>) =>
    setDraft(boxes.map((box, i) => (i === index ? { ...box, ...patch } : box)));

  return (
    <div className="space-y-3 border-t border-border pt-3">
      {boxes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No boxes on this one yet. Add the questions the form actually asks,
          in the order it asks them.
        </p>
      )}

      {boxes.map((box, index) => (
        <div key={index} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex gap-2">
            <Input
              className="flex-1"
              aria-label="What the box is called on the form"
              placeholder="Label, as the form words it"
              value={box.label}
              disabled={readOnly}
              onChange={(event) => edit(index, { label: event.target.value })}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${box.label || "this box"}`}
              disabled={readOnly}
              onClick={() => setDraft(boxes.filter((_, i) => i !== index))}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              value={box.kind ?? "text"}
              disabled={readOnly}
              onValueChange={(value) =>
                edit(index, { kind: value as Draft["kind"] })
              }
            >
              <SelectTrigger aria-label="What kind of answer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((kind) => (
                  <SelectItem key={kind.value} value={kind.value}>
                    {kind.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={box.prefillFrom ?? ""}
              disabled={readOnly}
              onValueChange={(value) =>
                edit(index, { prefillFrom: value === "" ? null : value })
              }
            >
              <SelectTrigger aria-label="Fill it in from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREFILL.map((source) => (
                  <SelectItem key={source.value || "ask"} value={source.value}>
                    {source.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              aria-label="A short name for this box"
              placeholder="Short name, e.g. mother_maiden"
              value={box.key}
              disabled={readOnly}
              onChange={(event) =>
                edit(index, { key: event.target.value.replace(/[^\w.-]/g, "_") })
              }
            />
          </div>

          {box.kind === "select" && (
            <Input
              aria-label="The choices, separated by commas"
              placeholder="The choices, separated by commas"
              value={(box.options ?? []).join(", ")}
              disabled={readOnly}
              onChange={(event) =>
                edit(index, {
                  options: event.target.value
                    .split(",")
                    .map((option) => option.trim())
                    .filter(Boolean),
                })
              }
            />
          )}

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Switch
                checked={box.required ?? false}
                disabled={readOnly}
                onCheckedChange={(checked) => edit(index, { required: checked })}
              />
              Needed before it is finished
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={box.onlyFamilyKnows ?? false}
                disabled={readOnly}
                onCheckedChange={(checked) =>
                  edit(index, { onlyFamilyKnows: checked })
                }
              />
              Only the family knows it
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={box.sensitive ?? false}
                disabled={readOnly}
                onCheckedChange={(checked) => edit(index, { sensitive: checked })}
              />
              Sensitive — store it encrypted
            </label>
          </div>
        </div>
      ))}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft([
                ...boxes,
                { key: `box_${boxes.length + 1}`, label: "", kind: "text" },
              ])
            }
          >
            <Plus className="size-4" />
            Add a box
          </Button>

          {draft !== null && (
            <>
              <Button
                size="sm"
                disabled={save.isPending || draft.some((box) => box.label.trim() === "")}
                onClick={() =>
                  save.mutate({
                    formId,
                    data: {
                      fields: draft.map((box) => ({
                        ...box,
                        label: box.label.trim(),
                        key: box.key.trim(),
                      })),
                    },
                  })
                }
              >
                Save the boxes
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                Discard
              </Button>
            </>
          )}
        </div>
      )}

      {draft !== null && draft.some((box) => box.label.trim() === "") && (
        <p className="text-sm text-muted-foreground">
          Every box needs a label — the words the form itself uses.
        </p>
      )}
    </div>
  );
}

export function FormLibrary({ readOnly }: { readOnly: boolean }) {
  const queryClient = useQueryClient();
  const forms = useGetHomeForms();

  const [name, setName] = useState("");
  const [kind, setKind] = useState("form");
  const [open, setOpen] = useState<number | null>(null);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: getGetHomeFormsQueryKey() });

  const add = useCreateHomeForm({
    mutation: {
      onSuccess: (created) => {
        setName("");
        setOpen(created.id);
        refresh();
      },
    },
  });

  const update = useUpdateHomeForm({ mutation: { onSuccess: refresh } });

  const rows = forms.data ?? [];

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="font-medium">Your forms</h2>
        <p className="text-sm text-muted-foreground">
          Your own paperwork, with your own wording — we supply none of it, and
          we never will. Put a form here once, mark up the boxes it asks for,
          and every family gets it already filled in from what the case knows.
        </p>
      </div>

      {forms.isPending ? (
        <p className="py-4 text-center">
          <Loader2 className="size-4 animate-spin mx-auto text-muted-foreground" />
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Start with the one you hand across the desk most
          often — usually the vital statistics worksheet.
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
                      ? "An authorization · only the authorizing contact may sign it"
                      : `Filled in by whoever is ${form.requiredLevel}`}
                    {form.blocksCertificate ? " · needed for the certificate" : ""}
                    {` · ${form.fieldCount} ${form.fieldCount === 1 ? "box" : "boxes"}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen(open === form.id ? null : form.id)}
                  >
                    {open === form.id ? "Close" : "Edit the boxes"}
                  </Button>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        update.mutate({ formId: form.id, data: { retired: true } })
                      }
                    >
                      Retire
                    </Button>
                  )}
                </div>
              </div>

              {!readOnly && (
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={form.attachByDefault}
                      onCheckedChange={(checked) =>
                        update.mutate({
                          formId: form.id,
                          data: { attachByDefault: checked },
                        })
                      }
                    />
                    On every new case
                  </label>
                  <label className="flex items-center gap-2">
                    <Switch
                      checked={form.blocksCertificate}
                      onCheckedChange={(checked) =>
                        update.mutate({
                          formId: form.id,
                          data: { blocksCertificate: checked },
                        })
                      }
                    />
                    Feeds the death certificate
                  </label>
                </div>
              )}

              {open === form.id && (
                <FormBoxes formId={form.id} readOnly={readOnly} />
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Input
            className="flex-1 min-w-48"
            aria-label="What the form is called"
            placeholder="What you call it — 'Cremation authorization'"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-44" aria-label="What kind of form">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="form">An ordinary form</SelectItem>
              <SelectItem value="authorization">An authorization</SelectItem>
            </SelectContent>
          </Select>
          <Button
            disabled={add.isPending || name.trim() === ""}
            onClick={() =>
              add.mutate({
                data: {
                  name: name.trim(),
                  kind: kind as "form" | "authorization",
                },
              })
            }
          >
            <Plus className="size-4" />
            Add it
          </Button>
        </div>
      )}

      {kind === "authorization" && !readOnly && (
        <p className="text-sm text-muted-foreground">
          An authorization records who authorized it, which tier of C.R.S.
          15-19-106 they claimed, and who here verified that — and only the
          contact you have recorded as authorizing can sign one. Where the tier
          needs a majority, every consenting person is recorded separately.
        </p>
      )}
    </section>
  );
}
