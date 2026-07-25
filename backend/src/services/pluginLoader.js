import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as hooks from "./hooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.resolve(__dirname, "../../plugins");

/**
 * Estrutura de cada plugin (mesmo padrão de manifesto do MyAAC, adaptado):
 *
 *   backend/plugins/<nome>/
 *     plugin.json   — manifesto: { name, description, version, author, enabled, entry }
 *     index.js      — exporta register(hooks), onde o plugin se acopla aos hook points
 *
 * Plugins com "enabled": false no manifesto são listados (útil pro painel
 * admin) mas não têm o código carregado.
 */
export async function loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];

  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  const loaded = [];

  for (const entry of entries) {
    const manifestPath = path.join(PLUGINS_DIR, entry.name, "plugin.json");
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest._dir = entry.name;

    if (manifest.enabled) {
      try {
        const entryFile = path.join(PLUGINS_DIR, entry.name, manifest.entry || "index.js");
        const mod = await import(pathToFileURL(entryFile).href);
        if (typeof mod.register === "function") {
          mod.register(hooks);
          console.log(`[plugins] "${manifest.name}" carregado e registrado nos hooks.`);
        } else {
          console.warn(`[plugins] "${manifest.name}" não exporta register() — ignorado.`);
        }
      } catch (err) {
        console.error(`[plugins] Falha ao carregar "${manifest.name}":`, err);
      }
    }

    loaded.push(manifest);
  }

  return loaded;
}

/** Lista os manifestos sem carregar código — usado pelo painel admin. */
export function listManifests() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((entry) => {
      const manifestPath = path.join(PLUGINS_DIR, entry.name, "plugin.json");
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifest._dir = entry.name;
      return manifest;
    })
    .filter(Boolean);
}

/** Liga/desliga um plugin reescrevendo o campo "enabled" no manifesto. */
export function setPluginEnabled(dirName, enabled) {
  const manifestPath = path.join(PLUGINS_DIR, dirName, "plugin.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Plugin não encontrado.");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  manifest.enabled = enabled;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}
