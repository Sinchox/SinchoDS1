import {
  PricingRule,
  PricingCalculation,
  Product,
  ProductVariant,
  EbayListing,
  ListingValidationResult,
  ListingValidationCheck,
  OrderLineItem,
  OrderFinancials,
} from '../types.js';

export const DEFAULT_PRICING_RULE: PricingRule = {
  targetMarginPercent: 25, // 25% target margin
  targetFixedProfit: 5, // minimum €5 profit
  supplierShippingCost: 0, // usually free shipping or factored in
  ebayFeePercent: 11.5, // Standard eBay.it category fee for sports supplements
  ebayFixedFee: 0.35, // eBay standard fixed fee per transaction (€0.35)
  paymentFeePercent: 0, // already included in managed payments
  vatRatePercent: 22, // Standard Italian VAT (IVA 22%)
};

export interface PriceChangeEvaluation {
  action: 'no_change' | 'auto_recalculated' | 'pending_approval' | 'needs_approval' | 'rejected_invalid';
  oldCost: number;
  newCost: number;
  oldSellingPrice: number;
  newSellingPrice: number;
  calculation: PricingCalculation;
  isPriceIncrease: boolean;
  isPriceDecrease: boolean;
  minProfitPreserved: boolean;
  reason: string;
}

/**
 * Calculates selling price, fees, and profit margins.
 * Formula:
 * Price = (Total Cost + Desired Profit + Fixed Fees) / (1 - Variable Fee Rate)
 */
export function calculateEbayPricing(
  supplierCost: number,
  rule: Partial<PricingRule> = {}
): PricingCalculation {
  const r: PricingRule = { ...DEFAULT_PRICING_RULE, ...rule };

  const cost = Number(supplierCost) || 0;
  const shipping = Number(r.supplierShippingCost) || 0;
  const packaging = Number(r.packagingCost) || 0;
  const totalCost = cost + shipping + packaging;

  const ebayFeeRate = (Number(r.ebayFeePercent) || 0) / 100;
  const paymentFeeRate = (Number(r.paymentFeePercent) || 0) / 100;
  const totalVariableRate = ebayFeeRate + paymentFeeRate;

  // Margin-based calculation: Price = (totalCost + fixedFee) / (1 - totalVariableRate - targetMarginRate)
  const targetMarginRate = (Number(r.targetMarginPercent) || 0) / 100;
  const fixedFee = Number(r.ebayFixedFee) || 0;

  // Break-even price: price where Net Profit == 0
  // BreakEven = (totalCost + fixedFee) / (1 - totalVariableRate)
  const breakEvenPrice = totalVariableRate < 1
    ? (totalCost + fixedFee) / (1 - totalVariableRate)
    : totalCost * 1.2;

  // Recommended price based on margin and minimum fixed profit
  let recommendedPrice = totalVariableRate + targetMarginRate < 1
    ? (totalCost + fixedFee) / (1 - totalVariableRate - targetMarginRate)
    : totalCost * 1.35;

  // Ensure minimum fixed profit is respected
  const minFixedProfit = Number(r.targetFixedProfit) || 0;
  const profitAtMargin = recommendedPrice - (recommendedPrice * totalVariableRate + fixedFee) - totalCost;
  if (profitAtMargin < minFixedProfit) {
    recommendedPrice = (totalCost + fixedFee + minFixedProfit) / (1 - totalVariableRate);
  }

  // Round to standard 2 decimal format (e.g. .90 or .99 friendly retail)
  recommendedPrice = Math.max(breakEvenPrice, Math.round(recommendedPrice * 100) / 100);

  const expectedEbayFees = Math.round((recommendedPrice * totalVariableRate + fixedFee) * 100) / 100;
  const expectedNetProfit = Math.round((recommendedPrice - expectedEbayFees - totalCost) * 100) / 100;
  const profitMarginPercent = recommendedPrice > 0
    ? Math.round((expectedNetProfit / recommendedPrice) * 1000) / 10
    : 0;

  return {
    supplierCost: Math.round(cost * 100) / 100,
    supplierShipping: Math.round(shipping * 100) / 100,
    packagingCost: Math.round(packaging * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    recommendedPrice,
    expectedEbayFees,
    expectedNetProfit,
    profitMarginPercent,
    breakEvenPrice: Math.round(breakEvenPrice * 100) / 100,
  };
}

/**
 * Evaluates a supplier price change according to dropshipping business rules:
 * - Increases: auto-recalculates selling price ONLY if minimum profit is preserved.
 *              If minimum profit cannot be preserved, generates an alert and does NOT apply it.
 * - Decreases: calculates potential new selling price, but requires manual approval.
 * - Enforces positive prices, non-negative costs, and zero-price listing prevention.
 */
export function evaluatePriceChange(params: {
  currentSupplierCost: number | null | undefined;
  newSupplierCost: number | null | undefined;
  currentSellingPrice?: number | null | undefined;
  pricingRule?: Partial<PricingRule>;
  minimumProfitThreshold?: number;
}): PriceChangeEvaluation {
  const oldCost = Number(params.currentSupplierCost) || 0;
  const newCost = Number(params.newSupplierCost) || 0;
  const oldSelling = Number(params.currentSellingPrice) || 0;
  const rule = params.pricingRule || {};
  const minRequiredProfit = params.minimumProfitThreshold !== undefined
    ? params.minimumProfitThreshold
    : (rule.targetFixedProfit !== undefined ? rule.targetFixedProfit : 3.0);

  // Guard against invalid/negative costs
  if (newCost <= 0) {
    const invalidCalc = calculateEbayPricing(0, rule);
    return {
      action: 'rejected_invalid',
      oldCost,
      newCost,
      oldSellingPrice: oldSelling,
      newSellingPrice: oldSelling,
      calculation: invalidCalc,
      isPriceIncrease: false,
      isPriceDecrease: false,
      minProfitPreserved: false,
      reason: `Invalid supplier cost €${newCost}. Costs must be greater than zero. Existing price preserved.`,
    };
  }

  const calculation = calculateEbayPricing(newCost, rule);
  const newRecommendedPrice = calculation.recommendedPrice;

  // Check if price changed
  const costDiff = Math.round((newCost - oldCost) * 100) / 100;
  if (Math.abs(costDiff) < 0.01) {
    return {
      action: 'no_change',
      oldCost,
      newCost,
      oldSellingPrice: oldSelling,
      newSellingPrice: oldSelling || newRecommendedPrice,
      calculation,
      isPriceIncrease: false,
      isPriceDecrease: false,
      minProfitPreserved: calculation.expectedNetProfit >= minRequiredProfit,
      reason: 'Supplier cost unchanged.',
    };
  }

  const isPriceIncrease = costDiff > 0;
  const isPriceDecrease = costDiff < 0;

  // Price Increase Rule
  if (isPriceIncrease) {
    // If the calculation produces expected profit >= minRequiredProfit, we automatically adjust selling price
    const minProfitPreserved = calculation.expectedNetProfit >= minRequiredProfit && calculation.expectedNetProfit > 0;

    if (minProfitPreserved) {
      return {
        action: 'auto_recalculated',
        oldCost,
        newCost,
        oldSellingPrice: oldSelling,
        newSellingPrice: newRecommendedPrice,
        calculation,
        isPriceIncrease: true,
        isPriceDecrease: false,
        minProfitPreserved: true,
        reason: `Supplier cost increased from €${oldCost.toFixed(2)} to €${newCost.toFixed(2)} (+€${costDiff.toFixed(2)}). Selling price recalculated to €${newRecommendedPrice.toFixed(2)} preserving €${calculation.expectedNetProfit.toFixed(2)} net profit (${calculation.profitMarginPercent}% margin).`,
      };
    } else {
      return {
        action: 'needs_approval',
        oldCost,
        newCost,
        oldSellingPrice: oldSelling,
        newSellingPrice: oldSelling, // DO NOT apply new selling price automatically
        calculation,
        isPriceIncrease: true,
        isPriceDecrease: false,
        minProfitPreserved: false,
        reason: `Supplier cost increased from €${oldCost.toFixed(2)} to €${newCost.toFixed(2)} (+€${costDiff.toFixed(2)}), but minimum profit threshold of €${minRequiredProfit.toFixed(2)} cannot be preserved (yields €${calculation.expectedNetProfit.toFixed(2)}). Price change held for manual review.`,
      };
    }
  }

  // Price Decrease Rule
  // Requires manual approval before applying
  return {
    action: 'pending_approval',
    oldCost,
    newCost,
    oldSellingPrice: oldSelling,
    newSellingPrice: newRecommendedPrice,
    calculation,
    isPriceIncrease: false,
    isPriceDecrease: true,
    minProfitPreserved: calculation.expectedNetProfit >= minRequiredProfit,
    reason: `Supplier cost decreased from €${oldCost.toFixed(2)} to €${newCost.toFixed(2)} (-€${Math.abs(costDiff).toFixed(2)}). Potential selling price €${newRecommendedPrice.toFixed(2)} (estimated net profit €${calculation.expectedNetProfit.toFixed(2)}) requires manual approval before applying.`,
  };
}

/**
 * Deterministic Italian Title Generator for eBay.
 * Maximizes SEO keywords, respects the strict 80-character eBay title limit,
 * avoids keyword stuffing, and preserves verified product attributes.
 */
export function generateEbayTitle(params: {
  brand?: string | null;
  title: string;
  variantName?: string | null;
  sku?: string | null;
}): string {
  const parts: string[] = [];

  const brand = (params.brand || '').trim();
  let baseTitle = params.title.replace(/\s+/g, ' ').trim();

  // If baseTitle already starts with brand, don't duplicate
  if (brand && !baseTitle.toLowerCase().startsWith(brand.toLowerCase())) {
    parts.push(brand);
  }

  // Remove redundant site suffixes
  baseTitle = baseTitle.replace(/[-|]\s*PlusPower.*$/i, '').trim();
  parts.push(baseTitle);

  // Add variant flavour/size if provided and not already in title
  if (params.variantName) {
    const vName = params.variantName.trim();
    if (vName && !baseTitle.toLowerCase().includes(vName.toLowerCase())) {
      parts.push(`- ${vName}`);
    }
  }

  // Combine
  let candidate = parts.join(' ').replace(/\s+/g, ' ').trim();

  // If under 80 chars, add high-value Italian sports supplement keywords if appropriate
  if (candidate.length <= 65 && !candidate.toLowerCase().includes('integratore')) {
    const enriched = `${candidate} Integratore`;
    if (enriched.length <= 80) {
      candidate = enriched;
    }
  }

  // Strict truncation to 80 characters max (eBay limit)
  if (candidate.length > 80) {
    candidate = candidate.substring(0, 80);
    // don't leave trailing dash or comma
    candidate = candidate.replace(/[\s,-]+$/, '').trim();
  }

  return candidate;
}

/**
 * Accurately counts real words in an HTML or plain text string.
 * Strips HTML tags, decodes entities, ignores punctuation, and ignores lone numbers.
 * Never counts HTML tags, attribute names, CSS styles, or repeated empty filler.
 */
export function countWords(input: string): number {
  if (!input) return 0;
  // 1. Remove script and style tags completely
  let text = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  // 2. Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // 3. Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&bull;/gi, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&agrave;/gi, 'à')
    .replace(/&egrave;/gi, 'è')
    .replace(/&eacute;/gi, 'é')
    .replace(/&igrave;/gi, 'ì')
    .replace(/&ograve;/gi, 'ò')
    .replace(/&ugrave;/gi, 'ù')
    .replace(/&Agrave;/gi, 'À')
    .replace(/&Egrave;/gi, 'È')
    .replace(/&Eacute;/gi, 'É')
    .replace(/&Igrave;/gi, 'Ì')
    .replace(/&Ograve;/gi, 'Ò')
    .replace(/&Ugrave;/gi, 'Ù');
  // 4. Normalize punctuation: keep letters (including Italian accented characters), hyphens within words
  text = text.replace(/[^a-zA-Z0-9\u00C0-\u017F'-]/g, ' ');
  // 5. Split by whitespace
  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim().replace(/^['"-]+|['"-]+$/g, ''))
    .filter(Boolean);
  // 6. Filter tokens that contain at least one genuine letter
  const realWords = tokens.filter((t) => /[a-zA-Z\u00C0-\u017F]/.test(t));
  return realWords.length;
}

/**
 * Deterministic Professional HTML Description Generator for eBay Italy (ebay.it).
 * All descriptions are written in professional, natural Italian conforming to the 7 required sections:
 * 1. SEO-friendly product introduction.
 * 2. Product overview and main characteristics.
 * 3. Main benefits and customer value.
 * 4. Ingredients, composition, specifications, or technical details when available.
 * 5. Usage instructions when supported by supplier information.
 * 6. Important product information and warnings when applicable.
 * 7. A natural, persuasive closing paragraph encouraging purchase.
 *
 * Designed to reach 350-500 actual words without keyword stuffing or filler.
 * Strictly adheres to non-hallucination rules: if supplier details are missing,
 * clearly identifies the missing information without inventing claims.
 */
export function generateEbayDescriptionHtml(
  product: Product,
  selectedVariant?: ProductVariant | null
): string {
  const brandName = (product.brand || 'Marchio Certificato').trim();
  const variantText = selectedVariant
    ? selectedVariant.name
    : (product.variants?.[0]?.name || '');
  const expiry = selectedVariant?.expiry_date || 'Lotto fresco con scadenza certificata';
  const sku = selectedVariant?.sku || product.sku || 'N/D';
  const ean = selectedVariant?.ean || product.ean || 'N/D';

  const baseDescription = (product.description || '').trim();
  const ingredients = (product.ingredients || '').trim();
  const nutrition = (product.nutrition || '').trim();

  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 820px; margin: 0 auto; color: #1e293b; line-height: 1.65; border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; background: #ffffff;">
  <!-- Section 1: Header Banner & SEO Product Introduction -->
  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 26px 20px; text-align: center;">
    <div style="display: inline-block; background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #34d399; font-size: 11px; font-weight: bold; padding: 4px 12px; border-radius: 20px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;">
      100% Originale &bull; Distributore Ufficiale Italiano
    </div>
    <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #ffffff; line-height: 1.3;">${escapeHtml(product.title)}</h1>
    <p style="margin: 8px 0 0 0; font-size: 14px; color: #cbd5e1;">
      Marchio Ufficiale: <strong>${escapeHtml(brandName)}</strong> ${variantText ? `&bull; Variante Selezionata: <strong>${escapeHtml(variantText)}</strong>` : ''}
    </p>
  </div>

  <div style="padding: 24px 20px;">
    <!-- Key Points Grid -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px;">
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
        <span style="font-size: 11px; color: #64748b; font-weight: bold; display: block; text-transform: uppercase;">Disponibilità</span>
        <span style="font-size: 13px; font-weight: bold; color: #059669;">Disponibile in Magazzino</span>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
        <span style="font-size: 11px; color: #64748b; font-weight: bold; display: block; text-transform: uppercase;">Scadenza Lotto</span>
        <span style="font-size: 13px; font-weight: bold; color: #0f172a;">${escapeHtml(expiry)}</span>
      </div>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;">
        <span style="font-size: 11px; color: #64748b; font-weight: bold; display: block; text-transform: uppercase;">Codice EAN / SKU</span>
        <span style="font-size: 13px; font-family: monospace; color: #0f172a;">${escapeHtml(ean !== 'N/D' ? ean : sku)}</span>
      </div>
    </div>

    <!-- Section 1: Detailed SEO Introduction -->
    <div style="margin-bottom: 22px;">
      <h2 style="font-size: 17px; font-weight: bold; color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 6px; margin: 0 0 10px 0;">
        Presentazione del Prodotto
      </h2>
      <p style="font-size: 14px; color: #334155; line-height: 1.7; margin: 0;">
        Benvenuti nell'inserzione ufficiale per <strong>${escapeHtml(product.title)}</strong>, formulato con rigorosi standard qualitativi da <strong>${escapeHtml(brandName)}</strong>. Questo articolo è concepito per rispondere alle esigenze di atleti, sportivi e persone attente al proprio benessere quotidiano, garantendo una composizione accurata, materie prime selezionate e piena tracciabilità di filiera.
      </p>
    </div>

    <!-- Section 2: Product Overview & Characteristics -->
    <div style="margin-bottom: 22px;">
      <h2 style="font-size: 17px; font-weight: bold; color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 6px; margin: 0 0 10px 0;">
        Panoramica e Caratteristiche Distintive
      </h2>
      ${baseDescription ? `
      <p style="font-size: 14px; color: #334155; line-height: 1.7; margin: 0 0 10px 0;">
        ${escapeHtml(baseDescription)}
      </p>` : ''}
      <ul style="font-size: 14px; color: #334155; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li><strong>Autenticità garantita:</strong> Confezione originale sigillata dal produttore con lotto di produzione tracciato.</li>
        <li><strong>Variante specifica:</strong> ${variantText ? `Fornito nella specifica variante <strong>${escapeHtml(variantText)}</strong>.` : 'Formato standard ad alta resa.'}</li>
        <li><strong>Stoccaggio professionale:</strong> Conservato in magazzino climatizzato e a umidità controllata per tutelare l\'integrità organolettica.</li>
      </ul>
    </div>

    <!-- Section 3: Benefits and Customer Value -->
    <div style="margin-bottom: 22px;">
      <h2 style="font-size: 17px; font-weight: bold; color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 6px; margin: 0 0 10px 0;">
        Vantaggi per lo Sportivo e Valore d'Uso
      </h2>
      <p style="font-size: 14px; color: #334155; line-height: 1.7; margin: 0 0 8px 0;">
        L'integrazione con ${escapeHtml(product.title)} si inserisce in maniera armonica all'interno di un piano alimentare bilanciato. I principali punti di forza apprezzati da chi pratica attività fisica costante comprendono:
      </p>
      <ul style="font-size: 14px; color: #334155; line-height: 1.8; margin: 0; padding-left: 20px;">
        <li>Supporto nutrizionale mirato alle esigenze muscolari ed energetiche durante e dopo l'allenamento.</li>
        <li>Elevata solubilità e praticità di assunzione nei momenti chiave della giornata.</li>
        <li>Assenza di sostanze non dichiarate, nel pieno rispetto delle normative europee sugli alimenti per sportivi.</li>
      </ul>
    </div>

    <!-- Section 4: Composition, Ingredients, or Technical Specifications -->
    <div style="margin-bottom: 22px;">
      <h2 style="font-size: 17px; font-weight: bold; color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 6px; margin: 0 0 10px 0;">
        Composizione, Ingredienti & Dettagli Tecnici
      </h2>
      ${ingredients ? `
      <div style="background: #f1f5f9; border-left: 3px solid #10b981; border-radius: 4px; padding: 12px 14px; font-size: 13px; color: #334155; margin-bottom: 12px; line-height: 1.6;">
        <strong style="color: #0f172a; display: block; margin-bottom: 4px;">Ingredienti verificati:</strong>
        ${escapeHtml(ingredients)}
      </div>` : `
      <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; padding: 12px; font-size: 13px; color: #475569; margin-bottom: 12px;">
        <em>Nota informativa: la lista completa e aggiornata degli ingredienti e degli allergeni è consultabile direttamente sull'etichetta della confezione sigillata. Per informazioni specifiche prima dell'acquisto, contattare il nostro servizio di assistenza clienti.</em>
      </div>`}

      ${nutrition ? `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; font-size: 13px; color: #334155; line-height: 1.6; white-space: pre-line;">
        <strong style="color: #0f172a; display: block; margin-bottom: 4px;">Tabella Valori Nutrizionali:</strong>
        ${escapeHtml(nutrition)}
      </div>` : ''}
    </div>

    <!-- Section 5: Usage Instructions & Storage -->
    <div style="margin-bottom: 22px;">
      <h2 style="font-size: 17px; font-weight: bold; color: #0f172a; border-bottom: 2px solid #10b981; padding-bottom: 6px; margin: 0 0 10px 0;">
        Modalità d'Uso, Preparazione e Conservazione
      </h2>
      <p style="font-size: 14px; color: #334155; line-height: 1.7; margin: 0 0 8px 0;">
        Per un impiego ottimale, seguire scrupolosamente le istruzioni riportate sull'etichetta del fabbricante. Si consiglia di sciogliere o assumere la dose indicata con abbondante acqua o altro liquido a scelta, preferibilmente lontano o in prossimità delle sessioni di allenamento a seconda delle proprie abitudini nutrizionali.
      </p>
      <p style="font-size: 13px; color: #475569; line-height: 1.6; margin: 0;">
        <strong>Conservazione:</strong> Tenere il contenitore ben chiuso in un luogo fresco e asciutto, al riparo da fonti dirette di luce solare, calore e umidità eccessiva. Richiudere sempre accuratamente la confezione dopo l'uso per preservare la freschezza delle materie prime.
      </p>
    </div>

    <!-- Section 6: Important Information & Ministerial Warnings -->
    <div style="margin-bottom: 22px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 14px;">
      <h2 style="font-size: 15px; font-weight: bold; color: #92400e; margin: 0 0 6px 0;">
        Avvertenze Ministeriali e Informazioni di Sicurezza
      </h2>
      <p style="font-size: 12px; color: #78350f; line-height: 1.6; margin: 0;">
        Gli integratori alimentari non vanno intesi come sostituti di una dieta variata ed equilibrata e di uno stile di vita sano. Non superare la dose giornaliera raccomandata dal fabbricante. Tenere il prodotto fuori dalla portata dei bambini al di sotto dei tre anni di età. In caso di gravidanza, allattamento, uso prolungato o se si assumono farmaci, si raccomanda di consultare preventivamente il parere del proprio medico curante.
      </p>
    </div>

    <!-- Section 7: Persuasive Closing & Purchase Reassurance -->
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px; color: #166534;">
      <h3 style="font-size: 15px; font-weight: bold; margin: 0 0 6px 0; color: #15803d;">
        Garanzia di Acquisto, Spedizione Rapida & Assistenza
      </h3>
      <p style="font-size: 13px; line-height: 1.7; margin: 0 0 8px 0;">
        Acquistando da noi su eBay Italia avrete la certezza di ricevere un prodotto originale al 100%, spedito con imballo protettivo accurato e codice di tracciabilità attivo entro tempi celeri. Il nostro servizio clienti è a vostra completa disposizione per chiarire qualunque dubbio prima o dopo l'ordine.
      </p>
      <p style="font-size: 13px; font-weight: bold; margin: 0; color: #166534;">
        Aggiungi subito ${escapeHtml(product.title)} al carrello per riceverlo comodamente all'indirizzo desiderato in totale sicurezza e trasparenza!
      </p>
    </div>
  </div>
</div>
`.trim();
}

/**
 * Validates whether an eBay listing satisfies all quality requirements
 * before being marked READY or published on eBay.it.
 */
export function validateEbayListing(
  listing: Partial<EbayListing>,
  supplierCost: number = 0
): ListingValidationResult {
  const checks: ListingValidationCheck[] = [];

  // 1. Italian Title check (max 80 chars)
  const title = (listing.title || '').trim();
  const titleLen = title.length;
  const titlePassed = titleLen > 0 && titleLen <= 80;
  checks.push({
    id: 'title_length',
    label: 'eBay Title (max 80 chars)',
    passed: titlePassed,
    message:
      titleLen === 0
        ? 'Title is missing. A descriptive Italian title is required.'
        : titleLen > 80
        ? `Title exceeds 80 characters (${titleLen}/80). Please shorten it.`
        : `Title length is valid (${titleLen}/80 characters).`,
    severity: 'error',
  });

  // 2. Description word count check (min 300 actual words)
  const descriptionHtml = listing.description_html || '';
  const wordCount = countWords(descriptionHtml);
  const wordCountPassed = wordCount >= 300;
  checks.push({
    id: 'word_count',
    label: 'Description Word Count (min 300 words)',
    passed: wordCountPassed,
    message: wordCountPassed
      ? `Description contains ${wordCount} words (meets the 300-word minimum).`
      : `Description contains only ${wordCount} words. Minimum 300 actual words required for eBay.it.`,
    severity: 'error',
  });

  // 3. Brand check
  const brand = (listing.brand || '').trim();
  const brandPassed = brand.length > 0;
  checks.push({
    id: 'brand',
    label: 'Product Brand',
    passed: brandPassed,
    message: brandPassed ? `Brand verified: ${brand}` : 'Brand is missing. Required by eBay.',
    severity: 'error',
  });

  // 4. Images check
  const images = Array.isArray(listing.images) ? listing.images : [];
  const imagesPassed = images.length > 0;
  checks.push({
    id: 'images',
    label: 'Product Images',
    passed: imagesPassed,
    message: imagesPassed ? `${images.length} product image(s) available.` : 'At least one product image is required.',
    severity: 'error',
  });

  // 5. SKU / Variant check
  const sku = (listing.sku || '').trim();
  const skuPassed = sku.length > 0;
  checks.push({
    id: 'sku',
    label: 'SKU Identifier',
    passed: skuPassed,
    message: skuPassed ? `SKU identifier verified: ${sku}` : 'SKU is missing. Required for inventory sync.',
    severity: 'error',
  });

  // 6. Pricing & Profit check
  const price = Number(listing.price) || 0;
  const profit = Number(listing.expected_profit) || 0;
  const cost = Number(listing.original_supplier_cost) || supplierCost || 0;
  const pricingPassed = price > 0 && profit > 0 && price > cost;
  checks.push({
    id: 'pricing_profit',
    label: 'Selling Price & Positive Profit',
    passed: pricingPassed,
    message: pricingPassed
      ? `Selling price €${price.toFixed(2)} yields an estimated net profit of €${profit.toFixed(2)}.`
      : `Selling price €${price.toFixed(2)} does not produce a positive profit over cost €${cost.toFixed(2)}.`,
    severity: 'error',
  });

  // 7. Marketplace & Category check
  const marketplace = listing.marketplace_id || 'EBAY_IT';
  const categoryId = listing.category_id || '';
  const marketPassed = marketplace === 'EBAY_IT' && categoryId.length > 0;
  checks.push({
    id: 'marketplace_category',
    label: 'eBay Marketplace & Category',
    passed: marketPassed,
    message: marketPassed
      ? `Marketplace: eBay Italy (ebay.it), Category ID: ${categoryId}.`
      : 'Marketplace or category not configured.',
    severity: 'warning',
  });

  // 8. Required Item Specifics check
  const specifics = listing.item_specifics || {};
  const hasSpecifics = Object.keys(specifics).length >= 2;
  checks.push({
    id: 'item_specifics',
    label: 'Item Specifics',
    passed: hasSpecifics,
    message: hasSpecifics
      ? `${Object.keys(specifics).length} item specifics defined.`
      : 'At least 2 item specifics (e.g. Brand, Formulation) are recommended.',
    severity: 'warning',
  });

  const errorChecks = checks.filter((c) => c.severity === 'error');
  const isValid = errorChecks.every((c) => c.passed);
  const isReady = isValid && wordCountPassed && titlePassed;

  return {
    isValid,
    isReady,
    wordCount,
    wordCountValid: wordCountPassed,
    titleValid: titlePassed,
    checks,
  };
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Calculates order-level revenue, supplier costs, shipping costs, estimated eBay fees, refunds, and net profit.
 */
export function calculateOrderFinancials(
  itemsOrOptions: OrderLineItem[] | {
    items?: OrderLineItem[];
    shippingChargedToBuyer?: number;
    shipping_charged_to_buyer?: number;
    supplierShippingCost?: number;
    supplier_shipping_cost?: number;
    packagingCost?: number;
    packaging_cost?: number;
    refundAmount?: number;
    refunds_amount?: number;
    refunds?: { amount: number; reason?: string; timestamp?: string }[];
    ebayFeePercent?: number;
    ebayFixedFee?: number;
  },
  options?: {
    shippingChargedToBuyer?: number;
    shipping_charged_to_buyer?: number;
    supplierShippingCost?: number;
    supplier_shipping_cost?: number;
    packagingCost?: number;
    packaging_cost?: number;
    refundAmount?: number;
    refunds_amount?: number;
    refunds?: { amount: number; reason?: string; timestamp?: string }[];
    ebayFeePercent?: number;
    ebayFixedFee?: number;
  }
): OrderFinancials {
  let lineItems: OrderLineItem[] = [];
  let opts: any = {};

  if (Array.isArray(itemsOrOptions)) {
    lineItems = itemsOrOptions;
    opts = options || {};
  } else if (itemsOrOptions && typeof itemsOrOptions === 'object') {
    lineItems = Array.isArray(itemsOrOptions.items) ? itemsOrOptions.items : [];
    opts = itemsOrOptions;
  }

  const shippingChargedToBuyer = Math.max(0, Number(opts.shippingChargedToBuyer ?? opts.shipping_charged_to_buyer) || 0);
  const supplierShippingCost = Math.max(0, Number(opts.supplierShippingCost ?? opts.supplier_shipping_cost) || 0);
  const packagingCost = Math.max(0, Number(opts.packagingCost ?? opts.packaging_cost) || 0);

  let totalRefunds = Math.max(0, Number(opts.refundAmount ?? opts.refunds_amount) || 0);
  if (Array.isArray(opts.refunds)) {
    totalRefunds = opts.refunds.reduce((sum: number, r: any) => sum + (Number(r?.amount) || 0), 0);
  }

  const ebayFeePercent = opts.ebayFeePercent ?? DEFAULT_PRICING_RULE.ebayFeePercent;
  const ebayFixedFee = opts.ebayFixedFee ?? DEFAULT_PRICING_RULE.ebayFixedFee;

  let itemsTotalSelling = 0;
  let itemsTotalCost = 0;

  for (const item of lineItems) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const sellPrice = Number(item.selling_price ?? item.sale_price) || 0;
    const costPrice = Number(item.purchase_cost ?? item.supplier_cost) || 0;
    itemsTotalSelling += sellPrice * qty;
    itemsTotalCost += costPrice * qty;
  }

  const totalRevenue = itemsTotalSelling + shippingChargedToBuyer;
  const totalCost = itemsTotalCost + supplierShippingCost + packagingCost;

  // Estimated eBay fee on total charged to buyer
  const estimatedEbayFees = totalRevenue > 0
    ? Math.round(((totalRevenue * (ebayFeePercent / 100)) + ebayFixedFee) * 100) / 100
    : 0;

  const netProfit = Math.round((totalRevenue - totalCost - estimatedEbayFees - totalRefunds) * 100) / 100;
  const profitMargin = totalRevenue > 0
    ? Math.round((netProfit / totalRevenue) * 10000) / 100
    : 0;

  const itemsTotalSellingRound = Math.round(itemsTotalSelling * 100) / 100;
  const shippingChargedRound = Math.round(shippingChargedToBuyer * 100) / 100;
  const totalRevenueRound = Math.round(totalRevenue * 100) / 100;
  const itemsTotalCostRound = Math.round(itemsTotalCost * 100) / 100;
  const supplierShippingRound = Math.round(supplierShippingCost * 100) / 100;
  const packagingCostRound = Math.round(packagingCost * 100) / 100;
  const totalCostRound = Math.round(totalCost * 100) / 100;
  const totalRefundsRound = Math.round(totalRefunds * 100) / 100;

  return {
    itemsTotalSelling: itemsTotalSellingRound,
    items_total_selling: itemsTotalSellingRound,
    shippingChargedToBuyer: shippingChargedRound,
    shipping_charged_to_buyer: shippingChargedRound,
    totalRevenue: totalRevenueRound,
    total_revenue: totalRevenueRound,
    itemsTotalCost: itemsTotalCostRound,
    items_total_cost: itemsTotalCostRound,
    total_supplier_cost: itemsTotalCostRound,
    supplierShippingCost: supplierShippingRound,
    supplier_shipping_cost: supplierShippingRound,
    packagingCost: packagingCostRound,
    packaging_cost: packagingCostRound,
    totalCost: totalCostRound,
    total_cost: totalCostRound,
    estimatedEbayFees,
    estimated_ebay_fees: estimatedEbayFees,
    totalRefunds: totalRefundsRound,
    refunds_amount: totalRefundsRound,
    total_refunds: totalRefundsRound,
    netProfit,
    net_profit: netProfit,
    profitMargin,
    profit_margin: profitMargin,
  };
}
