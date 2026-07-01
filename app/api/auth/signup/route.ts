import { NextRequest, NextResponse } from 'next/server'
import { createUser, generateJWT, createSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// ─── In-memory rate limiter (3 signups per IP per hour) ──────────────────────
const signupAttempts = new Map<string, { count: number; resetAt: number }>()

function checkSignupRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = signupAttempts.get(ip)

  if (!entry || now > entry.resetAt) {
    signupAttempts.set(ip, { count: 1, resetAt: now + 3_600_000 }) // 1 hour window
    return { allowed: true }
  }

  if (entry.count >= 3) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfter }
  }

  entry.count++
  return { allowed: true }
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return (forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || '').trim()
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  const rateCheck = checkSignupRateLimit(ip)
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: `Too many signup attempts. Please wait ${rateCheck.retryAfter} seconds.` },
      { status: 429 }
    )
  }

  try {
    const body = await req.json()
    const { customerId, email, password, name, phone, profileImage, typingPattern } = body

    // Validate all required fields
    if (!customerId || !email || !password || !name) {
      return NextResponse.json(
        { error: 'Customer ID, name, email, and password are required' },
        { status: 400 }
      )
    }

    if (!/^\d{10}$/.test(customerId)) {
      return NextResponse.json(
        { error: 'Customer ID must be exactly 10 digits' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    if (name.trim().length < 2) {
      return NextResponse.json(
        { error: 'Name must be at least 2 characters' },
        { status: 400 }
      )
    }

    // Create user (name is now passed as required)
    const user = await createUser({
      customerId,
      email,
      password,
      name: name.trim(),
      phone,
      profileImage,
    })

    const token = generateJWT({
      userId: user.id,
      customerId: user.customerId,
      email: user.email,
    })

    // Save typing pattern if provided
    if (typingPattern?.pattern && typingPattern?.text) {
      await prisma.typingPattern.create({
        data: {
          userId: user.id,
          pattern: typingPattern.pattern,
          quality: typingPattern.quality || 0.5,
          type: 'manual',
        },
      })

      await prisma.user.update({
        where: { id: user.id },
        data: { hasTypingPattern: true },
      })
    }

    await createSession(user.id, token)

    const response = NextResponse.json(
      {
        message: 'User created successfully',
        user: {
          id: user.id,
          customerId: user.customerId,
          email: user.email,
          name: user.name,
          profileImage: user.profileImage,
          hasTypingPattern: !!typingPattern,
        },
      },
      { status: 201 }
    )

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
    })

    return response

  } catch (error) {
    console.error('Signup error:', error)

    if (error instanceof Error) {
      if (error.message.includes('already exists')) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      if (error.message === 'Name is required') {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}