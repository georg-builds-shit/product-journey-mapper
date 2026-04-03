# Product Journey Mapper

Visualises the product purchase journeys of e-commerce customers. Connects to Klaviyo, analyses event sequences, and renders Sankey diagrams showing what customers buy first, second, and third — broken down by persona.

## Stack

- **Framework**: Next.js (App Router)
- **Database**: Neon Postgres + Drizzle ORM
- **Auth / integrations**: Klaviyo OAuth (PKCE)
- **Background jobs**: Inngest
- **AI**: Claude API (Anthropic)
- **Visualisation**: @nivo/sankey
- **Deployment**: Vercel

## Local development

```bash
npm install
vercel env pull .env.local   # pull secrets from Vercel
npx drizzle-kit push         # sync DB schema (pass DATABASE_URL inline if needed)
npm run dev                  # http://localhost:3000
```

## Docs

Planning docs and architecture notes live in the parent directory (`../`).
