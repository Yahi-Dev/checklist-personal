#!/usr/bin/env node
/**
 * Genera todos los iconos de la app sin dependencias externas.
 *
 * Se rasteriza a mano y se codifica el PNG con `zlib`, que ya viene en Node. La
 * alternativa era añadir `sharp` (~30 MB de binarios nativos por plataforma) o
 * `canvas` (que necesita compilador de C++) para dibujar un cuadrado con un visto
 * dentro. Para nueve archivos de una forma geometrica simple, no compensa.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Paleta de marca: el mismo indigo que usa la interfaz.
const BRAND = { r: 0x4f, g: 0x46, b: 0xe5 };
const BRAND_DARK = { r: 0x43, g: 0x38, b: 0xca };
const WHITE = { r: 0xff, g: 0xff, b: 0xff };

// ---------------------------------------------------------------------------
// Codificador PNG
// ---------------------------------------------------------------------------

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = -1;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
};

/** RGBA sin comprimir -> PNG. Filtro 0 en cada linea: basta para formas planas. */
const encodePng = (width, height, rgba) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 6; // color RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtro adaptativo
  ihdr[12] = 0; // sin entrelazado

  // Cada scanline lleva delante su byte de filtro.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    raw[target] = 0;
    rgba.copy(raw, target + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ---------------------------------------------------------------------------
// Rasterizador
// ---------------------------------------------------------------------------

/** Distancia con signo de un punto a un rectangulo redondeado. Negativa = dentro. */
const roundedRectDistance = (px, py, cx, cy, halfWidth, halfHeight, radius) => {
  const dx = Math.abs(px - cx) - (halfWidth - radius);
  const dy = Math.abs(py - cy) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
};

/** Distancia de un punto al segmento AB. */
const segmentDistance = (px, py, ax, ay, bx, by) => {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
};

const mix = (a, b, t) => ({
  r: Math.round(a.r + (b.r - a.r) * t),
  g: Math.round(a.g + (b.g - a.g) * t),
  b: Math.round(a.b + (b.b - a.b) * t),
});

/**
 * Dibuja el icono: cuadrado redondeado con degradado y un visto blanco.
 *
 * @param size    lado en pixeles
 * @param padding margen relativo (0..0.5). Los iconos "maskable" de Android
 *                necesitan margen porque el sistema los recorta en circulo.
 * @param monochrome deja el visto en blanco sobre transparente, para el badge de las
 *                notificaciones, donde el sistema aplica su propio color.
 */
const drawIcon = (size, { padding = 0, monochrome = false } = {}) => {
  const pixels = Buffer.alloc(size * size * 4);
  const inset = size * padding;
  const box = size - inset * 2;
  const center = size / 2;
  const half = box / 2;
  const radius = box * 0.235; // Proporcion de esquina tipo iOS.

  // Supermuestreo 3x3: suaviza los bordes sin implementar un antialiasing completo.
  const SAMPLES = 3;
  const step = 1 / (SAMPLES + 1);

  // Geometria del visto, en coordenadas relativas al cuadro.
  const checkStroke = box * 0.115;
  const p1 = { x: center - half * 0.42, y: center + half * 0.04 };
  const p2 = { x: center - half * 0.12, y: center + half * 0.34 };
  const p3 = { x: center + half * 0.44, y: center - half * 0.32 };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgCoverage = 0;
      let checkCoverage = 0;

      for (let sy = 1; sy <= SAMPLES; sy += 1) {
        for (let sx = 1; sx <= SAMPLES; sx += 1) {
          const px = x + sx * step;
          const py = y + sy * step;

          if (roundedRectDistance(px, py, center, center, half, half, radius) <= 0) {
            bgCoverage += 1;
          }

          const distance = Math.min(
            segmentDistance(px, py, p1.x, p1.y, p2.x, p2.y),
            segmentDistance(px, py, p2.x, p2.y, p3.x, p3.y),
          );

          if (distance <= checkStroke / 2) checkCoverage += 1;
        }
      }

      const total = SAMPLES * SAMPLES;
      const bgAlpha = bgCoverage / total;
      const checkAlpha = checkCoverage / total;

      const offset = (y * size + x) * 4;

      if (monochrome) {
        pixels[offset] = WHITE.r;
        pixels[offset + 1] = WHITE.g;
        pixels[offset + 2] = WHITE.b;
        pixels[offset + 3] = Math.round(checkAlpha * 255);
        continue;
      }

      // Degradado diagonal suave, para que no quede un bloque de color plano.
      const gradient = mix(BRAND, BRAND_DARK, (x / size) * 0.5 + (y / size) * 0.5);
      const color = checkAlpha > 0 ? mix(gradient, WHITE, checkAlpha) : gradient;

      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = Math.round(bgAlpha * 255);
    }
  }

  return encodePng(size, size, pixels);
};

/**
 * Envuelve un PNG en un contenedor ICO.
 * Windows Vista en adelante acepta PNG dentro del .ico, asi que no hace falta
 * generar el mapa de bits sin comprimir con su mascara AND.
 */
const pngToIco = (png, size) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: icono
  header.writeUInt16LE(1, 4); // numero de imagenes

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // 0 significa 256
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0; // colores de la paleta
  entry[3] = 0; // reservado
  entry.writeUInt16LE(1, 4); // planos
  entry.writeUInt16LE(32, 6); // bits por pixel
  entry.writeUInt32BE(0, 8);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, png]);
};

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <path d="M18 33.5 L27 42 L46 22" stroke="#fff" stroke-width="7.5"
        stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
`;

// ---------------------------------------------------------------------------

const write = (relativePath, contents) => {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  console.log(`  ${relativePath}  (${(contents.length / 1024).toFixed(1)} KB)`);
};

console.log('Generando iconos...');

write('public/icons/icon-192.png', drawIcon(192));
write('public/icons/icon-512.png', drawIcon(512));
// Android recorta los iconos "maskable": el margen del 10% evita que se coma el visto.
write('public/icons/icon-maskable-512.png', drawIcon(512, { padding: 0.1 }));
write('public/icons/apple-touch-icon.png', drawIcon(180));
write('public/icons/badge-72.png', drawIcon(72, { monochrome: true }));
write('public/icons/favicon.svg', Buffer.from(FAVICON_SVG, 'utf8'));

write('build/icon.png', drawIcon(512));
write('build/icon.ico', pngToIco(drawIcon(256), 256));
write('build/tray-icon.png', drawIcon(32));

console.log('Listo.');
