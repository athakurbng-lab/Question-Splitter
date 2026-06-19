'use server'

import { getSession } from './auth'
import { pusherServer } from '@/lib/pusher-server'

export async function broadcastQuizEvent(data: {
  eventName: string,
  payload: any,
  socketId?: string
}) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')

  await pusherServer.trigger(
    `private-user-${session.userId}`,
    data.eventName,
    data.payload,
    { socket_id: data.socketId }
  )

  return { success: true }
}
