'use server'

import prisma from '@/lib/prisma'

export async function getSourceUrl(id: number) {
  const source = await prisma.sourceLink.findUnique({ where: { id } })
  return source?.url
}

export async function fetchGDocTextServer(url: string): Promise<string> {
  const docIdMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/)
  if (!docIdMatch) {
    throw new Error('Invalid Google Docs URL format. Please make sure it is a valid Google Docs link.')
  }
  const exportUrl = `https://docs.google.com/document/export?format=txt&id=${docIdMatch[1]}`
  
  try {
    const response = await fetch(exportUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    
    if (!response.ok) {
      if (response.status === 404 || response.status === 403 || response.status === 401) {
        throw new Error(`Google Docs returned status ${response.status}. This document may not exist, or it is private. Please ensure the link is correct and that the sharing settings are set to "Anyone with the link can view".`)
      }
      throw new Error(`Failed to fetch document: Google Docs returned status ${response.status}`)
    }
    
    const text = await response.text()
    
    // Check if the returned text is actually HTML (which means it's likely a Google sign-in/permission page)
    if (text.trim().startsWith('<!DOCTYPE') || text.includes('<html') || text.includes('<script')) {
      throw new Error('This Google Doc is private or requires sign-in. Please ensure it is shared as "Anyone with the link can view".')
    }
    
    return text
  } catch (error) {
    console.error('Error fetching Google Doc on server:', error)
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Failed to fetch document from Google Docs. Please make sure the link is correct and accessible.')
  }
}

