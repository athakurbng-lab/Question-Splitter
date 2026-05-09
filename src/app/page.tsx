import Link from 'next/link'
import { getSession } from '@/actions/auth'

export const dynamic = 'force-dynamic'

export default async function MainMenu() {
  const session = await getSession()
  return (
    <div className="container">
      <div className="header">
        <h1>QA Flashcards</h1>
        <p>Master your subjects with interactive study sessions.</p>
      </div>
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', textAlign: 'center' }}>
        <Link href="/take-quiz" className="btn-primary" style={{ padding: '1.5rem', fontSize: '1.5rem' }}>
          📖 Take Quiz
        </Link>
        <Link href={session ? "/bookmarks" : "/login"} className="btn-primary" style={{ padding: '1.5rem', fontSize: '1.5rem', background: 'linear-gradient(135deg, #10b981, #059669)' }}>
          ⭐ Bookmarks
        </Link>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            {session ? (
            <Link href="/dashboard" className="secondary-btn" style={{ textDecoration: 'none', padding: '1rem', fontSize: '1.1rem', flex: 1 }}>Dashboard / Settings</Link>
            ) : (
            <Link href="/login" className="secondary-btn" style={{ textDecoration: 'none', padding: '1rem', fontSize: '1.1rem', flex: 1 }}>Login</Link>
            )}
        </div>
      </div>
    </div>
  )
}
