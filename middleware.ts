import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  const { pathname } = request.nextUrl

  // Protect /dashboard routes
  if (pathname.startsWith('/dashboard')) {
    if (!token) {
      const loginUrl = new URL('/login', request.url)
      // Redirect to login page
      return NextResponse.redirect(loginUrl)
    }
  }

  // Redirect logged-in users away from auth pages
  if (pathname === '/login' || pathname === '/signup' || pathname === '/') {
    if (token) {
      const dashboardUrl = new URL('/dashboard', request.url)
      return NextResponse.redirect(dashboardUrl)
    }
  }

  return NextResponse.next()
}

// Config to specify matching routes
export const config = {
  matcher: ['/dashboard/:path*', '/login', '/signup', '/'],
}
