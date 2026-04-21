import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

interface DashboardData {
  transitions: any[];
  gateways: any[];
  stickiness: any[];
  insights: string;
  stats: { ordersSynced: number; uniqueCustomers: number };
  filters: { dateFrom: string | null; dateTo: string | null };
  repurchaseTiming: any[] | null;
  revenueConcentration: any | null;
  repurchaseRate: any[] | null;
  cohortRetention: any[] | null;
  productAffinity: any[] | null;
  customerJourneys: any[] | null;
}

function buildSystemPrompt(data: DashboardData): string {
  const gateways = (data.gateways || []).slice(0, 10);
  const transitions = (data.transitions || []).slice(0, 40);
  const stickiness = (data.stickiness || []).slice(0, 15);
  const affinity = (data.productAffinity || []).slice(0, 30);
  const journeys = (data.customerJourneys || []).slice(0, 20);
  const timing = data.repurchaseTiming || [];
  const concentration = data.revenueConcentration;
  const cohorts = data.cohortRetention || [];

  return `You are an e-commerce analytics assistant for Product Journey Mapper. You help merchants understand their product purchase behavior, identify opportunities, and make data-driven decisions.

You have access to the following live analytics data for this store:

## Store Overview
- Total orders analyzed: ${data.stats?.ordersSynced?.toLocaleString() || "N/A"}
- Unique repeat customers: ${data.stats?.uniqueCustomers?.toLocaleString() || "N/A"}
${data.filters?.dateFrom ? `- Date filter: ${data.filters.dateFrom} to ${data.filters.dateTo || "present"}` : ""}

## Gateway Products (First Purchase)
${gateways.length > 0 ? gateways.map((g: any) => `- "${g.productName}": ${g.firstPurchaseCount} first orders (${g.firstPurchasePct?.toFixed(1)}%), avg LTV after: $${g.avgLtvAfter?.toFixed(2)}, avg ${g.avgOrdersAfter?.toFixed(1)} subsequent orders`).join("\n") : "No gateway data available."}

## Product Transitions (Purchase Flow: Order N → Order N+1)
${transitions.length > 0 ? transitions.map((t: any) => `- Step ${t.step}: "${t.fromProduct}" → "${t.toProduct}": ${t.transitionCount} customers (${t.transitionPct?.toFixed(1)}%), avg ${t.avgDaysBetween?.toFixed(0)} days apart`).join("\n") : "No transition data available."}

## Product Stickiness (Return Rate After Purchase)
${stickiness.length > 0 ? stickiness.map((s: any) => `- "${s.productName}": ${s.totalBuyers} buyers, ${s.stickinessRate?.toFixed(1)}% returned for another purchase, avg ${s.avgDaysToReturn} days to return`).join("\n") : "No stickiness data available."}

## Repurchase Timing (Days Between 1st and 2nd Order)
${timing.length > 0 ? timing.map((t: any) => `- ${t.label}: ${t.count} customers (${t.pct?.toFixed(1)}%)`).join("\n") : "No timing data available."}

## Revenue Concentration
${concentration ? `- One-time customer revenue: $${(concentration.oneTimeRevenue / 1000).toFixed(1)}k (${concentration.oneTimeRevenuePct?.toFixed(0)}%)
- Repeat customer revenue: $${(concentration.repeatRevenue / 1000).toFixed(1)}k (${concentration.repeatRevenuePct?.toFixed(0)}%)
- Top 10% of customers generate: ${concentration.top10PctCustomerRevenuePct?.toFixed(0)}% of total revenue` : "No revenue data available."}

## Cohort Retention (Monthly)
${cohorts.length > 0 ? cohorts.map((c: any) => `- ${c.cohortMonth} (${c.cohortSize} customers): ${c.retention?.map((r: any) => `M+${r.monthOffset}: ${r.retainedPct?.toFixed(0)}%`).join(", ")}`).join("\n") : "No cohort data available."}

## Product Affinity (Co-purchase Patterns)
${affinity.length > 0 ? affinity.map((a: any) => `- "${a.productA}" + "${a.productB}": ${a.coPurchaseCount} co-purchases, lift ${a.lift}x`).join("\n") : "No affinity data available."}

## Top Customer Journeys (by Revenue)
${journeys.length > 0 ? journeys.map((j: any) => `- ${j.orderCount} orders, $${j.totalRevenue?.toFixed(0)} total: ${j.products?.slice(0, 5).join(" → ")}${j.products?.length > 5 ? ` (+${j.products.length - 5} more)` : ""}`).join("\n") : "No journey data available."}

## Previously Generated AI Insights
${data.insights || "No insights generated yet."}

RULES:
- Always reference specific numbers from the data above when answering questions
- Format currency as $X,XXX and percentages as X.X%
- If asked about something not covered by the data, say so clearly
- Keep responses concise — 2-4 paragraphs max unless the user asks for more detail
- Use markdown formatting: **bold** for emphasis, bullet lists for multiple items
- When suggesting actions, be specific (e.g., "send a cross-sell email for Product X to buyers of Product Y within 14 days")
- You can reference the previously generated insights but provide fresh analysis when asked`;
}

export async function POST(request: NextRequest) {
  try {
    const { messages, dashboardData } = await request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "messages array required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = buildSystemPrompt(dashboardData || {});

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const data = JSON.stringify({
                type: "delta",
                text: event.delta.text,
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
          );
          controller.close();
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
