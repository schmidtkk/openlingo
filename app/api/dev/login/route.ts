import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

const DEV_PASSWORD = "dev-password-12345";
const AUTO_EMAIL = "dev@dev.local";

function notAllowed() {
  return process.env.LOCAL_DEV !== "true";
}

/** Reject requests from non-loopback hosts so LAN can't hit auto-login. */
function isLoopback(req: NextRequest): boolean {
  const host = (req.headers.get("host") || "").split(":")[0];
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "0.0.0.0"
  );
}

/** Restrict redirect target to same-origin relative paths. */
function safeRedirect(value: string | null): string {
  if (!value) return "/chat";
  if (!value.startsWith("/") || value.startsWith("//")) return "/chat";
  return value;
}

async function signInOrSignUp(
  email: string,
  password: string,
  name: string,
): Promise<Response> {
  const existing = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (existing) {
    return auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
  }
  return auth.api.signUpEmail({
    body: { email, password, name },
    asResponse: true,
  });
}

function forwardSetCookie(target: NextResponse, source: Response) {
  const setCookies =
    typeof source.headers.getSetCookie === "function"
      ? source.headers.getSetCookie()
      : source.headers.get("set-cookie")
        ? [source.headers.get("set-cookie")!]
        : [];
  for (const c of setCookies) target.headers.append("set-cookie", c);
}

// GET /api/dev/login?redirect=...  — auto-login the default dev user
export async function GET(req: NextRequest) {
  if (notAllowed()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isLoopback(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const redirectTo = safeRedirect(req.nextUrl.searchParams.get("redirect"));
  const authRes = await signInOrSignUp(AUTO_EMAIL, DEV_PASSWORD, "Dev");
  if (!authRes.ok) {
    const detail = await authRes.text().catch(() => "");
    return NextResponse.json(
      { error: "Dev sign-in failed", detail },
      { status: 500 },
    );
  }

  const res = NextResponse.redirect(new URL(redirectTo, req.url));
  forwardSetCookie(res, authRes);
  return res;
}

// POST /api/dev/login  { userId }  — switch to existing dev user
export async function POST(req: NextRequest) {
  if (notAllowed()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isLoopback(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await req.json();
  const userRecord = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!userRecord) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const authRes = await auth.api.signInEmail({
    body: { email: userRecord.email, password: DEV_PASSWORD },
    asResponse: true,
  });
  if (!authRes.ok) {
    const detail = await authRes.text().catch(() => "");
    return NextResponse.json(
      { error: "Sign-in failed (legacy user without dev password?)", detail },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true });
  forwardSetCookie(res, authRes);
  return res;
}

// PUT /api/dev/login  { name }  — create new dev profile and log in
export async function PUT(req: NextRequest) {
  if (notAllowed()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isLoopback(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const email = `local-${slug || "user"}-${Date.now()}@dev.local`;

  const authRes = await auth.api.signUpEmail({
    body: { email, password: DEV_PASSWORD, name: name.trim() },
    asResponse: true,
  });
  if (!authRes.ok) {
    const detail = await authRes.text().catch(() => "");
    return NextResponse.json(
      { error: "Sign-up failed", detail },
      { status: 500 },
    );
  }

  const res = NextResponse.json({ ok: true });
  forwardSetCookie(res, authRes);
  return res;
}
