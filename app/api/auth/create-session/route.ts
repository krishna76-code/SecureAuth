import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser, generateJWT, createSession } from '@/lib/auth'

// This route is an alias for /api/auth/login kept for backwards compatibility.
// It uses the same Prisma + bcrypt authentication as the main login route.
export async function POST(req: NextRequest) {
  try {
    const { email, password, customerId } = await req.json()

    // Support login via customerId (primary) or email (fallback label)
    const loginId = customerId || email
    if (!loginId || !password) {
      return NextResponse.json(
        { message: 'Customer ID and password are required.' },
        { status: 400 }
      )
    }

    const user = await authenticateUser(loginId, password)

    const token = generateJWT({
      userId: user.id,
      customerId: user.customerId,
      email: user.email,
    })

    await createSession(user.id, token)

    const res = NextResponse.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        customerId: user.customerId,
        email: user.email,
        name: user.name,
      },
    })

    res.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
    })

    return res
  } catch (error) {
    console.error('Create session error:', error)
    return NextResponse.json(
      { message: 'Invalid credentials.' },
      { status: 401 }
    )
  }
}