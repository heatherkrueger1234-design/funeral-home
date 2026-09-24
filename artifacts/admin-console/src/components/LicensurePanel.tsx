import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  formatDate,
  LICENCE_STANDING_LABELS,
  LICENCE_STANDINGS,
  PRACTITIONER_ROLE_LABELS,
  PRACTITIONER_ROLES,
  type AdminHomeDetail,
  type HomeLicensure,
  type LicenceStanding,
  type Practitioner,
  type PractitionerRole,
} from "@/lib/api";
import { Button, Card, CardTitle, EmptyState, Field, Select } from "./ui";
import { Reminders } from "./Reminders";

/**
 * One home's Colorado paperwork.
 *
 * Everything here is the platform's own record of a customer — a note of
 * their DORA registration and who at the home needs a license by January. It
 * is not the home's data and it is never shown to a family. See the comment
 * at the top of `lib/db/src/schema/licensure.ts` for where that line is and
 * why it is drawn there.
 */

function splitServices(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function LicensurePanel({ home }: { home: AdminHomeDetail }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["home", home.id] });

  const save = useMutation({
    mutationFn: (values: Partial<HomeLicensure>) =>
      api.put(`/admin/homes/${home.id}/licensure`, values),
    onSuccess: () => {
      setEditing(false);
      void refresh();
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardTitle>What Colorado asks of this home</CardTitle>
        <Reminders
          reminders={home.reminders}
          emptyDetail={
            home.licensure
              ? "Nothing is due here. The registration is current and everyone listed holds a license."
              : "Nothing to say yet. Add this home's DORA registration below and the dates that matter will appear here."
          }
        />
      </Card>

      <Card>
        <CardTitle
          action={
            // With nothing recorded, the empty state below carries the one
            // action; a second "Edit" beside it would be two ways to do it.
            (home.licensure || editing) && (
              <Button
                variant="plain"
                onClick={() => {
                  // A refusal from the last attempt is not news the next time
                  // the form opens.
                  save.reset();
                  setEditing((was) => !was);
                }}
              >
                {editing ? "Cancel" : "Edit registration"}
              </Button>
            )
          }
        >
          DORA registration
        </CardTitle>

        {editing ? (
          <RegistrationForm
            licensure={home.licensure}
            pending={save.isPending}
            problem={save.error instanceof Error ? save.error.message : null}
            onSave={(values) => save.mutate(values)}
          />
        ) : home.licensure ? (
          <RegistrationSummary licensure={home.licensure} />
        ) : (
          <EmptyState
            title="No registration recorded"
            detail="Under C.R.S. 12-135-110 every funeral establishment registers with DORA: its location, its appointed designee, and the services it provides there. Recording it here is how the January deadline and the thirty-day amendment rule start showing up on this page."
            action={
              <Button variant="primary" onClick={() => setEditing(true)}>
                Add the registration
              </Button>
            }
          />
        )}
      </Card>

      <PractitionersCard home={home} />
    </div>
  );
}

function RegistrationSummary({ licensure }: { licensure: HomeLicensure }) {
  const rows: Array<[string, string]> = [
    ["Registration number", licensure.doraRegistrationNumber || "—"],
    [
      "Appointed designee",
      [licensure.designeeName, licensure.designeeTitle]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
    ["Began business", formatDate(licensure.beganBusinessOn)],
    ["Renews", formatDate(licensure.registrationRenewsOn)],
    ["Services last changed", formatDate(licensure.servicesChangedOn)],
    ["Amendment filed", formatDate(licensure.amendmentFiledOn)],
  ];

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-[var(--muted-foreground)]">{label}</dt>
            <dd className="tabular">{value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="text-sm text-[var(--muted-foreground)]">
          Registered services
        </p>
        {licensure.registeredServices.length === 0 ? (
          <p className="text-[var(--muted-foreground)]">
            None recorded. Adding a service at a location means an amended
            registration within thirty days.
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {licensure.registeredServices.map((service) => (
              <li
                key={service}
                className="rounded-sm bg-[var(--muted)] px-2 py-1 text-sm"
              >
                {service}
              </li>
            ))}
          </ul>
        )}
      </div>

      {licensure.notes && (
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">Notes</p>
          <p className="max-w-prose whitespace-pre-wrap">{licensure.notes}</p>
        </div>
      )}
    </div>
  );
}

function RegistrationForm({
  licensure,
  pending,
  problem,
  onSave,
}: {
  licensure: HomeLicensure | null;
  pending: boolean;
  problem: string | null;
  onSave: (values: Partial<HomeLicensure>) => void;
}) {
  const [form, setForm] = useState({
    doraRegistrationNumber: licensure?.doraRegistrationNumber ?? "",
    registeredServices: (licensure?.registeredServices ?? []).join(", "),
    designeeName: licensure?.designeeName ?? "",
    designeeTitle: licensure?.designeeTitle ?? "",
    beganBusinessOn: licensure?.beganBusinessOn ?? "",
    registrationRenewsOn: licensure?.registrationRenewsOn ?? "",
    servicesChangedOn: licensure?.servicesChangedOn ?? "",
    amendmentFiledOn: licensure?.amendmentFiledOn ?? "",
    notes: licensure?.notes ?? "",
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          doraRegistrationNumber: form.doraRegistrationNumber.trim() || null,
          registeredServices: splitServices(form.registeredServices),
          designeeName: form.designeeName.trim() || null,
          designeeTitle: form.designeeTitle.trim() || null,
          beganBusinessOn: form.beganBusinessOn || null,
          registrationRenewsOn: form.registrationRenewsOn || null,
          servicesChangedOn: form.servicesChangedOn || null,
          amendmentFiledOn: form.amendmentFiledOn || null,
          notes: form.notes.trim() || null,
        });
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="DORA registration number"
          value={form.doraRegistrationNumber}
          onChange={(event) => set("doraRegistrationNumber")(event.target.value)}
          hint="Exactly as it appears on the certificate."
        />
        <Field
          label="Appointed designee"
          value={form.designeeName}
          onChange={(event) => set("designeeName")(event.target.value)}
          hint="The person named on the registration."
        />
        <Field
          label="Designee's title"
          value={form.designeeTitle}
          onChange={(event) => set("designeeTitle")(event.target.value)}
        />
        <Field
          label="Began business at this location"
          type="date"
          value={form.beganBusinessOn}
          onChange={(event) => set("beganBusinessOn")(event.target.value)}
        />
        <Field
          label="Registration renews"
          type="date"
          value={form.registrationRenewsOn}
          onChange={(event) => set("registrationRenewsOn")(event.target.value)}
          hint="At renewal the home attests whether it sells preneed."
        />
        <Field
          label="Services last changed"
          type="date"
          value={form.servicesChangedOn}
          onChange={(event) => set("servicesChangedOn")(event.target.value)}
          hint="Starts the thirty-day clock for an amended registration."
        />
        <Field
          label="Amendment filed"
          type="date"
          value={form.amendmentFiledOn}
          onChange={(event) => set("amendmentFiledOn")(event.target.value)}
          hint="Stops that clock."
        />
      </div>

      <Field
        label="Registered services"
        value={form.registeredServices}
        onChange={(event) => set("registeredServices")(event.target.value)}
        hint="Separated by commas, as written on the registration."
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="licensure-notes" className="text-sm font-semibold">
          Notes
        </label>
        <textarea
          id="licensure-notes"
          rows={3}
          value={form.notes}
          onChange={(event) => set("notes")(event.target.value)}
          maxLength={2000}
          className={
            "rounded-md border border-[var(--border-strong)] bg-white p-3 text-base " +
            "shadow-[inset_0_1px_2px_rgb(40_34_24/0.04)] " +
            "focus-visible:outline-none focus-visible:border-[var(--accent)] " +
            "focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_16%,transparent)]"
          }
        />
      </div>

      {problem && (
        <p role="alert" className="text-sm text-[var(--notice)]">
          {problem}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save the registration"}
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------- the people -- */

type PractitionerValues = Omit<Practitioner, "id">;

/**
 * The people, and the three things done to them: add, correct, remove.
 *
 * The standing stays a select in the row because it is the one field that
 * changes on its own schedule -- "application in" becomes "provisional"
 * becomes "licensed" -- and changing it should not mean opening a form.
 * Everything else (a misspelt name, a licence number once it is issued) is
 * corrected through the same form that added them. Removing someone asks
 * once, by name, because a row gone by accident is a person whose deadline
 * quietly stops being watched.
 */
function PractitionersCard({ home }: { home: AdminHomeDetail }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["home", home.id] });

  const add = useMutation({
    mutationFn: (values: PractitionerValues) =>
      api.post(`/admin/homes/${home.id}/practitioners`, values),
    onSuccess: () => {
      setAdding(false);
      void refresh();
    },
  });

  const startAdding = () => {
    add.reset();
    setAdding(true);
  };

  return (
    <Card>
      <CardTitle
        action={
          home.practitioners.length > 0 &&
          !adding && (
            <Button variant="plain" onClick={startAdding}>
              Add someone
            </Button>
          )
        }
      >
        Who needs a license by 1 January 2027
      </CardTitle>

      {home.practitioners.length === 0 && !adding ? (
        <EmptyState
          title="Nobody listed yet"
          detail="Senate Bill 24-173 brought mortuary science practitioners, funeral directors, embalmers, cremationists and natural reductionists under licensure. List the people at this home it applies to — including the ones who don't have a sign-in here, like an embalmer who works across three homes."
          action={
            <Button variant="primary" onClick={startAdding}>
              Add the first person
            </Button>
          }
        />
      ) : home.practitioners.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left">
            <thead className="text-sm text-[var(--muted-foreground)]">
              <tr>
                <th scope="col" className="pb-2 font-medium">Name</th>
                <th scope="col" className="pb-2 font-medium">Role</th>
                <th scope="col" className="pb-2 font-medium">Standing</th>
                <th scope="col" className="pb-2 font-medium">License no.</th>
                <th scope="col" className="pb-2 font-medium">Expires</th>
                <th scope="col" className="pb-2 font-medium">
                  <span className="sr-only">Change or remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {home.practitioners.map((person) => (
                <PractitionerRow key={person.id} homeId={home.id} person={person} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {adding && (
        <PractitionerForm
          pending={add.isPending}
          problem={add.error instanceof Error ? add.error.message : null}
          onCancel={() => setAdding(false)}
          onSave={(values) => add.mutate(values)}
        />
      )}
    </Card>
  );
}

/**
 * One person, and everything that can be done to their row.
 *
 * Each row owns its own saves, so a change to one person disables that row
 * and not the whole table, and an error is shown against the person it
 * happened to. Before this there was one shared "update" for the table: every
 * standing dropdown greyed out while any one of them saved, and a refusal was
 * not shown anywhere at all -- the dropdown simply snapped back.
 *
 * Removing asks first. It is one click from a list of people's names, it
 * cannot be undone from here, and the licence number that goes with it was
 * probably typed off a certificate somebody had to dig out.
 */
function PractitionerRow({
  homeId,
  person,
}: {
  homeId: number;
  person: Practitioner;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["home", homeId] });

  const update = useMutation({
    mutationFn: ({ id, ...values }: Practitioner) =>
      api.put(`/admin/homes/${homeId}/practitioners/${id}`, values),
    onSuccess: () => {
      setEditing(false);
      void refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      api.delete(`/admin/homes/${homeId}/practitioners/${person.id}`),
    onSuccess: refresh,
  });

  const busy = update.isPending || remove.isPending;

  if (editing) {
    return (
      <tr className="border-t border-[var(--border)]">
        <td colSpan={6} className="pb-4">
          <PractitionerForm
            initial={person}
            pending={update.isPending}
            problem={update.error instanceof Error ? update.error.message : null}
            onCancel={() => {
              update.reset();
              setEditing(false);
            }}
            onSave={(values) => update.mutate({ id: person.id, ...values })}
          />
        </td>
      </tr>
    );
  }

  const problem =
    (update.error instanceof Error && update.error.message) ||
    (remove.error instanceof Error && remove.error.message) ||
    null;

  return (
    <tr className="border-t border-[var(--border)] align-top">
      <td className="py-3 pr-4">
        {person.personName}
        {problem && (
          <p role="alert" className="mt-1 text-sm text-[var(--notice)]">
            {problem}
          </p>
        )}
      </td>
      <td className="py-3 pr-4 text-[var(--muted-foreground)]">
        {PRACTITIONER_ROLE_LABELS[person.role]}
      </td>
      <td className="py-3 pr-4">
        <label className="sr-only" htmlFor={`standing-${person.id}`}>
          {person.personName}'s license standing
        </label>
        <select
          id={`standing-${person.id}`}
          value={
            update.isPending && update.variables
              ? update.variables.standing
              : person.standing
          }
          disabled={busy}
          onChange={(event) =>
            update.mutate({
              ...person,
              standing: event.target.value as LicenceStanding,
            })
          }
          className="min-h-11 rounded-md border border-[var(--border)] bg-white px-2"
        >
          {LICENCE_STANDINGS.map((standing) => (
            <option key={standing} value={standing}>
              {LICENCE_STANDING_LABELS[standing]}
            </option>
          ))}
        </select>
      </td>
      <td className="tabular py-3 pr-4">{person.licenceNumber || "—"}</td>
      <td className="tabular py-3 pr-4">{formatDate(person.expiresOn)}</td>
      <td className="py-3">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Removing…" : `Remove ${person.personName}`}
            </Button>
            <Button
              variant="plain"
              disabled={remove.isPending}
              onClick={() => {
                remove.reset();
                setConfirming(false);
              }}
            >
              Keep
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="plain"
              disabled={busy}
              aria-label={`Edit ${person.personName}`}
              onClick={() => {
                update.reset();
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="plain"
              disabled={busy}
              aria-label={`Remove ${person.personName}`}
              onClick={() => setConfirming(true)}
            >
              Remove
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * Adding somebody, or changing what is recorded about them. One form for
 * both, because a licence number typed wrong on the way in has to be
 * correctable on the way out -- the API always accepted every field, and the
 * page only ever let you change the standing.
 */
function PractitionerForm({
  initial,
  pending,
  problem,
  onSave,
  onCancel,
}: {
  initial?: PractitionerValues;
  pending: boolean;
  problem: string | null;
  onSave: (values: PractitionerValues) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    personName: initial?.personName ?? "",
    role: initial?.role ?? ("mortuary_science_practitioner" as PractitionerRole),
    standing: initial?.standing ?? ("not_applied" as LicenceStanding),
    licenceNumber: initial?.licenceNumber ?? "",
    expiresOn: initial?.expiresOn ?? "",
  });

  return (
    <form
      className="mt-6 flex flex-col gap-5 border-t border-[var(--border)] pt-6"
      aria-label={initial ? `Change ${initial.personName}` : "Add someone"}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          personName: form.personName.trim(),
          role: form.role,
          standing: form.standing,
          licenceNumber: form.licenceNumber.trim() || null,
          expiresOn: form.expiresOn || null,
        });
      }}
    >
      <h3 className="font-display text-base">
        {initial ? `Correcting ${initial.personName}` : "Add someone"}
      </h3>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Name"
          required
          maxLength={160}
          autoFocus
          value={form.personName}
          onChange={(event) =>
            setForm((current) => ({ ...current, personName: event.target.value }))
          }
        />
        <Select
          label="Role"
          value={form.role}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              role: event.target.value as PractitionerRole,
            }))
          }
        >
          {PRACTITIONER_ROLES.map((role) => (
            <option key={role} value={role}>
              {PRACTITIONER_ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
        <Select
          label="Standing"
          value={form.standing}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              standing: event.target.value as LicenceStanding,
            }))
          }
        >
          {LICENCE_STANDINGS.map((standing) => (
            <option key={standing} value={standing}>
              {LICENCE_STANDING_LABELS[standing]}
            </option>
          ))}
        </Select>
        <Field
          label="License number"
          maxLength={60}
          value={form.licenceNumber}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              licenceNumber: event.target.value,
            }))
          }
          hint="Once it has been issued."
        />
        <Field
          label="Expires"
          type="date"
          value={form.expiresOn}
          onChange={(event) =>
            setForm((current) => ({ ...current, expiresOn: event.target.value }))
          }
          hint="Provisional licenses run three years from issue."
        />
      </div>

      {problem && (
        <p role="alert" className="text-sm text-[var(--notice)]">
          {problem}
        </p>
      )}

      <div className="flex gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={pending || !form.personName.trim()}
        >
          {initial
            ? pending
              ? "Saving…"
              : "Save the changes"
            : pending
              ? "Adding…"
              : "Add them"}
        </Button>
        <Button type="button" variant="plain" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
