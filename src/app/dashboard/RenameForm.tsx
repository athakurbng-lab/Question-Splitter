'use client'

import { useState } from 'react'
import { renameHistory } from '@/actions/bookmarks'
import { useRouter } from 'next/navigation'

export default function RenameForm({ historyId, initialName }: { historyId: string, initialName: string }) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(initialName)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSave = async () => {
    setLoading(true)
    await renameHistory(historyId, name)
    setIsEditing(false)
    setLoading(false)
    router.refresh()
  }

  if (isEditing) {
    return (
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input 
          type="text" 
          value={name} 
          onChange={e => setName(e.target.value)} 
          className="input-field" 
          style={{ marginBottom: 0, padding: '0.5rem', width: '150px' }} 
        />
        <button onClick={handleSave} disabled={loading} className="secondary-btn" style={{ background: '#10b981', color: 'white', border: 'none' }}>Save</button>
        <button onClick={() => setIsEditing(false)} className="secondary-btn">Cancel</button>
      </div>
    )
  }

  return (
    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
      {name}
      <button onClick={() => setIsEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem' }} title="Rename">✏️</button>
    </h3>
  )
}
