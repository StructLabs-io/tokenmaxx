import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Demo deploy: skip auth gate entirely.
  if (process.env.NEXT_PUBLIC_TOKENMAXX_DEMO === "1") return response;

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isAuthPath = path.startsWith("/auth/");

  // Not signed in → redirect to login (unless we're already on an /auth/* page)
  if (!user && !isAuthPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("from", path);
    return NextResponse.redirect(url);
  }

  // Single-user lock: only Ben's email is allowed (configurable via env)
  const allowed = (process.env.TOKENMAXX_ALLOWED_EMAIL ?? "ben@auknowra.com").toLowerCase();
  if (user && user.email && user.email.toLowerCase() !== allowed) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("forbidden", "1");
    return NextResponse.redirect(url);
  }

  // Already signed in → bounce off /auth/login
  if (user && path === "/auth/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
