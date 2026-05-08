'use client'

import { removeBookmark } from '@/actions/bookmarks'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function RemoveBookmarkForm({ bookmarkId }: { bookmarkId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleRemove = async () => {
    setLoading(true)
    await removeBookmark(bookmarkId)
    setLoading(false)
    router.refresh()
  }

  return (
    <button 
      onClick={handleRemove} 
      disabled={loading}
      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.2rem', padding: '0.5rem' }}
      title="Remove Bookmark"
    >
      🗑️
    </button>
  )
}
