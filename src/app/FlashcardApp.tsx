'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { saveResumeState, getBookmarkedQuestionNumbers, toggleBookmarkState } from '@/actions/bookmarks'
import { getSourceUrl } from '@/actions/sources'
import Link from 'next/link'

type Question = {
  section: string;
  prefix: string;
  q: string;
  a: string;
  originalNumber: number;
}

export default function FlashcardApp() {
  const searchParams = useSearchParams()
  const sourceParam = searchParams.get('source')
  const qParam = searchParams.get('q')
  const customParam = searchParams.get('custom')
  const urlParam = searchParams.get('url')
  const bookmarksOnly = searchParams.get('bookmarksOnly') === 'true'

  const [loading, setLoading] = useState(true)
  const [allQuestions, setAllQuestions] = useState<Question[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [sections, setSections] = useState<string[]>([])
  
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showingAnswer, setShowingAnswer] = useState(false)
  const [qOnlyMode, setQOnlyMode] = useState(false)
  const [selectedSection, setSelectedSection] = useState('All')
  
  const [sourceLinkId, setSourceLinkId] = useState<number | null>(null)
  const [animating, setAnimating] = useState(false)
  const [bookmarkedNums, setBookmarkedNums] = useState<Set<number>>(new Set())
  const [flaggedNums, setFlaggedNums] = useState<Set<number>>(new Set())
  const [attemptLaterNums, setAttemptLaterNums] = useState<Set<number>>(new Set())
  const clickTimeout = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (clickTimeout.current) clearTimeout(clickTimeout.current)
    }
  }, [])

  async function fetchGDocText(url: string) {
    const docIdMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/)
    if (!docIdMatch) return ''
    const exportUrl = `https://docs.google.com/document/export?format=txt&id=${docIdMatch[1]}`
    const proxyUrl = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(exportUrl)}`
    const response = await fetch(proxyUrl)
    if (!response.ok) throw new Error('Failed to fetch document')
    return await response.text()
  }

  function parseTextContent(rawText: string, currentBookmarks: Set<number>, currentFlags: Set<number>) {
    const lines = rawText.split('\n')
    const processedText = lines.map(line => {
      const trimmed = line.trim()
      if (trimmed.match(/^Lec-\d+/i)) {
        return `\n===SECTION_MARKER===${trimmed}===SECTION_MARKER===\n`
      }
      return line
    }).join('\n')
    
    const regex = /(===SECTION_MARKER===[^=]+===SECTION_MARKER===|Q\s*\d+\s*\.)/i
    const tokens = processedText.split(regex)
    
    let newAllQs: Question[] = []
    const newSections = new Set<string>()
    let currentSec = "General"
    let qCounter = 1;
    
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
      
      const ansMatch = content.match(/(?:^|\n)\s*Ans\s*:/i) || content.match(/\s+Ans\s*:/i)
      
      if (ansMatch && ansMatch.index !== undefined) {
        questionText = content.substring(0, ansMatch.index).trim()
        answerText = content.substring(ansMatch.index + ansMatch[0].length).trim()
      } else {
        questionText = content.trim()
      }
      
      if (questionText || answerText) {
        newAllQs.push({
          section: currentSec,
          prefix: qPrefix,
          q: questionText,
          a: answerText,
          originalNumber: qCounter
        })
        newSections.add(currentSec)
        qCounter++;
      }
    }
    
    if (bookmarksOnly) {
      newAllQs = newAllQs.filter(q => currentBookmarks.has(q.originalNumber))
      const filteredSections = new Set<string>()
      newAllQs.forEach(q => filteredSections.add(q.section))
      setSections(Array.from(filteredSections))
    } else {
      const secArray = Array.from(newSections)
      if (newAllQs.some(q => q.section === "General") && !secArray.includes("General")) {
        secArray.unshift("General")
      }
      setSections(secArray)
    }

    if (newAllQs.length > 0) {
      setAllQuestions(newAllQs)

      let initialFiltered = newAllQs;
      if (!bookmarksOnly) {
        initialFiltered = newAllQs.filter(q => !currentFlags.has(q.originalNumber))
      }
      setQuestions(initialFiltered)
      
      let initialIdx = 0
      if (qParam && !bookmarksOnly) {
        const targetQ = parseInt(qParam)
        const idx = initialFiltered.findIndex(q => q.originalNumber === targetQ)
        if (idx !== -1) initialIdx = idx
      }
      
      setSelectedSection('All')
      setCurrentIndex(initialIdx)
      setShowingAnswer(false)
    }
    setLoading(false)
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        let rawText = ''
        let sid = null
        if (sourceParam) {
          const id = parseInt(sourceParam)
          if (!isNaN(id)) {
            sid = id
            setSourceLinkId(id)
            const url = await getSourceUrl(id)
            if (url) {
              rawText = await fetchGDocText(url)
            }
          }
        } else if (urlParam) {
          rawText = await fetchGDocText(urlParam)
        } else if (customParam) {
          rawText = localStorage.getItem('temp_quiz_text') || ''
        }

        if (rawText) {
          let bms = new Set<number>()
          let flags = new Set<number>()
          if (sid) {
            const nums = await getBookmarkedQuestionNumbers(sid)
            bms = new Set(nums.filter(n => n > 0))
            flags = new Set(nums.filter(n => n < 0).map(n => Math.abs(n)))
            setBookmarkedNums(bms)
            setFlaggedNums(flags)
          }
          parseTextContent(rawText, bms, flags)
        } else {
          setLoading(false)
        }
      } catch (e) {
        console.error(e)
        setLoading(false)
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceParam, urlParam, customParam])

  // Resuming
  useEffect(() => {
    if (sourceLinkId && questions.length > 0 && allQuestions.length > 0) {
      const card = questions[currentIndex]
      if (card) {
        saveResumeState(sourceLinkId, card.originalNumber).catch(console.error)
      }
    }
  }, [currentIndex, sourceLinkId, questions, allQuestions])

  function triggerAnimation() {
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

  const handleBookmarkToggle = async () => {
    const card = questions[currentIndex]
    if (!sourceLinkId) {
      alert("Cannot bookmark custom text correctly without saving it properly yet.")
      return
    }
    try {
      const isNowBookmarked = await toggleBookmarkState(sourceLinkId, card.originalNumber, card.prefix, card.q, card.a || '')
      setBookmarkedNums(prev => {
        const next = new Set(prev)
        if (isNowBookmarked) next.add(card.originalNumber)
        else next.delete(card.originalNumber)
        return next
      })
      if (isNowBookmarked) {
        setFlaggedNums(prev => {
          const next = new Set(prev)
          next.delete(card.originalNumber)
          return next
        })
      }
    } catch {
      alert('Failed to bookmark. Are you logged in?')
    }
  }

  const handleFlagToggle = async () => {
    const card = questions[currentIndex]
    if (!sourceLinkId) return
    try {
      const isNowFlagged = await toggleBookmarkState(sourceLinkId, -card.originalNumber, card.prefix, card.q, card.a || '')
      setFlaggedNums(prev => {
        const next = new Set(prev)
        if (isNowFlagged) next.add(card.originalNumber)
        else next.delete(card.originalNumber)
        return next
      })
      if (isNowFlagged) {
        setBookmarkedNums(prev => {
          const next = new Set(prev)
          next.delete(card.originalNumber)
          return next
        })
      }
    } catch {
      alert('Failed to flag. Are you logged in?')
    }
  }

  const handleBookmarkAction = () => {
    if (clickTimeout.current) {
      clearTimeout(clickTimeout.current)
      clickTimeout.current = null
      handleFlagToggle() // Double click
    } else {
      clickTimeout.current = setTimeout(() => {
        handleBookmarkToggle() // Single click
        clickTimeout.current = null
      }, 250)
    }
  }

  const handleAttemptLaterToggle = () => {
    if (!questions[currentIndex]) return
    const currentNum = questions[currentIndex].originalNumber
    setAttemptLaterNums(prev => {
      const next = new Set(prev)
      if (next.has(currentNum)) next.delete(currentNum)
      else next.add(currentNum)
      return next
    })
  }

  useEffect(() => {
    if (allQuestions.length === 0) return;

    let filtered = allQuestions;

    if (selectedSection === 'AttemptLater') {
      if (attemptLaterNums.size === 0) {
        setSelectedSection('All');
        return; 
      }
      filtered = filtered.filter(q => attemptLaterNums.has(q.originalNumber));
    } else if (selectedSection === 'FlaggedQuestions') {
      if (flaggedNums.size === 0 && !bookmarksOnly) {
        setSelectedSection('All');
        return;
      }
      filtered = filtered.filter(q => flaggedNums.has(q.originalNumber));
    } else {
      if (selectedSection !== 'All') {
        filtered = filtered.filter(q => q.section === selectedSection);
      }
      filtered = filtered.filter(q => !flaggedNums.has(q.originalNumber));
    }

    setQuestions(filtered);
    setCurrentIndex(prev => {
      if (filtered.length === 0) return 0;
      return Math.max(0, Math.min(prev, filtered.length - 1));
    });
  }, [selectedSection, attemptLaterNums, flaggedNums, allQuestions, bookmarksOnly]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (attemptLaterNums.size > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [attemptLaterNums.size])

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (attemptLaterNums.size > 0) {
      if (!window.confirm("You have questions in your 'Attempt Later' list. Are you sure you want to leave?")) {
        e.preventDefault()
      }
    }
  }

  if (loading) {
    return <div className="container" style={{ textAlign: 'center' }}>Loading Quiz...</div>
  }

  if (allQuestions.length === 0) {
    return (
      <div className="container" style={{ textAlign: 'center' }}>
        <div className="panel">
          <h2>No questions found!</h2>
          <p>We couldn&apos;t find any questions. {bookmarksOnly ? "Maybe you haven't bookmarked any?" : "Check the document format."}</p>
          <Link href="/take-quiz" className="btn-primary" onClick={handleLinkClick}>Go Back</Link>
        </div>
      </div>
    )
  }

  const card = questions[currentIndex]
  const isBookmarked = bookmarkedNums.has(card?.originalNumber)

  return (
    <div className="container">
      <div className="header" style={{ position: 'relative', marginBottom: 0 }}>
        <div style={{ position: 'absolute', top: 0, right: 0, display: 'flex', gap: '0.5rem' }}>
          <Link href={bookmarksOnly ? "/bookmarks" : "/take-quiz"} onClick={handleLinkClick} className="secondary-btn" style={{ textDecoration: 'none' }}>Back</Link>
          <Link href="/dashboard" onClick={handleLinkClick} className="secondary-btn" style={{ textDecoration: 'none' }}>Dashboard</Link>
        </div>
        <h1 style={{ fontSize: '2rem', textAlign: 'left' }}>{bookmarksOnly ? 'Bookmarked Questions' : 'Quiz Session'}</h1>
      </div>

      <div className="panel flashcard-view" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '-1rem' }}>
        <div className="top-bar">
          <div className="progress">
            <span className="progress-text">{currentIndex + 1} / {questions.length}</span>
            <div className="jump-container" style={{ display: 'flex', gap: '0.5rem' }}>
              <select 
                className="jump-input" 
                value={currentIndex}
                onChange={e => {
                  const val = parseInt(e.target.value)
                  if (!isNaN(val) && val >= 0 && val < questions.length) {
                    setCurrentIndex(val)
                    setShowingAnswer(false)
                    triggerAnimation()
                  }
                }}
                style={{ width: '80px' }}
              >
                {questions.map((q, idx) => (
                  <option key={idx} value={idx}>{bookmarksOnly ? q.originalNumber : idx + 1}</option>
                ))}
              </select>
            </div>
            
            {sections.length > 0 && (
              <select 
                className="jump-input" 
                value={selectedSection}
                onChange={e => {
                  setSelectedSection(e.target.value)
                  setCurrentIndex(0)
                  setShowingAnswer(false)
                  triggerAnimation()
                }}
              >
                <option value="All">All Sections</option>
                {sections.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                {attemptLaterNums.size > 0 && (
                  <option value="AttemptLater">Attempt Later ({attemptLaterNums.size})</option>
                )}
                {flaggedNums.size > 0 && !bookmarksOnly && (
                  <option value="FlaggedQuestions">🚩 Flagged ({flaggedNums.size})</option>
                )}
              </select>
            )}
          </div>
          <div className="settings">
            <button 
              className="secondary-btn" 
              onClick={handleBookmarkAction} 
              title={isBookmarked ? "Remove bookmark" : "Bookmark this question (Double click to Flag)"}
              style={{ color: isBookmarked ? '#f59e0b' : 'inherit', borderColor: isBookmarked ? '#f59e0b' : 'inherit' }}
            >
              {isBookmarked ? '★ Bookmarked' : '☆ Bookmark'}
            </button>
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
          <div className={`flashcard ${animating ? 'animating' : ''}`} onDoubleClick={handleAttemptLaterToggle}>
            <div className="q-number">
              {card.prefix} (Q{card.originalNumber})
              {attemptLaterNums.has(card.originalNumber) && (
                <span style={{ marginLeft: '10px', fontSize: '0.8em', color: '#eab308', backgroundColor: '#fef08a20', padding: '2px 6px', borderRadius: '4px' }}>
                  📝 Attempt Later
                </span>
              )}
              {flaggedNums.has(card.originalNumber) && (
                <span style={{ marginLeft: '10px', fontSize: '0.8em', color: '#ef4444', backgroundColor: '#fee2e2', padding: '2px 6px', borderRadius: '4px' }}>
                  🚩 Flagged
                </span>
              )}
            </div>
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
