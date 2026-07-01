import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma'

export interface JWTPayload {
  userId: string
  customerId: string
  email: string
}

export interface UserData {
  customerId: string
  email: string
  password: string
  name: string        // required — matches Prisma schema
  phone?: string
  profileImage?: string
}

// ─── Password hashing ─────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12
  return bcrypt.hash(password, saltRounds)
}

export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

// ─── JWT functions ─────────────────────────────────────────────────────────────

export function generateJWT(payload: JWTPayload): string {
  const secret = process.env.JWT_SECRET!
  const expiresIn = parseInt(process.env.JWT_EXPIRES_IN || '86400', 10)
  return jwt.sign(payload, secret, { expiresIn })
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    const secret = process.env.JWT_SECRET!
    const decoded = jwt.verify(token, secret) as JWTPayload
    return decoded
  } catch {
    return null
  }
}

// ─── User functions ───────────────────────────────────────────────────────────

export async function createUser(userData: UserData) {
  const { customerId, email, password, name, phone, profileImage } = userData

  if (!name || name.trim() === '') {
    throw new Error('Name is required')
  }

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ customerId }, { email }],
    },
  })

  if (existingUser) {
    throw new Error('User with this customer ID or email already exists')
  }

  const passwordHash = await hashPassword(password)

  const user = await prisma.user.create({
    data: {
      customerId,
      email,
      passwordHash,
      name: name.trim(),
      phone,
      profileImage,
    },
  })

  return user
}

// Dummy hash used to prevent timing attacks when user is not found.
// Pre-computed so we don't slow down every request with a bcrypt hash call.
const DUMMY_HASH =
  '$2a$12$QkBnzg8sVTHkK3/PH6Wm.OHqvT4KmVuLtVJ8sHlDc6XnzlGtD8Kni'

export async function authenticateUser(customerId: string, password: string) {
  // Find user — but we always run bcrypt to prevent timing-based account enumeration
  const user = await prisma.user.findUnique({ where: { customerId } })

  // Always compare — use dummy hash if user not found so response time is constant
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH
  const isValid = await bcrypt.compare(password, hashToCheck)

  if (!user || !isValid) {
    throw new Error('Invalid customer ID or password')
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  })

  return user
}

export async function getUserById(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } })
}

export async function getUserByCustomerId(customerId: string) {
  return prisma.user.findUnique({ where: { customerId } })
}

// ─── Session management ───────────────────────────────────────────────────────

export async function createSession(userId: string, token: string) {
  const expiresAt = new Date()
  expiresAt.setSeconds(
    expiresAt.getSeconds() + parseInt(process.env.JWT_EXPIRES_IN || '86400', 10)
  )

  return prisma.session.create({
    data: { userId, token, expiresAt },
  })
}

export async function getSessionByToken(token: string) {
  return prisma.session.findUnique({
    where: { token },
    include: { user: true },
  })
}

export async function deleteSession(token: string) {
  try {
    return await prisma.session.delete({ where: { token } })
  } catch {
    // Session may not exist — that's fine on logout
    return null
  }
}

export async function cleanupExpiredSessions() {
  return prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
}