/**
 * YNAB budget ingestion logic for the Budget Planner (income-allocation).
 *
 * Maps YNAB budget categories into the four conscious-spending buckets used by
 * the "I Will Teach You to Be Rich" methodology (fixed costs, short-term
 * savings, long-term savings, guilt-free spending) and summarizes their monthly
 * allocation proportions.
 *
 * Extracted from income-allocation.html for testability. The HTML file keeps an
 * inline copy of this logic so the page can run without a module bundler; keep
 * the two in sync when changing the mapping rules.
 */

/**
 * The four allocation buckets, in display order.
 */
export const BUCKET_KEYS = ['fixedCosts', 'shortTerm', 'longTerm', 'guiltFree'];

/**
 * Category groups that should never be treated as spending allocations.
 * "Internal Master Category" holds YNAB's Ready-to-Assign / inflow categories,
 * and "Credit Card Payments" mirrors spending already counted elsewhere.
 */
const EXCLUDED_GROUP_PATTERNS = /internal master category|credit card payments/i;

/**
 * Map a YNAB category (and optionally its group) to a conscious-spending bucket.
 *
 * @param {string} categoryName - YNAB category name
 * @param {string} [groupName] - Owning category group name (improves accuracy)
 * @returns {('fixedCosts'|'shortTerm'|'longTerm'|'guiltFree'|null)} Bucket key,
 *   or null when the category is income/inflow and should be excluded.
 */
export function mapYnabCategoryToBucket(categoryName, groupName = '') {
  const text = `${categoryName || ''} ${groupName || ''}`.toLowerCase().trim();
  if (!text) return 'guiltFree';

  // Income / inflow — not an allocation bucket
  if (/income|inflow|ready to assign|to be budgeted|paycheck/i.test(text)) return null;

  // Long-term / investments (check before generic savings so "retirement
  // savings" lands in long-term rather than short-term)
  if (/invest|retire|401k|403b|\bira\b|roth|brokerage|pension|\bhsa\b/i.test(text)) {
    return 'longTerm';
  }

  // Short-term / savings goals
  if (
    /saving|emergency|vacation|sinking|rainy.?day|travel fund|gift fund|holiday fund/i.test(text)
  ) {
    return 'shortTerm';
  }

  // Fixed costs — recurring obligations
  if (
    /rent|mortgage|utilit|electric|gas bill|water|internet|phone|cell|insurance|grocer|car payment|auto loan|loan|debt|minimum|childcare|daycare|tuition|medical|pharmacy|doctor|subscription|hoa|property tax/i.test(
      text
    )
  ) {
    return 'fixedCosts';
  }

  // Everything else is discretionary → guilt-free spending
  return 'guiltFree';
}

/**
 * Convert per-bucket dollar amounts into integer percentages that sum to 100.
 * Uses the largest-remainder method so the displayed percentages add up exactly.
 *
 * @param {Object} buckets - Dollar amount per bucket key
 * @param {number} total - Sum of all bucket amounts
 * @returns {Object} Integer percentage per bucket key (sums to 100, or all 0)
 */
export function toPercentages(buckets, total) {
  if (!total || total <= 0) {
    return { fixedCosts: 0, shortTerm: 0, longTerm: 0, guiltFree: 0 };
  }

  const entries = BUCKET_KEYS.map((key) => {
    const exact = (buckets[key] / total) * 100;
    const floor = Math.floor(exact);
    return { key, floor, frac: exact - floor };
  });

  const result = {};
  for (const entry of entries) result[entry.key] = entry.floor;

  const remainder = 100 - entries.reduce((sum, entry) => sum + entry.floor, 0);
  // Distribute the leftover to the buckets with the largest fractional parts.
  const byFrac = [...entries].sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < remainder && i < byFrac.length; i++) {
    result[byFrac[i].key] += 1;
  }

  return result;
}

/**
 * Summarize a YNAB budget's category groups into bucket allocations.
 *
 * Expects the `category_groups` array from the YNAB
 * `GET /budgets/{budget_id}/categories` response, whose `budgeted`/`activity`
 * values reflect the current month (in milliunits, 1000 = $1.00).
 *
 * @param {Object[]} categoryGroups - YNAB category groups
 * @returns {{
 *   buckets: Object,
 *   percentages: Object,
 *   totalMonthly: number,
 *   breakdown: Array<{name: string, group: string, bucket: string, dollars: number}>,
 *   categoryCount: number
 * }} Aggregated allocation summary
 */
export function summarizeYnabBudget(categoryGroups) {
  const buckets = { fixedCosts: 0, shortTerm: 0, longTerm: 0, guiltFree: 0 };
  const breakdown = [];

  for (const group of categoryGroups || []) {
    if (!group || group.deleted || group.hidden) continue;
    if (EXCLUDED_GROUP_PATTERNS.test(group.name || '')) continue;

    for (const cat of group.categories || []) {
      if (!cat || cat.deleted || cat.hidden) continue;

      // YNAB amounts are in milliunits (1000 = $1.00)
      const dollars = (cat.budgeted || 0) / 1000;
      if (dollars <= 0) continue;

      const bucket = mapYnabCategoryToBucket(cat.name, group.name);
      if (!bucket) continue; // income / excluded category

      buckets[bucket] += dollars;
      breakdown.push({ name: cat.name, group: group.name, bucket, dollars });
    }
  }

  const totalMonthly = BUCKET_KEYS.reduce((sum, key) => sum + buckets[key], 0);
  const percentages = toPercentages(buckets, totalMonthly);

  return {
    buckets,
    percentages,
    totalMonthly,
    breakdown,
    categoryCount: breakdown.length,
  };
}
