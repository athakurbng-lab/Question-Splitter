import { getHistory } from '@/actions/bookmarks'
import Link from 'next/link'
import TakeQuizClient from './TakeQuizClient'

export const dynamic = 'force-dynamic'

export default async function TakeQuizPage() {
  const history = await getHistory()
  return (
    <div className="container">
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', margin: 0 }}>Take Quiz</h1>
        <Link href="/" className="secondary-btn" style={{ textDecoration: 'none' }}>Main Menu</Link>
      </div>
      
      <TakeQuizClient />

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Earlier Quizzes</h2>
        {history.length === 0 ? <p className="hint" style={{ textAlign: 'left' }}>No quizzes taken yet.</p> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
          {history.map(item => (
            <div key={item.id} style={{ padding: '1.2rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid var(--card-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{item.custom_name || 'Untitled'}</div>
                <Link href={`/quiz?source=${item.source_link_id}`} className="secondary-btn" style={{ textDecoration: 'none' }}>Start Quiz</Link>
              </div>
              <div className="hint" style={{ textAlign: 'left', wordBreak: 'break-all', fontSize: '0.85rem' }}>
                {item.source_link.url.substring(0, 80)}...
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
