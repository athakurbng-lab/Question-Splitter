import { getSession, logout } from '@/actions/auth'
import { getBookmarks, getHistory, getResumeState } from '@/actions/bookmarks'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import RenameForm from './RenameForm'
import RemoveBookmarkForm from './RemoveBookmarkForm'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const history = await getHistory()
  const bookmarks = await getBookmarks()
  const resumeState = await getResumeState()

  return (
    <div className="container" style={{ maxWidth: '1000px' }}>
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', textAlign: 'left', margin: 0 }}>Dashboard</h1>
        <form action={logout}>
          <button className="secondary-btn" type="submit">Logout</button>
        </form>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/" className="btn-primary" style={{ width: 'auto' }}>+ New Flashcards</Link>
        {resumeState && (
          <Link href={`/?source=${resumeState.sourceLinkId}&q=${resumeState.questionNumber}`} className="btn-primary" style={{ width: 'auto', background: 'linear-gradient(135deg, #10b981, #059669)' }}>
            ▶ Resume Last Session
          </Link>
        )}
      </div>

      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        {/* History Panel */}
        <div className="panel" style={{ flex: 1, minWidth: '300px' }}>
          <h2 style={{ marginTop: 0 }}>My Links History</h2>
          {history.length === 0 ? <p className="hint" style={{ textAlign: 'left' }}>No links visited yet.</p> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {history.map(item => (
              <div key={item.id} style={{ padding: '1.2rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid var(--card-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <RenameForm historyId={item.id} initialName={item.custom_name || 'Untitled'} />
                  <Link href={`/?source=${item.source_link_id}`} className="secondary-btn" style={{ textDecoration: 'none' }}>Study</Link>
                </div>
                <div className="hint" style={{ textAlign: 'left', wordBreak: 'break-all', fontSize: '0.85rem' }}>
                  {item.source_link.url.substring(0, 50)}...
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bookmarks Panel */}
        <div className="panel" style={{ flex: 1, minWidth: '300px' }}>
          <h2 style={{ marginTop: 0 }}>My Bookmarks</h2>
          {bookmarks.length === 0 ? <p className="hint" style={{ textAlign: 'left' }}>No bookmarks yet.</p> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            {bookmarks.map(bm => (
              <div key={bm.id} style={{ padding: '1.2rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid var(--card-border)', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem' }}>
                  <RemoveBookmarkForm bookmarkId={bm.id} />
                </div>
                {bm.source_link_id ? (
                  <>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#818cf8' }}>Question {bm.question_number}</h3>
                    <div className="hint" style={{ textAlign: 'left', wordBreak: 'break-all', fontSize: '0.85rem', marginBottom: '1rem' }}>
                      From: {bm.source_link?.url.substring(0, 40)}...
                    </div>
                    <Link href={`/?source=${bm.source_link_id}&q=${bm.question_number}`} className="secondary-btn" style={{ textDecoration: 'none' }}>Jump to Question</Link>
                  </>
                ) : (
                  <>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem', color: '#818cf8' }}>Saved Text</h3>
                    <p style={{ margin: '0', fontSize: '0.95rem', color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>
                      {bm.question_text?.substring(0, 150)}{bm.question_text && bm.question_text.length > 150 ? '...' : ''}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
