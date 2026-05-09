'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { addSourceLink, addToHistory } from '@/actions/bookmarks'

export default function TakeQuizClient() {
  const [textInput, setTextInput] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleProcessClick = async () => {
    if (!textInput.trim()) return
    setLoading(true)
    try {
      const gdocMatch = textInput.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/)
      if (gdocMatch) {
        const url = gdocMatch[0]
        try {
          const source = await addSourceLink(`https://${url}`)
          await addToHistory(source.id)
          router.push(`/quiz?source=${source.id}`)
        } catch {
          router.push(`/quiz?url=${encodeURIComponent('https://' + url)}`)
        }
      } else {
        localStorage.setItem('temp_quiz_text', textInput)
        router.push(`/quiz?custom=true`)
      }
    } catch (err) {
      alert("Error: " + (err instanceof Error ? err.message : String(err)))
    }
    setLoading(false)
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>New Quiz</h2>
      <textarea 
        placeholder="Paste your text or Google Docs link here..." 
        className="input-field" 
        value={textInput}
        onChange={e => setTextInput(e.target.value)}
      />
      <button className="btn-primary" onClick={handleProcessClick} disabled={loading}>
        {loading ? '⏳ Processing...' : '✨ Process & Start'}
      </button>
    </div>
  )
}
