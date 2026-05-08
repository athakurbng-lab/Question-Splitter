'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { addSourceLink, addToHistory, addBookmark, saveResumeState } from '@/actions/bookmarks'
import { getSourceUrl } from '@/actions/sources'
import Link from 'next/link'

type Question = {
  section: string;
  prefix: string;
  q: string;
  a: string;
}

export default function FlashcardApp() {
  const searchParams = useSearchParams()
  const sourceParam = searchParams.get('source')
  const qParam = searchParams.get('q')

  const [textInput, setTextInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [allQuestions, setAllQuestions] = useState<Question[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [sections, setSections] = useState<string[]>([])
  
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showingAnswer, setShowingAnswer] = useState(false)
  const [qOnlyMode, setQOnlyMode] = useState(false)
  const [selectedSection, setSelectedSection] = useState('All')
  
  const [sourceLinkId, setSourceLinkId] = useState<number | null>(null)
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (sourceParam) {
      const id = parseInt(sourceParam)
      if (!isNaN(id)) {
        setSourceLinkId(id)
        loadFromSourceId(id)
      }
    }
  }, [sourceParam])

  useEffect(() => {
    if (sourceLinkId && questions.length > 0 && allQuestions.length > 0) {
      const absoluteIndex = allQuestions.indexOf(questions[currentIndex]) + 1
      if (absoluteIndex > 0) {
        saveResumeState(sourceLinkId, absoluteIndex).catch(console.error)
      }
    }
  }, [currentIndex, sourceLinkId, questions, allQuestions])

  const loadFromSourceId = async (id: number) => {
    setLoading(true)
    try {
      const url = await getSourceUrl(id)
      if (url) {
        await processUrl(url)
        if (qParam) {
          const qIdx = parseInt(qParam) - 1
          if (!isNaN(qIdx) && qIdx >= 0) {
            setCurrentIndex(qIdx)
          }
        }
      }
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  const processUrl = async (url: string) => {
    const docIdMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/)
    if (!docIdMatch) {
      alert('Invalid Google Docs URL.')
      return
    }
    const docId = docIdMatch[1]
    const exportUrl = `https://docs.google.com/document/export?format=txt&id=${docId}`
    const proxyUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(exportUrl)}`
    
    const response = await fetch(proxyUrl)
    if (!response.ok) throw new Error('Failed to fetch document')
    const rawText = await response.text()
    
    parseTextContent(rawText)
  }

  const handleProcessClick = async () => {
    if (!textInput.trim()) return

    setLoading(true)
    try {
      const gdocMatch = textInput.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/)
      
      if (gdocMatch) {
        const url = gdocMatch[0]
        try {
          const source = await addSourceLink(`https://${url}`)
          setSourceLinkId(source.id)
          await addToHistory(source.id)
        } catch(e) {
          console.error("Not logged in or db error", e)
        }
        await processUrl(`https://${url}`)
      } else {
        setSourceLinkId(null)
        parseTextContent(textInput)
      }
    } catch (err: any) {
      alert("Error: " + err.message)
    }
    setLoading(false)
  }

  const parseTextContent = (rawText: string) => {
    const lines = rawText.split('\n')
    let processedText = lines.map(line => {
      const trimmed = line.trim()
      if (trimmed.match(/^Lec-\d+/i)) {
        return `\n===SECTION_MARKER===${trimmed}===SECTION_MARKER===\n`
      }
      return line
    }).join('\n')
    
    const regex = /(===SECTION_MARKER===[^=]+===SECTION_MARKER===|Q\s*\d+\s*\.)/i
    const tokens = processedText.split(regex)
    
    const newAllQs: Question[] = []
    const newSections = new Set<string>()
    let currentSec = "General"
    
    for (let i = 1; i < tokens.length; i += 2) {
      const token = tokens[i].trim()
      const content = (tokens[i+1] || "").trim()
      
      if (token.startsWith('===SECTION_MARKER===')) {
        currentSec = token.replace(/===SECTION_MARKER===/g, '').trim() || "General"
        newSections.add(currentSec)
        continue
      }
      
      const qPrefix = token.toUpperCase()
      let questionText = ""
      let answerText = ""
      
      let ansMatch = content.match(/(?:^|\n)\s*Ans\s*:/i) || content.match(/\s+Ans\s*:/i)
      
      if (ansMatch && ansMatch.index !== undefined) {
        questionText = content.substring(0, ansMatch.index).trim()
        answerText = content.substring(ansMatch.index + ansMatch[0].length).trim()
      } else {
        questionText = content.trim()
      }
      
      if (questionText || answerText) {
        newSections.add(currentSec)
        newAllQs.push({
          section: currentSec,
          prefix: qPrefix,
          q: questionText,
          a: answerText
        })
      }
    }
    
    if (newAllQs.length > 0) {
      setAllQuestions(newAllQs)
      setQuestions(newAllQs)
      
      const secArray = Array.from(newSections)
      if (newAllQs.some(q => q.section === "General") && !secArray.includes("General")) {
        secArray.unshift("General")
      }
      setSections(secArray)
      setSelectedSection('All')
      setCurrentIndex(0)
      setShowingAnswer(false)
    } else {
      alert("No questions found! Make sure to use the format 'Q1. ... Ans: ...'")
    }
  }

  const triggerAnimation = () => {
    setAnimating(false)
    setTimeout(() => setAnimating(true), 10)
  }

  const handleNext = useCallback(() => {
    if (questions.length === 0) return
    const card = questions[currentIndex]
    
    if (!qOnlyMode && card.a && !showingAnswer) {
      setShowingAnswer(true)
    } else {
      setCurrentIndex(prev => (prev < questions.length - 1 ? prev + 1 : 0))
      setShowingAnswer(false)
      triggerAnimation()
    }
  }, [questions, currentIndex, qOnlyMode, showingAnswer])

  const handlePrev = useCallback(() => {
    if (questions.length === 0) return
    setCurrentIndex(prev => (prev > 0 ? prev - 1 : questions.length - 1))
    setShowingAnswer(false)
    triggerAnimation()
  }, [questions])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (allQuestions.length === 0) return
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'SELECT') return

      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNext, handlePrev, allQuestions.length])

  const handleBookmark = async () => {
    const card = questions[currentIndex]
    try {
      if (sourceLinkId) {
        const absoluteIndex = allQuestions.indexOf(card) + 1
        await addBookmark({ source_link_id: sourceLinkId, question_number: absoluteIndex })
      } else {
        await addBookmark({ question_text: `${card.prefix} ${card.q}\nAns: ${card.a}` })
      }
      alert('Bookmarked successfully!')
    } catch (e) {
      alert('Failed to bookmark. Are you logged in?')
    }
  }

  if (allQuestions.length === 0) {
    return (
      <div className="container">
        <div className="header" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, right: 0 }}>
            <Link href="/dashboard" className="secondary-btn" style={{ textDecoration: 'none' }}>Dashboard</Link>
          </div>
          <h1>QA Flashcards</h1>
          <p>Turn your text into interactive study cards instantly.</p>
        </div>

        <div className="panel">
          <textarea 
            placeholder="Paste your text or Google Docs link here...

Example:
Q1. What is the capital of France?
Ans: Paris" 
            className="input-field" 
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
          />
          <button className="btn-primary" onClick={handleProcessClick} disabled={loading}>
            {loading ? '⏳ Processing...' : '✨ Process & Start'}
          </button>
        </div>
      </div>
    )
  }

  const card = questions[currentIndex]

  return (
    <div className="container">
      <div className="header" style={{ position: 'relative', marginBottom: 0 }}>
        <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: '0.5rem' }}>
          <button className="secondary-btn" onClick={() => setAllQuestions([])}>✏️ Edit</button>
          <Link href="/dashboard" className="secondary-btn" style={{ textDecoration: 'none' }}>Dashboard</Link>
        </div>
        <h1 style={{ fontSize: '2rem', textAlign: 'left' }}>QA Flashcards</h1>
      </div>

      <div className="panel flashcard-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '-1rem' }}>
        <div className="top-bar">
          <div className="progress">
            <span className="progress-text">{currentIndex + 1} / {questions.length}</span>
            <input 
              type="number" 
              className="jump-input" 
              min="1" 
              max={questions.length}
              placeholder="Jump" 
              title="Jump to question"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = parseInt((e.target as HTMLInputElement).value)
                  if (!isNaN(val) && val >= 1 && val <= questions.length) {
                    setCurrentIndex(val - 1)
                    setShowingAnswer(false)
                    triggerAnimation()
                    ;(e.target as HTMLInputElement).value = ''
                    ;(e.target as HTMLInputElement).blur()
                  }
                }
              }}
            />
            <select 
              className="jump-input" 
              value={selectedSection}
              onChange={e => {
                const sec = e.target.value
                setSelectedSection(sec)
                if (sec === 'All') {
                  setQuestions(allQuestions)
                } else {
                  setQuestions(allQuestions.filter(q => q.section === sec))
                }
                setCurrentIndex(0)
                setShowingAnswer(false)
                triggerAnimation()
              }}
            >
              <option value="All">All Sections</option>
              {sections.map(sec => <option key={sec} value={sec}>{sec}</option>)}
            </select>
          </div>
          <div className="settings">
            <button className="secondary-btn" onClick={handleBookmark} title="Bookmark this question">⭐ Bookmark</button>
            <label className="toggle-label" title="Show questions only, skip answers">
              <input type="checkbox" checked={qOnlyMode} onChange={e => {
                setQOnlyMode(e.target.checked)
                setShowingAnswer(false)
              }} /> Q-Only
            </label>
            <button className="secondary-btn" onClick={() => {
              const shuffled = [...questions]
              for (let i = shuffled.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
              }
              setQuestions(shuffled)
              setCurrentIndex(0)
              setShowingAnswer(false)
              triggerAnimation()
            }} title="Shuffle questions">🔀 Shuffle</button>
          </div>
        </div>

        {questions.length > 0 ? (
          <div className={`flashcard ${animating ? 'animating' : ''}`}>
            <div className="q-number">{card.prefix}</div>
            <div className="card-content">{card.q || "(Empty Question)"}</div>
            {(!qOnlyMode && showingAnswer && card.a) && (
              <div className="answer-content visible">{card.a}</div>
            )}
          </div>
        ) : (
          <div className="flashcard">
            <div className="card-content">No questions found in this section.</div>
          </div>
        )}

        <div className="controls">
          <button className="btn-nav btn-prev" onClick={handlePrev}>← Previous</button>
          <div className="hint">Press <kbd>Space</kbd> or <kbd>Enter</kbd> for next</div>
          <button className="btn-nav" onClick={handleNext}>
            {(qOnlyMode || !card?.a || showingAnswer) ? 'Next Question →' : 'Show Answer →'}
          </button>
        </div>
      </div>
    </div>
  )
}
