// Plugin Vite : découpe data/banks.json en modules chargés à la demande, pour garder le bundle principal léger.
//   virtual:cbpf/core            données du cœur (banques avec cellules dérivées des catalogues, champs, sources, marché,
//                                simulateur) + index des catalogues (id, rubrique, libellé) ;
//   virtual:cbpf/catalog/<id>    un catalogue et ses produits (un fichier JS par catalogue) ;
//   virtual:cbpf/reperes         sections des Repères officiels ;
//   virtual:cbpf/loaders         `catalogLoaders[id]()` et `loadReperesData()` (import() dynamiques).
// Les données sont recopiées telles quelles (JSON.parse d'une chaîne : pas d'eval, compatible CSP stricte).
import { readFileSync } from 'node:fs';
import { deriveData } from '../src/lib/derive.js';

const PREFIX = 'virtual:cbpf/';

export default function cbpfData(path) {
  let cached = null;
  const load = () => (cached ||= deriveData(JSON.parse(readFileSync(path, 'utf8'))));
  const json = (x) => `export default JSON.parse(${JSON.stringify(JSON.stringify(x))});\n`;
  return {
    name: 'cbpf-data',
    resolveId(id) {
      if (id.startsWith(PREFIX)) return `\0${id}`;
      return null;
    },
    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return null;
      this.addWatchFile(path);
      const d = load();
      const key = id.slice(PREFIX.length + 1);
      if (key === 'core') {
        const { products, catalogs, reperes, ...rest } = d;
        return json({ ...rest, catalogIndex: (catalogs || []).map((c) => ({ id: c.id, category: c.category, label: c.label })) });
      }
      if (key === 'reperes') return json(d.reperes || null);
      if (key === 'loaders') {
        const entries = (d.catalogs || []).map((c) => `  ${JSON.stringify(c.id)}: () => import(${JSON.stringify(`${PREFIX}catalog/${c.id}`)}),`);
        return `export const catalogLoaders = {\n${entries.join('\n')}\n};\nexport const loadReperesData = () => import(${JSON.stringify(`${PREFIX}reperes`)});\n`;
      }
      if (key.startsWith('catalog/')) {
        const cid = key.slice('catalog/'.length);
        const catalog = (d.catalogs || []).find((c) => c.id === cid);
        if (!catalog) this.error(`catalogue inconnu : ${cid}`);
        return json({ catalog, products: (d.products || []).filter((p) => p.kind === cid) });
      }
      this.error(`module de données inconnu : ${key}`);
      return null;
    },
    watchChange(id) {
      if (id === path) cached = null;
    },
    handleHotUpdate({ file, server }) {
      if (file !== path) return undefined;
      cached = null;
      for (const m of server.moduleGraph.idToModuleMap.values()) if (m.id?.startsWith(`\0${PREFIX}`)) server.moduleGraph.invalidateModule(m);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
