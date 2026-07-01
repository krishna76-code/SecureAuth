import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT, getSessionByToken, generateJWT, createSession, deleteSession } from '@/lib/auth'

// Refreshes the auth token if the current session is still valid.
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value

    if (!token) {
      return NextResponse.json({ message: 'No token provided.' }, { status: 401 })
    }

    // Verify the existing JWT
    const payload = verifyJWT(token)
    if (!payload) {
      return NextResponse.json({ message: 'Invalid or expired token.' }, { status: 401 })
    }

    // Check session exists in DB
    const session = await getSessionByToken(token)
    if (!session || session.expiresAt < new Date()) {
      return NextResponse.json({ message: 'Session expired or not found.' }, { status: 401 })
    }

    // Delete old session and issue a fresh token
    await deleteSession(token)

    const newToken = generateJWT({
      userId: payload.userId,
      customerId: payload.customerId,
      email: payload.email,
    })

    await createSession(payload.userId, newToken)

    const res = NextResponse.json({ message: 'Token refreshed.' })
    res.cookies.set('auth-token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
    })

    return res
  } catch (error) {
    console.error('Refresh token error:', error)
    return NextResponse.json({ message: 'Invalid or expired token.' }, { status: 401 })
  }
}