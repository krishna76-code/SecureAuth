import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const payload = verifyJWT(token)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const { pattern, quality, text } = await req.json()

    if (!pattern) {
      return NextResponse.json({ error: 'Pattern is required' }, { status: 400 })
    }

    // Normalize — store pattern as JSON string regardless of input format
    const patternStr = typeof pattern === 'string' ? pattern : JSON.stringify(pattern)

    // Save the new typing pattern record
    await prisma.typingPattern.create({
      data: {
        userId: payload.userId,
        pattern: patternStr,
        quality: typeof quality === 'number' ? quality : 0.5,
        type: 'manual',
      },
    })

    // Make sure the user is flagged as having a pattern
    await prisma.user.update({
      where: { id: payload.userId },
      data: { hasTypingPattern: true },
    })

    return NextResponse.json({
      success: true,
      message: 'Typing pattern saved successfully',
    })

  } catch (error) {
    console.error('Save typing pattern error:', error)
    return NextResponse.json(
      { error: 'Failed to save typing pattern' },
      { status: 500 }
    )
  }
}
