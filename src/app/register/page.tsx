'use client'

import { useActionState } from 'react'
import { register } from '@/actions/auth'
import Link from 'next/link'

export default function RegisterPage() {
  const [state, action, isPending] = useActionState(register, undefined)

  return (
    <div className="container" style={{ maxWidth: '400px' }}>
      <div className="header">
        <h1 style={{ fontSize: '2.5rem' }}>Create Account</h1>
        <p>Start saving your flashcards today.</p>
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
            {isPending ? 'Creating Account...' : 'Register'}
          </button>
        </form>

        <Link href="/login" className="secondary-link">
          Already have an account? Login here.
        </Link>
      </div>
    </div>
  )
}
