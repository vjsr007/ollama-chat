/**
 * generate-icon.js
 * Genera un icon.ico multi‑resolución a partir de uno o varios PNG ubicados en assets/icon-src.
 * Requisitos: al menos un PNG 256x256 (logo-256.png recomendado).
 * Usa png-to-ico para empaquetar.
 */
const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');
const { PNG } = require('pngjs');

const assetsDir = path.join(__dirname, '..', 'assets');
const srcDir = path.join(assetsDir, 'icon-src');
const iconPath = path.join(assetsDir, 'icon.ico');

if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

// Si ya existe un icon.ico y queremos forzar regeneración usar env REBUILD_ICON=1
if (fs.existsSync(iconPath) && !process.env.REBUILD_ICON) {
  console.log('icon.ico ya existe (usa REBUILD_ICON=1 para regenerar)');
  process.exit(0);
}

// Buscar PNGs
const pngs = fs.readdirSync(srcDir)
  .filter(f => f.toLowerCase().endsWith('.png'))
  .map(f => path.join(srcDir, f));

if (pngs.length === 0) {
  console.log('[ICON] No hay PNGs fuente. Creando placeholder logo-256.png...');
  const size = 256;
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      // Simple gradiente morado -> azul
      const t = x / size;
      png.data[idx] = 80 + Math.floor(100 * t);      // R
      png.data[idx + 1] = 40 + Math.floor(40 * (1 - t)); // G
      png.data[idx + 2] = 160 + Math.floor(80 * (1 - t)); // B
      png.data[idx + 3] = 255; // A
    }
  }
  const outPath = path.join(srcDir, 'logo-256.png');
  fs.writeFileSync(outPath, PNG.sync.write(png));
  console.log('[ICON] Placeholder creado:', outPath);
  pngs.push(outPath);
}

// Validar presencia de 256x256 (nombre o metadata simplificada por nombre)
const has256 = pngs.some(p => p.includes('256'));
if (!has256) {
  console.warn('[ICON] Advertencia: No se detectó un PNG 256x256 (usa sufijo -256). El build MSI podría fallar.');
}

pngToIco(pngs)
  .then(buf => {
    fs.writeFileSync(iconPath, buf);
    console.log(`Icono generado: ${iconPath}`);
  })
  .catch(err => {
    console.error('Error generando icon.ico:', err);
    process.exit(1);
  });
