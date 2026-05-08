'use client'

import { useActionState } from 'react'
import { login } from '@/actions/auth'
import Link from 'next/link'

export default function LoginPage() {
  const [state, action, isPending] = useActionState(login, undefined)

  return (
    <div className="container" style={{ maxWidth: '400px' }}>
      <div className="header">
        <h1 style={{ fontSize: '2.5rem' }}>Welcome Back</h1>
        <p>Login to your QA Flashcards account.</p>
      </div>

      <div className="panel">
        <form action={action}>
          {state?.error && <div className="error-message">{state.error}</div>}
          
          <input 
            type="text" 
            name="username" 
            placeholder="Username" 
            className="input-field" 
            required 
          />
          <input 
            type="password" 
            name="password" 
            placeholder="Password" 
            className="input-field" 
            required 
          />
          
          <button type="submit" className="btn-primary" disabled={isPending}>
            {isPending ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <Link href="/register" className="secondary-link">
          Don't have an account? Register here.
        </Link>
      </div>
    </div>
  )
}
