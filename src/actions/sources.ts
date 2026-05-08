'use server'

import prisma from '@/lib/prisma'

export async function getSourceUrl(id: number) {
  const source = await prisma.sourceLink.findUnique({ where: { id } })
  return source?.url
}
