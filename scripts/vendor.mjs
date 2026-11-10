import {cp,mkdir,copyFile} from 'node:fs/promises';
await mkdir('public/vendor',{recursive:true});
for (const [name,source] of Object.entries({'leaflet':'leaflet/dist','draw':'leaflet-draw/dist','exifr':'exifr/dist','fflate':'fflate/umd'})) await cp(`node_modules/${source}`,`public/vendor/${name}`,{recursive:true});
for (const name of ['leaflet','leaflet-draw','exifr','fflate']) {
  for (const license of ['LICENSE','LICENSE.md','LICENSE.txt']) {
    try { await copyFile(`node_modules/${name}/${license}`,`public/vendor/${name}-LICENSE`); break; } catch {}
  }
}
