import { useGetCatalogue } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { ImportCatalogue } from "@/components/catalogue/ImportCatalogue";
import { ItemsPanel } from "@/components/catalogue/ItemsPanel";
import { PackagesPanel } from "@/components/catalogue/PackagesPanel";
import { PriceListPanel } from "@/components/catalogue/PriceListPanel";

/**
 * Everything the home sells, and the three sheets the law asks it to print.
 *
 * The catalogue ships empty and we never fill it: a home's merchandise and
 * its prices are its margin, its livelihood and its own Funeral Rule
 * disclosure, and software that arrived with an opinion about either would
 * be competing with the selection room it was sold to.
 */
export default function Catalogue() {
  const catalogue = useGetCatalogue();

  if (catalogue.isPending) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="size-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  if (!catalogue.data) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        We couldn't load your catalogue. Please try again.
      </p>
    );
  }

  const data = catalogue.data;
  const itemCount = data.categories.reduce(
    (total, category) => total + category.items.length,
    0,
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl leading-tight">Your catalogue</h1>
          <p className="text-muted-foreground">
            {itemCount === 0
              ? "Your merchandise, at your prices. Nothing here comes from us."
              : `${itemCount} item${itemCount === 1 ? "" : "s"}${
                  data.hasGeneralPriceList
                    ? " · your price list is ready"
                    : " · no price list date set yet"
                }`}
          </p>
        </div>
        <ImportCatalogue />
      </header>

      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="packages">
            Packages{data.packages.length > 0 ? ` (${data.packages.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="price-list">Price list</TabsTrigger>
        </TabsList>

        <div className="mt-5">
          <TabsContent value="items">
            <ItemsPanel catalogue={data} />
          </TabsContent>
          <TabsContent value="packages">
            <PackagesPanel catalogue={data} />
          </TabsContent>
          <TabsContent value="price-list">
            <PriceListPanel catalogue={data} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
