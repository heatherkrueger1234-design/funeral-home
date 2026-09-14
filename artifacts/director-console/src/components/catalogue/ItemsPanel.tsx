import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  catalogueQueryKey,
  cataloguePhotoUrl,
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  postUploadMultipart,
  updateItem,
  SECTION_LABELS,
  type Catalogue,
  type CatalogueCategory,
  type CatalogueItem,
  type CatalogueSection,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";

/**
 * The catalogue itself, as a director keeps it.
 *
 * Built for correcting rather than for entering. Almost every home arrives
 * here after a spreadsheet import, so what this screen is optimised for is
 * fixing the one price that came in wrong and attaching the photographs the
 * file could not carry — not typing two hundred caskets, which is what the
 * importer is for and what nobody does twice.
 *
 * Prices are ours to print and never ours to set. Nothing on this screen
 * suggests a number, marks one up, or compares a home's prices with anyone
 * else's.
 */

const SECTIONS: CatalogueSection[] = [
  "services",
  "caskets",
  "outer_burial_containers",
  "merchandise",
  "cash_advance",
];

/** Cents from what a person typed. Null when it cannot be read. */
function parseDollars(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;

  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

/** What goes in an editable box: plain digits, no currency furniture. */
function toDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function ItemRow({
  item,
  onChanged,
}: {
  item: CatalogueItem;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function patch(values: Parameters<typeof updateItem>[1]) {
    setBusy(true);
    try {
      await updateItem(item.id, values);
      onChanged();
    } catch (error) {
      toast({
        title: "That didn't save",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function attachPhoto(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await postUploadMultipart(file);
      await updateItem(item.id, { photoUploadId: uploaded.id });
      onChanged();
    } catch (error) {
      toast({
        title: "That photograph didn't upload",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-start gap-3 border-t border-border py-3">
      <label
        className="grid size-16 shrink-0 cursor-pointer place-items-center
                   overflow-hidden rounded-md border border-border bg-muted"
        title={item.photoUploadId ? "Replace this photograph" : "Add a photograph"}
      >
        {item.photoUploadId ? (
          <img
            src={cataloguePhotoUrl(item.photoUploadId)}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <ImagePlus className="size-5 text-muted-foreground" />
        )}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => void attachPhoto(event.target.files?.[0] ?? null)}
        />
      </label>

      <div className="min-w-48 flex-1 space-y-2">
        <Input
          aria-label="Name"
          defaultValue={item.name}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next === "" || next === item.name) return;
            void patch({ name: next });
          }}
        />
        <Input
          aria-label="Description"
          placeholder="What it is made of, what is included"
          defaultValue={item.description ?? ""}
          onBlur={(event) => {
            const next = event.target.value;
            if (next === (item.description ?? "")) return;
            void patch({ description: next === "" ? null : next });
          }}
        />
      </div>

      <div className="relative w-32">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center
                     text-muted-foreground"
        >
          $
        </span>
        <Input
          aria-label="Price"
          inputMode="decimal"
          className="pl-6 text-right tabular-nums"
          defaultValue={toDollars(item.priceCents)}
          onBlur={(event) => {
            // An unreadable price is put back rather than saved as nothing.
            // A blank price on a list a family reads is worse than a typo.
            const cents = parseDollars(event.target.value);
            if (cents === null) {
              event.target.value = toDollars(item.priceCents);
              return;
            }
            if (cents === item.priceCents) return;
            void patch({ priceCents: cents });
          }}
        />
      </div>

      <div className="flex items-center gap-1">
        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Remove ${item.name}`}
          onClick={async () => {
            setBusy(true);
            try {
              await deleteItem(item.id);
              onChanged();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function AddItem({
  category,
  onChanged,
}: {
  category: CatalogueCategory;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  const cents = parseDollars(price);
  const ready = name.trim() !== "" && cents !== null;

  async function add() {
    if (!ready) return;
    setBusy(true);
    try {
      await createItem({
        categoryId: category.id,
        name: name.trim(),
        priceCents: cents,
      });
      setName("");
      setPrice("");
      onChanged();
    } catch (error) {
      toast({
        title: "That didn't save",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <div className="min-w-48 flex-1 space-y-1.5">
        <Label htmlFor={`add-name-${category.id}`}>Add an item</Label>
        <Input
          id={`add-name-${category.id}`}
          placeholder="What it is called"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="w-32 space-y-1.5">
        <Label htmlFor={`add-price-${category.id}`}>Price</Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center
                       text-muted-foreground"
          >
            $
          </span>
          <Input
            id={`add-price-${category.id}`}
            inputMode="decimal"
            placeholder="0.00"
            className="pl-6 text-right tabular-nums"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </div>
      </div>
      <Button disabled={!ready || busy} onClick={() => void add()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        Add
      </Button>
    </div>
  );
}

function AddCategory({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [section, setSection] = useState<CatalogueSection>("merchandise");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (name.trim() === "") return;
    setBusy(true);
    try {
      await createCategory({ name: name.trim(), section });
      setName("");
      onChanged();
    } catch (error) {
      toast({
        title: "That didn't save",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4">
      <div className="min-w-48 flex-1 space-y-1.5">
        <Label htmlFor="add-category">Add a category</Label>
        <Input
          id="add-category"
          placeholder="Your own name for it — “Cremation urns”, “Traditional caskets”"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="add-category-section">Price list</Label>
        <Select
          value={section}
          onValueChange={(value) => setSection(value as CatalogueSection)}
        >
          <SelectTrigger id="add-category-section" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {SECTION_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button disabled={name.trim() === "" || busy} onClick={() => void add()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        Add
      </Button>
    </div>
  );
}

export function ItemsPanel({ catalogue }: { catalogue: Catalogue }) {
  const queryClient = useQueryClient();
  const onChanged = () =>
    void queryClient.invalidateQueries({ queryKey: catalogueQueryKey });

  return (
    <div className="space-y-6">
      {catalogue.categories.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <h2 className="font-display text-xl mb-1">Nothing here yet</h2>
          <p className="mx-auto max-w-prose text-muted-foreground">
            This is your merchandise, at your prices, under your own names for
            it. We supply none of it. The quickest way in is the price sheet
            you already have — load it above, and correct anything that lands
            in the wrong place.
          </p>
        </div>
      ) : (
        catalogue.categories.map((category) => (
          <section
            key={category.id}
            className="rounded-xl border border-border bg-card p-4"
          >
            <header className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-medium">{category.name}</h2>
              <span className="text-sm text-muted-foreground">
                {SECTION_LABELS[category.section]}
              </span>
              {/*
                A category takes its items with it, which is exactly the
                click a director makes at speed and regrets at once. Anything
                a family has already chosen survives — the row is retired
                rather than deleted, because a statement is a document — but
                the rest of the category is gone and there is no undo.
              */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground"
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {category.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {category.items.length === 0
                        ? "There is nothing in it, so nothing else goes with it."
                        : `Its ${category.items.length} item${
                            category.items.length === 1 ? "" : "s"
                          } go too. Anything a family has already chosen stays on their statement at the price they were quoted.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        await deleteCategory(category.id);
                        onChanged();
                      }}
                    >
                      Remove it
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </header>

            <ul className="mt-2">
              {category.items.map((item) => (
                <ItemRow key={item.id} item={item} onChanged={onChanged} />
              ))}
            </ul>

            <div className="mt-3">
              <AddItem category={category} onChanged={onChanged} />
            </div>
          </section>
        ))
      )}

      <AddCategory onChanged={onChanged} />
    </div>
  );
}
