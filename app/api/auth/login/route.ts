import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser, generateJWT, createSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ─── In-memory rate limiter (5 attempts per IP per 60 seconds) ────────────────
// NOTE: In a multi-instance / serverless deployment, use Redis or Upstash instead.
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 })
    return { allowed: true }
  }

  if (entry.count >= 5) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfter }
  }

  entry.count++
  return { allowed: true }
}

// ─── Geolocation helper ────────────────────────────────────────────────────────
// Runs in background — never blocks the login response.
async function getLocation(ip: string): Promise<string> {
  if (!ip || ip === '::1' || ip === '127.0.0.1') return 'Local'
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { signal: AbortSignal.timeout(3000) })
    const geo = await res.json()
    if (geo?.city && geo?.country) return `${geo.city}, ${geo.country}`
  } catch { /* ignore */ }
  return 'Unknown'
}

// ─── GET the real client IP (use the first forwarded IP only) ─────────────────
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return (forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || '').trim()
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  // Rate limiting
  const rateCheck = checkRateLimit(ip)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: `Too many login attempts. Please wait ${rateCheck.retryAfter} seconds.` },
      { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
    )
  }

  let customerId: string | undefined

  try {
    const body = await req.json()
    customerId = body.customerId
    const { password, typingPattern, retryAttempt = 0 } = body

    if (!customerId || !password) {
      return NextResponse.json(
        { error: 'Customer ID and password are required' },
        { status: 400 }
      )
    }

    if (!/^\d{10}$/.test(customerId)) {
      return NextResponse.json(
        { error: 'Customer ID must be exactly 10 digits' },
        { status: 400 }
      )
    }

    // Authenticate — bcrypt always runs (no timing attack)
    const user = await authenticateUser(customerId, password)

    // Log successful login activity in background (don't block response)
    Promise.all([
      getLocation(ip).then(location =>
        prisma.authActivity.create({
          data: {
            customerId: user.customerId,
            userId: user.id,
            type: 'Login Attempt',
            status: 'Success',
            device: req.headers.get('user-agent') || 'Unknown Device',
            ip,
            location,
          },
        }).catch(() => { /* ignore logging errors */ })
      )
    ])

    // Verify typing pattern if user has one and pattern was provided
    if (typingPattern?.pattern && typingPattern?.text) {
      try {
        const verificationResponse = await fetch(
          `${req.nextUrl.origin}/api/auth/typing-pattern/verify-manual`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId,
              pattern: typingPattern.pattern,
              text: typingPattern.text,
            }),
          }
        )

        const verificationResult = await verificationResponse.json()

        if (!verificationResult.success || verificationResult.score < 0.5) {
          const maxRetries = 3
          const attemptsLeft = maxRetries - (retryAttempt + 1)

          if (attemptsLeft >= 0) {
            return NextResponse.json(
              {
                error: 'Typing pattern verification failed. Please try typing more consistently.',
                retryAttempt: retryAttempt + 1,
                attemptsLeft,
                canRetry: true,
                score: verificationResult.score,
                message: `Score: ${(verificationResult.score * 100).toFixed(1)}%. Try typing more consistently.`,
              },
              { status: 401 }
            )
          } else {
            return NextResponse.json(
              {
                error: 'Typing pattern verification failed after multiple attempts. Please try again later.',
                canRetry: false,
                score: verificationResult.score,
              },
              { status: 401 }
            )
          }
        }
      } catch (verificationError) {
        // If the verification service is unavailable, allow login to proceed
        console.error('Typing pattern verification error:', verificationError)
      }
    }

    // Generate JWT and create session
    const token = generateJWT({
      userId: user.id,
      customerId: user.customerId,
      email: user.email,
    })

    await createSession(user.id, token)

    const response = NextResponse.json(
      {
        message: 'Login successful',
        user: {
          id: user.id,
          customerId: user.customerId,
          email: user.email,
          name: user.name,
        },
      },
      { status: 200 }
    )

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
    })

    return response

  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid customer ID or password')) {
      // Log failed login in background
      if (customerId) {
        prisma.user.findUnique({ where: { customerId } }).then(user => {
          if (!user) return
          getLocation(ip).then(location =>
            Promise.all([
              prisma.authActivity.create({
                data: {
                  customerId,
                  userId: user.id,
                  type: 'Login Attempt',
                  status: 'Failed',
                  device: req.headers.get('user-agent') || 'Unknown Device',
                  ip,
                  location,
                },
              }),
              prisma.notification.create({
                data: {
                  userId: user.id,
                  type: 'alert',
                  message: `Failed login attempt detected for your account (Customer ID: ${customerId}). If this wasn't you, please reset your password.`,
                  read: false,
                },
              }),
            ]).catch(() => { /* ignore logging errors */ })
          )
        }).catch(() => { /* ignore */ })
      }

      return NextResponse.json(
        { error: 'Invalid customer ID or password' },
        { status: 401 }
      )
    }

    console.error('Login error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}