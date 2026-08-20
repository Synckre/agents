import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Rutas que requieren autenticación
  const protectedRoutes = [
    '/dashboard',
    '/conversations',
    '/workflows',
    '/knowledge',
    '/agents',
    '/audit',
    '/settings',
  ];

  const isProtected = protectedRoutes.some((route) => path === route || path.startsWith(route + '/'));
  const authToken = request.cookies.get('synckre_auth')?.value;

  if (isProtected && !authToken) {
    // Redirigir a login si intenta ingresar a una ruta protegida sin token
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (path === '/login' && authToken) {
    // Redirigir al dashboard si ya está autenticado e intenta ir a login
    const dashboardUrl = new URL('/dashboard', request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

// Configurar los matchers para optimizar rendimiento
export const config = {
  matcher: [
    '/dashboard',
    '/dashboard/:path*',
    '/conversations',
    '/conversations/:path*',
    '/workflows',
    '/workflows/:path*',
    '/knowledge',
    '/knowledge/:path*',
    '/agents',
    '/agents/:path*',
    '/audit',
    '/audit/:path*',
    '/settings',
    '/settings/:path*',
    '/login',
  ],
};
