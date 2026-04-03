import Anthropic from "@anthropic-ai/sdk";
import type { TransitionResult, GatewayResult, JourneyStats } from "./journey";

const anthropic = new Anthropic();

export async function generateJourneyInsights(
  transitions: TransitionResult[],
  gateways: GatewayResult[],
  stats: JourneyStats
): Promise<string> {
  // Take top transitions and gateways for the prompt
  const topTransitions = transitions.slice(0, 30);
  const topGateways = gateways.slice(0, 10);

  const prompt = `You are an e-commerce analytics expert. Analyze this product purchase journey data and provide 4-5 specific, actionable insights for the merchant.

## Overall Stats
- Total customers: ${stats.totalCustomers}
- Repeat customers: ${stats.repeatCustomers} (${stats.repeatRate.toFixed(1)}%)
- Average orders per customer: ${stats.avgOrdersPerCustomer.toFixed(1)}
- Median days between orders: ${stats.medianDaysBetweenOrders}

## Top Gateway Products (First Purchase)
${topGateways.map((g) => `- "${g.productName}" (${g.category || "uncategorized"}): ${g.firstPurchaseCount} first orders (${g.firstPurchasePct.toFixed(1)}%), avg LTV after: $${g.avgLtvAfter.toFixed(2)}, avg ${g.avgOrdersAfter.toFixed(1)} total orders`).join("\n")}

## Top Product Transitions (Order N → Order N+1)
${topTransitions.map((t) => `- Step ${t.step}: "${t.fromProduct}" → "${t.toProduct}": ${t.transitionCount} customers (${t.transitionPct.toFixed(1)}%), avg ${t.avgDaysBetween.toFixed(0)} days between`).join("\n")}

Provide insights in this format:
1. **[Insight title]** — [One sentence with specific data points and a recommended action]

Focus on:
- Which gateway product leads to highest LTV (and what to do about it)
- The strongest purchase paths (and how to accelerate them with email flows)
- Surprising patterns or drop-offs
- Optimal timing for cross-sell emails based on avg days between transitions
- Any products that are "dead ends" (bought but rarely lead to repeat purchases)

Be specific — use exact product names and numbers from the data.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text || "Unable to generate insights.";
}
