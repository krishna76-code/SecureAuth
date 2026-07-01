import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

function isValidUpiId(upiId: string) {
  return /^[\w.-]+@[\w.-]+$/.test(upiId)
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return (forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || '').trim()
}

async function resolveLocation(lat?: number, lng?: number, ip?: string): Promise<string> {
  // Try GPS coordinates first
  if (lat != null && lng != null) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
        { headers: { 'User-Agent': 'SecureAuth/1.0' }, signal: AbortSignal.timeout(3000) }
      )
      const data = await res.json()
      if (data?.address) {
        const city =
          data.address.city ||
          data.address.town ||
          data.address.village ||
          data.address.county ||
          ''
        const country = data.address.country || ''
        if (city || country) return [city, country].filter(Boolean).join(', ')
      }
    } catch { /* ignore */ }
  }

  // Fallback to IP-based lookup
  if (ip && ip !== '::1' && ip !== '127.0.0.1') {
    try {
      const res = await fetch(`https://ipapi.co/${ip}/json/`, {
        signal: AbortSignal.timeout(3000),
      })
      const geo = await res.json()
      if (geo?.city && geo?.country) return `${geo.city}, ${geo.country}`
    } catch { /* ignore */ }
  }

  return 'Unknown'
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const user = verifyJWT(token)
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const { amount, upiId, device, lat, lng, category } = await req.json()

    if (!amount || !upiId || !category) {
      return NextResponse.json(
        { error: 'Amount, UPI ID, and category are required' },
        { status: 400 }
      )
    }
    if (!isValidUpiId(upiId)) {
      return NextResponse.json({ error: 'Invalid UPI ID format' }, { status: 400 })
    }
    const numericAmount = Number(amount)
    if (isNaN(numericAmount) || numericAmount <= 0 || numericAmount > 99999999) {
      return NextResponse.json({ error: 'Invalid amount. Must be positive and less than 100,000,000.' }, { status: 400 })
    }

    const validCategories = ['Food & Dining', 'Shopping', 'Transportation', 'Entertainment', 'Bills']
    if (!validCategories.includes(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }

    const ip = getClientIp(req)
    const location = await resolveLocation(
      lat != null ? Number(lat) : undefined,
      lng != null ? Number(lng) : undefined,
      ip
    )

    // Create the transaction
    const transaction = await prisma.transaction.create({
      data: {
        userId: user.userId,
        customerId: user.customerId,
        type: 'transfer',
        amount: Number(amount),
        description: `Sent to ${upiId}`,
        recipientId: upiId,
        status: 'completed',
        ip,
        location,
        device: device || 'Unknown Device',
        lat: lat ?? null,
        lng: lng ?? null,
        category,
      },
    })

    // Also store the session input for the ML model via the model-input route
    // (The batch worker will pick this up from the modelInput table)
    try {
      await prisma.modelInput.create({
        data: {
          customer_id: user.customerId,
          session_id: 'transaction',
          device_type: device || 'Unknown',
          click_events: 0,
          scroll_events: 0,
          touch_events: 0,
          keyboard_events: 0,
          device_motion: 0,
          time_on_page: 0,
          screen_size: '',
          browser_info: '',
          language: '',
          timezone_offset: 0,
          device_orientation: '',
          geolocation_city: location.split(',')[0].trim(),
          transaction_amount: Number(amount),
          transaction_date: transaction.createdAt,
          mouse_movement: 0,
        },
      })
    } catch { /* ignore ML input errors — don't fail the transaction */ }

    // Send success notification
    await prisma.notification.create({
      data: {
        userId: user.userId,
        type: 'success',
        message: `Transaction of ₹${amount} to ${upiId} completed successfully.`,
        read: false,
      },
    })

    return NextResponse.json({ success: true, transaction })
  } catch (error) {
    console.error('Transaction error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const user = verifyJWT(token)
    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const transactions = await prisma.transaction.findMany({
      where: { customerId: user.customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        customerId: true,
        type: true,
        amount: true,
        description: true,
        recipientId: true,
        status: true,
        ip: true,
        location: true,
        device: true,
        lat: true,
        lng: true,
        category: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ transactions })
  } catch (error) {
    console.error('Fetch transactions error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}