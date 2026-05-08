import { Suspense } from 'react'
import FlashcardApp from './FlashcardApp'

export default function Home() {
  return (
    <Suspense fallback={<div className="container" style={{ textAlign: 'center' }}>Loading...</div>}>
      <FlashcardApp />
    </Suspense>
  )
}
