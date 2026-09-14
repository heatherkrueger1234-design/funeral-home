import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      // One directory per tag, and one file per schema.
      //
      // This is a merge-conflict decision rather than an aesthetic one. In
      // "split" mode every endpoint in the product lands in a single
      // ten-thousand-line generated file, so two people adding unrelated
      // endpoints in the same week regenerate the same lines and collide on
      // code neither of them wrote. Per tag, an added endpoint touches its
      // own tag's directory and the schema files it actually uses.
      mode: "tags-split",
      schemas: "generated/model",
      // tags-split defaults this to true, which writes into the package's
      // hand-written src/index.ts. generated/ is orval's; src/index.ts is ours.
      indexFiles: false,
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiZodSrc,
      client: "zod",
      target: "generated",
      schemas: { path: "generated/types", type: "typescript" },
      // Per tag, for the reason given above. The types were already one file
      // each; the validators were not.
      mode: "tags-split",
      indexFiles: false,
      clean: true,
      prettier: true,
      override: {
        zod: {
          // `useDates` below types date-time fields as `z.date()`. Bodies
          // arrive as JSON, where a date is an ISO string, so without
          // coercion every request carrying a service date is rejected as
          // malformed. Coercing lets the server keep real `Date` objects,
          // which is what Drizzle wants to insert anyway.
          coerce: {
            query: ['boolean', 'number', 'string', 'date'],
            param: ['boolean', 'number', 'string', 'date'],
            body: ['date'],
          },
        },
        useDates: true,
      },
    },
  },
});
