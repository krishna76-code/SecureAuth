"use client"

import { useAuth } from '../contexts/AuthContext'
import { useSessionRefresh } from '../hooks/useSessionRefresh'
import { sessionManager } from '../lib/session'
import { useMemo } from 'react'

export const SessionInfo = () => {
  const { isLoggedIn, user, customerId } = useAuth()

  // Enable session refresh
  useSessionRefresh()

  const session = useMemo(() => {
    if (typeof window === 'undefined') return null
    return sessionManager.getSession()
  }, [isLoggedIn])

  if (!isLoggedIn || !session) {
    return null
  }

  const formatDate = (date: Date | string | null) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleString()
  }

  const getSessionAge = () => {
    if (!session.lastLogin) return 'N/A'
    const now = new Date()
    const lastLogin = new Date(session.lastLogin)
    const diffMs = now.getTime() - lastLogin.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) return `${diffDays} day(s)`
    if (diffHours > 0) return `${diffHours} hour(s)`
    return `${diffMins} minute(s)`
  }

  return (
    <div className="bg-gray-100 p-4 rounded-lg shadow-sm">
      <h3 className="text-lg font-semibold mb-3 text-gray-800">Session Information</h3>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="font-medium text-gray-600">Customer ID:</span>
          <span className="text-gray-800">{customerId || 'N/A'}</span>
        </div>

        <div className="flex justify-between">
          <span className="font-medium text-gray-600">Email:</span>
          <span className="text-gray-800">{user?.email || 'N/A'}</span>
        </div>

        <div className="flex justify-between">
          <span className="font-medium text-gray-600">Session ID:</span>
          <span className="text-gray-800 font-mono text-xs">{session.sessionId || 'N/A'}</span>
        </div>

        <div className="flex justify-between">
          <span className="font-medium text-gray-600">Last Login:</span>
          <span className="text-gray-800">{formatDate(session.lastLogin)}</span>
        </div>

        <div className="flex justify-between">
          <span className="font-medium text-gray-600">Session Age:</span>
          <span className="text-gray-800">{getSessionAge()}</span>
        </div>

        <div className="flex justify-between">
          <span className="font-medium text-gray-600">Status:</span>
          <span className="text-green-600 font-medium">Active</span>
        </div>
      </div>
    </div>
  )
}