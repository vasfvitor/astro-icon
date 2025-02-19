import type { AstroConfig, AstroIntegrationLogger } from "astro";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Plugin } from "vite";
import type {
  AstroIconCollectionMap,
  IconCollection,
  IntegrationOptions,
} from "../typings/integration";
import loadLocalCollection from "./loaders/loadLocalCollection.js";
import loadIconifyCollections from "./loaders/loadIconifyCollections.js";
import { createHash } from "node:crypto";

interface PluginContext extends Pick<AstroConfig, "root" | "output"> {
  logger: AstroIntegrationLogger;
}

let collections: AstroIconCollectionMap | undefined;
export function createPlugin(
  { include = {}, iconDir = "src/icons", svgoOptions }: IntegrationOptions,
  ctx: PluginContext,
): Plugin {
  const { root } = ctx;
  const virtualModuleId = "virtual:astro-icon";
  const resolvedVirtualModuleId = "\0" + virtualModuleId;

  return {
    name: "astro-icon",
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },
    async load(id) {
      if (id === resolvedVirtualModuleId) {
        if (!collections) {
          collections = await loadIconifyCollections({ root, include });
          logCollections(collections, ctx);
        }
        try {
          // Attempt to create local collection
          const local = await loadLocalCollection(iconDir, svgoOptions);
          collections["local"] = local;
        } catch (ex) {
          // Failed to load the local collection
        }
        await generateIconTypeDefinitions(Object.values(collections), root);

        return `export default ${JSON.stringify(
          collections,
        )};\nexport const config = ${JSON.stringify({ include })}`;
      }
    },
  };
}

function logCollections(
  collections: AstroIconCollectionMap,
  { logger }: PluginContext,
) {
  if (Object.keys(collections).length === 0) {
    logger.warn("No icons detected!");
    return;
  }
  const names: string[] = Object.keys(collections);
  logger.info(`Loaded icons from ${names.join(", ")}`);
}

async function generateIconTypeDefinitions(
  collections: IconCollection[],
  rootDir: URL,
  defaultPack = "local",
): Promise<void> {
  const typeFile = new URL("./.astro/icon.d.ts", rootDir);
  await ensureDir(new URL("./", typeFile));
  const oldHash = await tryGetHash(typeFile);
  const currentHash = collectionsHash(collections);
  if (currentHash === oldHash) {
    return;
  }
  await writeFile(
    typeFile,
    `// Automatically generated by astro-icon
// ${currentHash}

declare module 'virtual:astro-icon' {
\texport type Icon = ${
      collections.length > 0
        ? collections
            .map((collection) =>
              Object.keys(collection.icons).map(
                (icon) =>
                  `\n\t\t| "${
                    collection.prefix === defaultPack
                      ? ""
                      : `${collection.prefix}:`
                  }${icon}"`,
              ),
            )
            .flat(1)
            .join("")
        : "never"
    };
}`,
  );
}

function collectionsHash(collections: IconCollection[]): string {
  const hash = createHash("sha256");
  for (const collection of collections) {
    hash.update(collection.prefix);
    hash.update(Object.keys(collection.icons).sort().join(","));
  }
  return hash.digest("hex");
}

async function tryGetHash(path: URL): Promise<string | void> {
  try {
    const text = await readFile(path, { encoding: "utf-8" });
    return text.split("\n", 3)[1].replace("// ", "");
  } catch {}
}

async function ensureDir(path: URL): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch {}
}
