import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicPage = createRouteMatcher([
  '/login(.*)',
  '/sign-in(.*)',
  '/sso-callback(.*)',
]);

const isPublicApi = createRouteMatcher([
  '/api/v1/health(.*)',
  '/api/v1/live(.*)',
  '/api/v1/public/contact(.*)',
  '/api/v1/conversations/chat(.*)',
  '/api/auth/(.*)',
]);

const isApiRoute = createRouteMatcher(['/api(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicApi(req) || isPublicPage(req)) {
    return;
  }

  if (isApiRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ detail: 'No autenticado.' }, { status: 401 });
    }
    return;
  }

  await auth.protect({
    unauthenticatedUrl: new URL('/login', req.url).toString(),
  });
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|json|webmanifest|ttf|woff2?|png|jpg|jpeg|gif|svg|ico|webp|mp4|webm|pdf)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
