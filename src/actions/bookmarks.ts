'use server'

import prisma from '@/lib/prisma'
import { getSession } from './auth'
import { cookies } from 'next/headers'

export async function addSourceLink(url: string) {
  let source = await prisma.sourceLink.findUnique({ where: { url } })
  if (!source) {
    source = await prisma.sourceLink.create({ data: { url } })
  }
  return source
}

export async function addToHistory(sourceLinkId: number, customName?: string) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')

  // Check if it already exists in history to update last accessed
  const existing = await prisma.userLinkHistory.findFirst({
    where: { user_id: session.userId, source_link_id: sourceLinkId }
  })

  if (existing) {
    return await prisma.userLinkHistory.update({
      where: { id: existing.id },
      data: { last_accessed_at: new Date() }
    })
  }

  return await prisma.userLinkHistory.create({
    data: {
      user_id: session.userId,
      source_link_id: sourceLinkId,
      custom_name: customName || 'Untitled Document'
    }
  })
}

export async function renameHistory(historyId: string, newName: string) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')

  const history = await prisma.userLinkHistory.findUnique({ where: { id: historyId } })
  if (!history || history.user_id !== session.userId) throw new Error('Unauthorized')

  return await prisma.userLinkHistory.update({
    where: { id: historyId },
    data: { custom_name: newName }
  })
}

export async function getHistory() {
  const session = await getSession()
  if (!session) return []

  return await prisma.userLinkHistory.findMany({
    where: { user_id: session.userId },
    include: { source_link: true },
    orderBy: { last_accessed_at: 'desc' }
  })
}

export async function addBookmark(data: { source_link_id?: number, question_number?: number, question_text?: string }) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')

  return await prisma.bookmark.create({
    data: {
      user_id: session.userId,
      source_link_id: data.source_link_id,
      question_number: data.question_number,
      question_text: data.question_text
    }
  })
}

export async function getBookmarks() {
  const session = await getSession()
  if (!session) return []

  return await prisma.bookmark.findMany({
    where: { 
      user_id: session.userId,
      OR: [
        { question_number: { gte: 0 } },
        { question_number: null }
      ]
    },
    include: { source_link: true },
    orderBy: { id: 'desc' } // or whatever order
  })
}

export async function removeBookmark(id: string) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')

  const bookmark = await prisma.bookmark.findUnique({ where: { id } })
  if (!bookmark || bookmark.user_id !== session.userId) throw new Error('Unauthorized')

  return await prisma.bookmark.delete({ where: { id } })
}

export async function saveResumeState(sourceLinkId: number, questionNumber: number) {
  const cookieStore = await cookies()
  cookieStore.set('resume_state', JSON.stringify({ sourceLinkId, questionNumber }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })
}

export async function getResumeState() {
  const cookieStore = await cookies()
  const val = cookieStore.get('resume_state')?.value
  if (!val) return null
  try {
    return JSON.parse(val) as { sourceLinkId: number, questionNumber: number }
  } catch {
    return null
  }
}

export async function toggleBookmarkState(sourceLinkId: number, questionNumber: number, prefix: string, qText: string, aText: string) {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')

  const oppositeNumber = -questionNumber;

  return await prisma.$transaction(async (tx) => {
    // Clean up opposite state if any
    await tx.bookmark.deleteMany({
      where: { user_id: session.userId, source_link_id: sourceLinkId, question_number: oppositeNumber }
    });

    // Try to delete the current state
    const deleted = await tx.bookmark.deleteMany({
      where: { user_id: session.userId, source_link_id: sourceLinkId, question_number: questionNumber }
    });

    // If we deleted something, it means it was toggled OFF
    if (deleted.count > 0) {
      return false;
    } else {
      // Otherwise, it wasn't there, so we toggle it ON
      await tx.bookmark.create({
        data: {
          user_id: session.userId,
          source_link_id: sourceLinkId,
          question_number: questionNumber,
          question_text: `${prefix} ${qText}\nAns: ${aText}`
        }
      });
      return true;
    }
  });
}

export async function getBookmarkedQuestionNumbers(sourceLinkId: number) {
  const session = await getSession()
  if (!session) return []
  const bms = await prisma.bookmark.findMany({
    where: { user_id: session.userId, source_link_id: sourceLinkId, question_number: { not: null } }
  })
  return bms.map(b => b.question_number as number)
}

