import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Phone, Plus, Trash2, Users } from "lucide-react";
import {
  useGetContacts,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  type Contact,
} from "@workspace/api-client-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The people who have to be told.
 *
 * The feature is not the list, it is `toldBy`: this page exists so the parent
 * does not have to be the one making the calls. Written down, it can be handed
 * to a sibling or a friend, who works down it and records who they reached.
 * That is the most delegable job of the first week and it almost never gets
 * delegated, because there is nothing to hand over.
 */

const CATEGORIES = [
  { value: "family", label: "Family" },
  { value: "friend", label: "Friends" },
  { value: "school", label: "School" },
  { value: "work", label: "Work" },
  { value: "medical", label: "Medical" },
  { value: "official", label: "Official" },
  { value: "other", label: "Other" },
] as const;

export default function Contacts() {
  const { data: contacts, refetch } = useGetContacts();
  const { mutate: create, isPending } = useCreateContact();
  const { mutate: update } = useUpdateContact();
  const { mutate: remove } = useDeleteContact();

  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("family");

  const add = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    create(
      {
        data: {
          name: name.trim(),
          relationship: relationship.trim() || null,
          category,
        },
      },
      {
        onSuccess: () => {
          setName("");
          setRelationship("");
          refetch();
        },
      },
    );
  };

  const toggleTold = (contact: Contact) => {
    update(
      {
        id: contact.id,
        data: {
          told: !contact.told,
          toldDate: contact.told ? null : new Date().toISOString().slice(0, 10),
        },
      },
      { onSuccess: () => refetch() },
    );
  };

  const setToldBy = (contact: Contact, toldBy: string) => {
    update({ id: contact.id, data: { toldBy: toldBy || null } }, { onSuccess: () => refetch() });
  };

  const remaining = contacts?.filter((c) => !c.told) ?? [];
  const told = contacts?.filter((c) => c.told) ?? [];

  const render = (contact: Contact) => (
    <motion.div
      key={contact.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="glass-panel px-5 py-4 rounded-2xl group"
    >
      <div className="flex items-start gap-4">
        <button
          onClick={() => toggleTold(contact)}
          aria-label={contact.told ? `Mark ${contact.name} as not told` : `Mark ${contact.name} as told`}
          className={cn(
            "w-6 h-6 mt-0.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
            contact.told
              ? "bg-primary/30 border-primary"
              : "border-primary/40 hover:border-primary",
          )}
        >
          {contact.told && <Check className="w-3 h-3 text-primary" />}
        </button>

        <div className="flex-1 min-w-0">
          <p className={cn("break-words", contact.told ? "text-muted-foreground" : "text-foreground")}>
            {contact.name}
          </p>
          <p className="text-sm text-muted-foreground/70">
            {contact.relationship ?? CATEGORIES.find((c) => c.value === contact.category)?.label}
            {contact.toldDate && ` · told ${contact.toldDate}`}
          </p>

          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="inline-flex items-center gap-1.5 text-sm text-primary/80 hover:text-primary mt-1"
            >
              <Phone className="w-3.5 h-3.5" />
              {contact.phone}
            </a>
          )}

          {contact.told && (
            <div className="mt-2">
              <Input
                defaultValue={contact.toldBy ?? ""}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value !== (contact.toldBy ?? "")) setToldBy(contact, value);
                }}
                placeholder="Who made the call?"
                className="bg-background/60 border-white/10 h-8 text-sm max-w-xs"
              />
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="opacity-70 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 text-destructive hover:bg-destructive/20 transition-all flex-shrink-0"
          onClick={() => remove({ id: contact.id }, { onSuccess: () => refetch() })}
          aria-label={`Remove ${contact.name}`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );

  return (
    <PageLayout>
      <PageHeader
        title="People to tell"
        description="So that nobody finds out from Facebook — and so it does not all have to be you."
      />

      <div className="glass-panel rounded-2xl p-5 mb-6 border border-primary/20">
        <p className="text-foreground/85 leading-relaxed">
          You do not have to make these calls. Write the list, hand it to a
          sibling or a friend, and let them work down it and put their name
          against the ones they reached. It is the single easiest thing to give
          away in the first week, and almost nobody gives it away, because there
          is nothing to hand over.
        </p>
      </div>

      <form
        onSubmit={add}
        className="glass-panel p-4 rounded-2xl flex flex-wrap gap-3 mb-8"
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="flex-1 bg-background border-white/10 min-w-[10rem]"
        />
        <Input
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          placeholder="His football coach"
          className="flex-1 bg-background border-white/10 min-w-[10rem]"
        />
        <select
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as (typeof CATEGORIES)[number]["value"])
          }
          className="bg-background border border-white/10 rounded-xl px-3 py-2 text-sm text-foreground"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          disabled={isPending}
          className="bg-primary text-primary-foreground px-5"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </form>

      {!contacts?.length ? (
        <EmptyState
          icon={Users}
          title="Nobody on the list yet"
          description="Family, their friends, the school, their work, the doctor. Add anyone who would be hurt to hear it from somebody else."
        />
      ) : (
        <div className="space-y-8">
          {remaining.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-primary/70 uppercase tracking-widest text-xs font-semibold">
                Still to tell ({remaining.length})
              </h3>
              {remaining.map(render)}
            </div>
          )}
          {told.length > 0 && (
            <div className="space-y-3 opacity-60">
              <h3 className="text-muted-foreground uppercase tracking-widest text-xs font-semibold">
                Told ({told.length})
              </h3>
              {told.map(render)}
            </div>
          )}
        </div>
      )}
    </PageLayout>
  );
}
