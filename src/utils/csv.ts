import { Product, ProductVariant } from '../types.js';

/**
 * Escapes a single CSV cell value according to RFC 4180.
 */
function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates CSV string for Products only.
 */
export function generateProductsCsv(products: Product[]): string {
  const headers = [
    'ID',
    'Titolo',
    'Marca',
    'Categoria',
    'Prezzo',
    'Prezzo Originale',
    'Sconto %',
    'Valuta',
    'SKU',
    'EAN',
    'Disponibilita',
    'Quantita Stock',
    'Numero Varianti',
    'URL',
    'Fonte Importazione',
    'Stato',
    'Data Importazione',
  ];

  const rows = products.map((p) => [
    p.id,
    p.title,
    p.brand || '',
    p.category || '',
    p.price !== null ? p.price : '',
    p.original_price !== null ? p.original_price : '',
    p.discount_percentage !== null ? p.discount_percentage : '',
    p.currency || 'EUR',
    p.sku || '',
    p.ean || '',
    p.availability || '',
    p.stock_quantity !== null ? p.stock_quantity : '',
    p.variants ? p.variants.length : 0,
    p.url,
    p.import_source,
    p.status,
    p.created_at,
  ]);

  const csvContent = [headers.join(','), ...rows.map((row) => row.map(escapeCsvCell).join(','))].join('\r\n');

  // Prepend UTF-8 BOM so Excel and iPhone Numbers correctly open Italian accented characters
  return '\uFEFF' + csvContent;
}

/**
 * Generates CSV string for Variants only.
 */
export function generateVariantsCsv(products: Product[]): string {
  const headers = [
    'ID Variante',
    'ID Prodotto',
    'Titolo Prodotto',
    'Marca Prodotto',
    'Nome Variante / Gusto',
    'Codice Variante (ID)',
    'SKU Variante',
    'EAN Variante',
    'Prezzo Variante',
    'Prezzo Originale',
    'Stock Variante',
    'Disponibilita',
    'Scadenza Lotto',
    'Disponibile Online',
    'URL Prodotto',
  ];

  const rows: any[][] = [];

  for (const p of products) {
    if (!p.variants || p.variants.length === 0) continue;
    for (const v of p.variants) {
      rows.push([
        v.id,
        p.id,
        p.title,
        p.brand || '',
        v.name,
        v.variant_id || '',
        v.sku || '',
        v.ean || '',
        v.price !== null ? v.price : '',
        v.original_price !== null ? v.original_price : '',
        v.stock_quantity !== null ? v.stock_quantity : '',
        v.availability || '',
        v.expiry_date || '',
        v.available_online !== null ? (v.available_online ? 'Si' : 'No') : '',
        p.url,
      ]);
    }
  }

  const csvContent = [headers.join(','), ...rows.map((row) => row.map(escapeCsvCell).join(','))].join('\r\n');
  return '\uFEFF' + csvContent;
}

/**
 * Generates a Combined CSV (one row per variant, or row for product if no variants).
 */
export function generateCombinedCsv(products: Product[]): string {
  const headers = [
    'ID Prodotto',
    'Titolo Prodotto',
    'Marca',
    'Categoria',
    'Prezzo Base',
    'Prezzo Orig Base',
    'Valuta',
    'SKU Prodotto',
    'EAN Prodotto',
    'Disponibilita Prodotto',
    'Stock Totale',
    'ID Variante',
    'Nome Variante',
    'SKU Variante',
    'EAN Variante',
    'Prezzo Variante',
    'Stock Variante',
    'Scadenza Variante',
    'URL Prodotto',
    'Fonte',
    'Data Importazione',
  ];

  const rows: any[][] = [];

  for (const p of products) {
    if (!p.variants || p.variants.length === 0) {
      rows.push([
        p.id,
        p.title,
        p.brand || '',
        p.category || '',
        p.price !== null ? p.price : '',
        p.original_price !== null ? p.original_price : '',
        p.currency,
        p.sku || '',
        p.ean || '',
        p.availability || '',
        p.stock_quantity !== null ? p.stock_quantity : '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        p.url,
        p.import_source,
        p.created_at,
      ]);
    } else {
      for (const v of p.variants) {
        rows.push([
          p.id,
          p.title,
          p.brand || '',
          p.category || '',
          p.price !== null ? p.price : '',
          p.original_price !== null ? p.original_price : '',
          p.currency,
          p.sku || '',
          p.ean || '',
          p.availability || '',
          p.stock_quantity !== null ? p.stock_quantity : '',
          v.id,
          v.name,
          v.sku || '',
          v.ean || '',
          v.price !== null ? v.price : '',
          v.stock_quantity !== null ? v.stock_quantity : '',
          v.expiry_date || '',
          p.url,
          p.import_source,
          p.created_at,
        ]);
      }
    }
  }

  const csvContent = [headers.join(','), ...rows.map((row) => row.map(escapeCsvCell).join(','))].join('\r\n');
  return '\uFEFF' + csvContent;
}

/**
 * Triggers native browser download for CSV string.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
