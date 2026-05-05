import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Clerk middleware. Public routes skip auth — everything else requires a
 * signed-in user. Webhook, Inngest, cron, Klaviyo callback, and the demo
 * endpoint have their own auth (HMAC / shared secret / Bearer) so they
 * stay in the public list.
 *
 * The landing page "/" is public so unauthenticated visitors see a
 * marketing page; the dashboard and settings pages redirect to sign-in.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks/clerk",
  "/api/inngest(.*)",
  "/api/klaviyo/callback",
  "/api/klaviyo/connect",
  "/api/cron/(.*)",
  "/api/demo",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
