import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { manualTypingPatternService, TypingPattern } from '@/lib/manual-typing-pattern'

export async function POST(req: NextRequest) {
  try {
    const { customerId, pattern, text } = await req.json()

    if (!customerId || !pattern) {
      return NextResponse.json(
        { success: false, score: 0, message: 'Customer ID and pattern are required' },
        { status: 400 }
      )
    }

    // Find user and their most recent stored typing pattern
    const user = await prisma.user.findUnique({
      where: { customerId },
      include: {
        typingPatterns: {
          where: { type: 'manual' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    if (!user) {
      return NextResponse.json(
        { success: false, score: 0, message: 'User not found' },
        { status: 404 }
      )
    }

    // If user has no typing pattern on file, skip verification and allow login
    if (!user.hasTypingPattern || user.typingPatterns.length === 0) {
      return NextResponse.json({
        success: true,
        score: 1.0,
        message: 'No pattern on file — verification skipped',
      })
    }

    // Parse the stored pattern from DB
    let storedPattern: TypingPattern
    try {
      storedPattern = JSON.parse(user.typingPatterns[0].pattern)
    } catch {
      // If stored pattern is corrupt, allow login but log it
      console.error('Stored typing pattern is corrupt for user:', customerId)
      return NextResponse.json({
        success: true,
        score: 1.0,
        message: 'Stored pattern unreadable — verification skipped',
      })
    }

    // Parse the incoming login-time pattern
    let loginPattern: TypingPattern
    try {
      loginPattern = typeof pattern === 'string' ? JSON.parse(pattern) : pattern
    } catch {
      return NextResponse.json(
        { success: false, score: 0, message: 'Invalid pattern format provided' },
        { status: 400 }
      )
    }

    // Run comparison
    const result = manualTypingPatternService.comparePatterns(storedPattern, loginPattern)

    return NextResponse.json({
      success: result.isMatch,
      score: result.score,
      confidence: result.confidence,
      message: result.message,
    })

  } catch (error) {
    console.error('Typing pattern verification error:', error)
    // On unexpected error, fail open (allow login) so the service being down
    // does not lock users out of their accounts
    return NextResponse.json({
      success: true,
      score: 1.0,
      message: 'Verification service unavailable — login allowed',
    })
  }
}
