'use server'

import prisma from '@/lib/prisma'
import bcrypt from 'bcrypt'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { redirect } from 'next/navigation'

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-default-key-for-dev'

export async function register(prevState: any, formData: FormData) {
  const username = formData.get('username') as string
  const password = formData.get('password') as string

  if (!username || !password) return { error: 'Missing fields' }

  const existing = await prisma.user.findUnique({ where: { username } })
  if (existing) return { error: 'Username already taken' }

  const password_hash = await bcrypt.hash(password, 10)
  
  const user = await prisma.user.create({
    data: { username, password_hash }
  })

  await setLoginCookie(user.id, user.username)
  redirect('/dashboard')
}

export async function login(prevState: any, formData: FormData) {
  const username = formData.get('username') as string
  const password = formData.get('password') as string

  if (!username || !password) return { error: 'Missing fields' }

  const user = await prisma.user.findUnique({ where: { username } })
  if (!user) return { error: 'Invalid credentials' }

  const isValid = await bcrypt.compare(password, user.password_hash)
  if (!isValid) return { error: 'Invalid credentials' }

  await setLoginCookie(user.id, user.username)
  redirect('/dashboard')
}

export async function logout() {
  const cookieStore = await cookies()
  cookieStore.delete('auth_token')
  redirect('/login')
}

async function setLoginCookie(userId: string, username: string) {
  const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '7d' })
  const cookieStore = await cookies()
  cookieStore.set('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
}

export async function getSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth_token')?.value
  if (!token) return null

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string, username: string }
    return decoded
  } catch (e) {
    return null
  }
}
