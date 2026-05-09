import { getSession } from '@/actions/auth'
import { getBookmarks, getHistory } from '@/actions/bookmarks'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function BookmarksPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const bookmarks = await getBookmarks()
  const history = await getHistory()

  // Group by source_link_id
  const grouped = new Map<number | null, typeof bookmarks>()
  for (const bm of bookmarks) {
    if (!grouped.has(bm.source_link_id)) {
      grouped.set(bm.source_link_id, [])
    }
    grouped.get(bm.source_link_id)!.push(bm)
  }

  return (
    <div className="container">
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', margin: 0 }}>Subjects</h1>
        <Link href="/" className="secondary-btn" style={{ textDecoration: 'none' }}>Main Menu</Link>
      </div>
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {Array.from(grouped.entries()).map(([sourceLinkId, bms]) => {
          let name = 'Custom Saved Text'
          if (sourceLinkId) {
            const histItem = history.find(h => h.source_link_id === sourceLinkId)
            if (histItem && histItem.custom_name) {
              name = histItem.custom_name
            } else if (bms[0] && bms[0].source_link) {
              name = bms[0].source_link.url
            } else {
              name = `Subject ${sourceLinkId}`
            }
          }
          
          return (
            <Link key={sourceLinkId ?? 'null'} href={`/quiz?source=${sourceLinkId || ''}&bookmarksOnly=true`} style={{ textDecoration: 'none' }}>
              <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid var(--card-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s' }}>
                <div>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', color: '#818cf8', wordBreak: 'break-all' }}>{name}</h3>
                  <div className="hint" style={{ textAlign: 'left' }}>{bms.length} Bookmarks</div>
                </div>
                <div style={{ fontSize: '1.5rem' }}>→</div>
              </div>
            </Link>
          )
        })}
        {grouped.size === 0 && <p className="hint">No bookmarks found.</p>}
      </div>
    </div>
  )
}
