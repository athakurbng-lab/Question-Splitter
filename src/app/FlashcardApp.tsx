'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { saveResumeState, getBookmarkedQuestionNumbers, toggleBookmarkState } from '@/actions/bookmarks'
import { getSourceUrl, fetchGDocTextServer } from '@/actions/sources'
import { getSession } from '@/actions/auth'
import { broadcastQuizEvent } from '@/actions/sync'
import { getPusherClient } from '@/lib/pusher-client'
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
  const [error, setError] = useState<string | null>(null)
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
  const [timeSpent, setTimeSpent] = useState(0)
  const clickTimeout = useRef<NodeJS.Timeout | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const pusherSocketId = useRef<string | null>(null)
  const hasReceivedFullState = useRef(false)
  const [customOrder, setCustomOrder] = useState<number[] | null>(null)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const pendingReceive = useRef(false)

  const syncStateRef = useRef({
    currentIndex,
    attemptLaterNums,
    selectedSection,
    bookmarkedNums,
    flaggedNums,
    customOrder,
    showingAnswer
  })

  useEffect(() => {
    syncStateRef.current = { currentIndex, attemptLaterNums, selectedSection, bookmarkedNums, flaggedNums, customOrder, showingAnswer }
  }, [currentIndex, attemptLaterNums, selectedSection, bookmarkedNums, flaggedNums, customOrder, showingAnswer])

  useEffect(() => {
    getSession().then(session => {
      if (session) setUserId(session.userId)
    }).catch(console.error)

    return () => {
      if (clickTimeout.current) clearTimeout(clickTimeout.current)
    }
  }, [])

  // Pusher setup
  useEffect(() => {
    if (!userId) return

    const pusher = getPusherClient()
    if (!pusher) return

    hasReceivedFullState.current = false // Reset state assumption on remount or source change

    const requestFullState = () => {
      if (sourceLinkId && pusher.connection.socket_id) {
        broadcastQuizEvent({
          eventName: 'request-full-state',
          payload: { sourceLinkId, requesterSocketId: pusher.connection.socket_id },
          socketId: pusher.connection.socket_id
        }).catch(console.error)
      }
    }

    const handleConnected = () => {
      pusherSocketId.current = pusher.connection.socket_id
      requestFullState()
    }

    if (pusher.connection.state === 'connected') {
      pusherSocketId.current = pusher.connection.socket_id
      requestFullState()
    } else {
      pusher.connection.bind('connected', handleConnected)
    }

    const channel = pusher.subscribe(`private-user-${userId}`)

    // 1. Listen for requests for full state
    const handleRequestFullState = (data: any) => {
      if (sourceLinkId && data.sourceLinkId === sourceLinkId) {
        const { currentIndex: refIndex, attemptLaterNums: refAttempt, selectedSection: refSection, bookmarkedNums: refBookmarks, flaggedNums: refFlags, customOrder: refOrder } = syncStateRef.current
        if (refAttempt.size > 0 || refIndex > 0 || refSection !== 'All' || refBookmarks.size > 0 || refFlags.size > 0 || refOrder) {
          const payload: any = {
            sourceLinkId,
            targetSocketId: data.requesterSocketId,
            currentIndex: refIndex,
            attemptLaterNums: Array.from(refAttempt),
            selectedSection: refSection,
            bookmarkedNums: Array.from(refBookmarks),
            flaggedNums: Array.from(refFlags)
          }
          if (refOrder) payload.customOrder = refOrder

          broadcastQuizEvent({
            eventName: 'full-state',
            payload,
            socketId: pusherSocketId.current || undefined
          }).catch(console.error)
        }
      }
    }
    channel.bind('request-full-state', handleRequestFullState)

    // 2. Listen for full state responses
    const handleFullState = (data: any) => {
      if (sourceLinkId && data.sourceLinkId === sourceLinkId) {
        // Target filtering
        if (data.targetSocketId && data.targetSocketId !== pusherSocketId.current) {
          return
        }
        
        // First Response Strategy
        if (hasReceivedFullState.current) {
          return
        }
        hasReceivedFullState.current = true

        if (data.selectedSection) setSelectedSection(data.selectedSection)
        if (data.currentIndex !== undefined) setCurrentIndex(data.currentIndex)
        if (data.attemptLaterNums) setAttemptLaterNums(new Set(data.attemptLaterNums))
        if (data.bookmarkedNums) setBookmarkedNums(new Set(data.bookmarkedNums))
        if (data.flaggedNums) setFlaggedNums(new Set(data.flaggedNums))
        if (data.customOrder) setCustomOrder(data.customOrder)
      }
    }
    channel.bind('full-state', handleFullState)

    const applySyncState = (data: any) => {
      if (data.url && data.url !== window.location.href) {
        localStorage.setItem('pendingSyncState', JSON.stringify(data));
        window.location.href = data.url;
        return;
      }
      
      if (data.customOrder !== undefined) setCustomOrder(data.customOrder)
      if (data.selectedSection !== undefined) setSelectedSection(data.selectedSection)
      if (data.currentIndex !== undefined) setCurrentIndex(data.currentIndex)
      if (data.showingAnswer !== undefined) setShowingAnswer(data.showingAnswer)
      if (data.attemptLaterNums) setAttemptLaterNums(new Set(data.attemptLaterNums))
      if (data.bookmarkedNums) setBookmarkedNums(new Set(data.bookmarkedNums))
      if (data.flaggedNums) setFlaggedNums(new Set(data.flaggedNums))
    }

    // 3. Listen for manual sync
    const handleForceSync = (data: any) => {
      // Ignore self
      if (data.senderSocketId === pusherSocketId.current) return;
      applySyncState(data);
    }
    channel.bind('force-sync', handleForceSync)

    const handleSyncResponse = (data: any) => {
      if (data.targetSocketId !== pusherSocketId.current) return;
      if (pendingReceive.current) {
        pendingReceive.current = false;
        applySyncState(data);
      }
    }
    channel.bind('sync-response', handleSyncResponse)

    const handleRequestSync = (data: any) => {
      if (data.requesterSocketId === pusherSocketId.current) return;
      const state = syncStateRef.current;
      broadcastQuizEvent({
        eventName: 'sync-response',
        payload: {
          url: window.location.href,
          sourceLinkId,
          currentIndex: state.currentIndex,
          selectedSection: state.selectedSection,
          showingAnswer: state.showingAnswer,
          customOrder: state.customOrder,
          attemptLaterNums: Array.from(state.attemptLaterNums),
          bookmarkedNums: Array.from(state.bookmarkedNums),
          flaggedNums: Array.from(state.flaggedNums),
          targetSocketId: data.requesterSocketId
        },
        socketId: pusherSocketId.current || undefined
      }).catch(console.error)
    }
    channel.bind('request-sync', handleRequestSync)

    return () => {
      pusher.connection.unbind('connected', handleConnected)
      channel.unbind('request-full-state', handleRequestFullState)
      channel.unbind('full-state', handleFullState)
      channel.unbind('force-sync', handleForceSync)
      channel.unbind('sync-response', handleSyncResponse)
      channel.unbind('request-sync', handleRequestSync)
    }
  }, [userId, sourceLinkId])

  // Broadcast manual sync
  const handleSendSync = useCallback(() => {
    setShowSyncModal(false);
    if (!pusherSocketId.current) return
    broadcastQuizEvent({
      eventName: 'force-sync',
      payload: { 
        url: window.location.href,
        sourceLinkId,
        currentIndex,
        selectedSection,
        showingAnswer,
        customOrder,
        attemptLaterNums: Array.from(attemptLaterNums),
        bookmarkedNums: Array.from(bookmarkedNums),
        flaggedNums: Array.from(flaggedNums),
        senderSocketId: pusherSocketId.current
      },
      socketId: pusherSocketId.current
    }).catch(console.error)
  }, [sourceLinkId, currentIndex, selectedSection, showingAnswer, customOrder, attemptLaterNums, bookmarkedNums, flaggedNums])

  const handleReceiveSync = () => {
    if (!pusherSocketId.current) return;
    pendingReceive.current = true;
    setShowSyncModal(false);
    broadcastQuizEvent({
      eventName: 'request-sync',
      payload: { requesterSocketId: pusherSocketId.current },
      socketId: pusherSocketId.current
    }).catch(console.error);
  }

  async function fetchGDocText(url: string) {
    return await fetchGDocTextServer(url)
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
      setError(null)
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
          
          const pending = localStorage.getItem('pendingSyncState')
          if (pending) {
            try {
              const data = JSON.parse(pending)
              if (data.url === window.location.href) {
                if (data.customOrder !== undefined) setCustomOrder(data.customOrder)
                if (data.selectedSection !== undefined) setSelectedSection(data.selectedSection)
                if (data.currentIndex !== undefined) setCurrentIndex(data.currentIndex)
                if (data.showingAnswer !== undefined) setShowingAnswer(data.showingAnswer)
                if (data.attemptLaterNums) setAttemptLaterNums(new Set(data.attemptLaterNums))
                if (data.bookmarkedNums) setBookmarkedNums(new Set(data.bookmarkedNums))
                if (data.flaggedNums) setFlaggedNums(new Set(data.flaggedNums))
              }
            } catch (e) {
              console.error('Failed to parse pending sync state', e)
            } finally {
              localStorage.removeItem('pendingSyncState')
            }
          }
        } else {
          setLoading(false)
        }
      } catch (e) {
        console.error(e)
        setError(e instanceof Error ? e.message : String(e))
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
    const latestIndex = syncStateRef.current.currentIndex
    const card = questions[latestIndex]
    
    if (!qOnlyMode && card && card.a && !showingAnswer) {
      setShowingAnswer(true)
    } else {
      const next = latestIndex < questions.length - 1 ? latestIndex + 1 : 0
      syncStateRef.current.currentIndex = next
      setCurrentIndex(next)
      setShowingAnswer(false)
      triggerAnimation()
    }
  }, [questions, qOnlyMode, showingAnswer])

  const handlePrev = useCallback(() => {
    if (questions.length === 0) return
    const latestIndex = syncStateRef.current.currentIndex
    const next = latestIndex > 0 ? latestIndex - 1 : questions.length - 1
    syncStateRef.current.currentIndex = next
    setCurrentIndex(next)
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
      
      const wasFlagged = flaggedNums.has(card.originalNumber)

      setBookmarkedNums(prev => {
        const next = new Set(prev)
        if (isNowBookmarked) next.add(card.originalNumber)
        else next.delete(card.originalNumber)
        return next
      })
      setFlaggedNums(prev => {
        const next = new Set(prev)
        if (wasFlagged && isNowBookmarked) {
          next.delete(card.originalNumber)
        }
        return next
      })
    } catch {
      alert('Failed to bookmark. Are you logged in?')
    }
  }

  const handleFlagToggle = async () => {
    const card = questions[currentIndex]
    if (!sourceLinkId) return
    try {
      const isNowFlagged = await toggleBookmarkState(sourceLinkId, -card.originalNumber, card.prefix, card.q, card.a || '')
      
      const wasBookmarked = bookmarkedNums.has(card.originalNumber)

      setFlaggedNums(prev => {
        const next = new Set(prev)
        if (isNowFlagged) next.add(card.originalNumber)
        else next.delete(card.originalNumber)
        return next
      })
      setBookmarkedNums(prev => {
        const next = new Set(prev)
        if (wasBookmarked && isNowFlagged) {
          next.delete(card.originalNumber)
        }
        return next
      })
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
    
    const isAdding = !attemptLaterNums.has(currentNum)

    setAttemptLaterNums(prev => {
      const next = new Set(prev)
      if (isAdding) next.add(currentNum)
      else next.delete(currentNum)
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

    if (customOrder) {
      const orderMap = new Map(customOrder.map((num, i) => [num, i]))
      filtered.sort((a, b) => {
        const indexA = orderMap.has(a.originalNumber) ? orderMap.get(a.originalNumber)! : Infinity
        const indexB = orderMap.has(b.originalNumber) ? orderMap.get(b.originalNumber)! : Infinity
        return indexA - indexB
      })
    }

    setQuestions(filtered);
    setCurrentIndex(prev => {
      if (filtered.length === 0) return 0;
      return Math.max(0, Math.min(prev, filtered.length - 1));
    });
  }, [selectedSection, attemptLaterNums, flaggedNums, allQuestions, bookmarksOnly, customOrder]);

  useEffect(() => {
    setTimeSpent(0)
  }, [questions[currentIndex]?.originalNumber])

  useEffect(() => {
    if (questions.length === 0 || showingAnswer) return
    const interval = setInterval(() => {
      setTimeSpent(prev => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [questions.length, currentIndex, showingAnswer])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

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

  if (error) {
    return (
      <div className="container" style={{ textAlign: 'center' }}>
        <div className="panel" style={{ borderTop: '4px solid #ef4444' }}>
          <h2 style={{ color: '#ef4444', marginTop: 0 }}>Error Loading Document</h2>
          <p style={{ margin: '1.5rem 0', lineHeight: '1.6' }}>{error}</p>
          <Link href="/take-quiz" className="btn-primary" onClick={handleLinkClick}>Go Back</Link>
        </div>
      </div>
    )
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
      {showSyncModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="panel" style={{ maxWidth: '400px', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>Sync State</h3>
            <p style={{ margin: '1rem 0' }}>Do you want to send your current state to other devices, or receive the state from them?</p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={handleSendSync}>📤 Send to Others</button>
              <button className="btn-primary" onClick={handleReceiveSync}>📥 Receive from Others</button>
              <button className="secondary-btn" onClick={() => setShowSyncModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="app-header">
        <h1>{bookmarksOnly ? 'Bookmarked Questions' : 'Quiz Session'}</h1>
        <div className="header-actions">
          <Link href={bookmarksOnly ? "/bookmarks" : "/take-quiz"} onClick={handleLinkClick} className="secondary-btn">Back</Link>
          <Link href="/dashboard" onClick={handleLinkClick} className="secondary-btn">Dashboard</Link>
        </div>
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
                  const val = e.target.value
                  setSelectedSection(val)
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
            <div className="timer" style={{ display: 'flex', alignItems: 'center', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '1.2rem', padding: '0 10px', color: '#6366f1' }} title="Time spent on this question">
              ⏱ {formatTime(timeSpent)}
            </div>
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
              const order = shuffled.map(q => q.originalNumber)
              setCustomOrder(order)
              setQuestions(shuffled)
              setCurrentIndex(0)
              setShowingAnswer(false)
              triggerAnimation()
            }} title="Shuffle questions">🔀 Shuffle</button>
            <button className="secondary-btn" onClick={() => setShowSyncModal(true)} title="Sync state to other devices">
              🔄 Sync
            </button>
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
