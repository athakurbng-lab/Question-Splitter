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
  const [completedNums, setCompletedNums] = useState<Set<number>>(new Set())
  const [attemptLaterNums, setAttemptLaterNums] = useState<Set<number>>(new Set())
  const [timeSpent, setTimeSpent] = useState(0)
  const clickTimeout = useRef<NodeJS.Timeout | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const pusherSocketId = useRef<string | null>(null)
  const hasReceivedFullState = useRef(false)
  const [customOrder, setCustomOrder] = useState<number[] | null>(null)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [showCheckpointSubmenu, setShowCheckpointSubmenu] = useState(false)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [showShortcutsModal, setShowShortcutsModal] = useState(false)
  const [checkpointNum, setCheckpointNum] = useState<number | null>(null)
  const [keepVisibleNums, setKeepVisibleNums] = useState<Set<number>>(new Set())
  const targetOriginalNumRef = useRef<number | null>(null)
  const pendingReceive = useRef(false)
  const [isAutoDarkEnabled, setIsAutoDarkEnabled] = useState(false)
  const [autoDarkSeconds, setAutoDarkSeconds] = useState(3)
  const [isScreenDark, setIsScreenDark] = useState(false)
  const lastInteractionTime = useRef<number>(Date.now())

  const syncStateRef = useRef({
    currentIndex,
    attemptLaterNums,
    selectedSection,
    bookmarkedNums,
    flaggedNums,
    completedNums,
    customOrder,
    showingAnswer,
    hideCompleted
  })

  useEffect(() => {
    syncStateRef.current = { currentIndex, attemptLaterNums, selectedSection, bookmarkedNums, flaggedNums, completedNums, customOrder, showingAnswer, hideCompleted }
  }, [currentIndex, attemptLaterNums, selectedSection, bookmarkedNums, flaggedNums, completedNums, customOrder, showingAnswer, hideCompleted])

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
            flaggedNums: Array.from(refFlags),
            completedNums: Array.from(syncStateRef.current.completedNums),
            hideCompleted: syncStateRef.current.hideCompleted
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
        if (data.completedNums) setCompletedNums(new Set(data.completedNums))
        if (data.customOrder) setCustomOrder(data.customOrder)
        if (data.hideCompleted !== undefined) setHideCompleted(data.hideCompleted)
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
      if (data.completedNums) setCompletedNums(new Set(data.completedNums))
      if (data.hideCompleted !== undefined) setHideCompleted(data.hideCompleted)
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
          completedNums: Array.from(state.completedNums),
          hideCompleted: state.hideCompleted,
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
        completedNums: Array.from(completedNums),
        hideCompleted,
        senderSocketId: pusherSocketId.current
      },
      socketId: pusherSocketId.current
    }).catch(console.error)
  }, [sourceLinkId, currentIndex, selectedSection, showingAnswer, customOrder, attemptLaterNums, bookmarkedNums, flaggedNums, completedNums])

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
          let comps = new Set<number>()
          if (sid) {
            const nums = await getBookmarkedQuestionNumbers(sid)
            const bmsRaw = nums.filter(n => n > 0 && n < 25000)
            const chkRaw = nums.filter(n => n > 25000 && n < 50000)
            bms = new Set(bmsRaw)
            flags = new Set(nums.filter(n => n < 0 && n > -50000).map(n => Math.abs(n)))
            comps = new Set(nums.filter(n => n >= 50000).map(n => n - 50000))
            if (chkRaw.length > 0) {
              setCheckpointNum(chkRaw[0] - 25000)
            }
            setBookmarkedNums(bms)
            setFlaggedNums(flags)
            setCompletedNums(comps)
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
                if (data.completedNums) setCompletedNums(new Set(data.completedNums))
                if (data.hideCompleted !== undefined) setHideCompleted(data.hideCompleted)
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

  // Auto Dark Mode Logic
  useEffect(() => {
    if (!isAutoDarkEnabled) {
      setIsScreenDark(false);
      return;
    }
    
    const handleInteraction = () => {
      lastInteractionTime.current = Date.now()
      setIsScreenDark(false)
    }

    window.addEventListener('pointermove', handleInteraction)
    window.addEventListener('keydown', handleInteraction)
    window.addEventListener('touchstart', handleInteraction)
    window.addEventListener('click', handleInteraction)

    handleInteraction()

    const interval = setInterval(() => {
      if (Date.now() - lastInteractionTime.current >= autoDarkSeconds * 1000) {
        setIsScreenDark(true)
      }
    }, 500)

    return () => {
      window.removeEventListener('pointermove', handleInteraction)
      window.removeEventListener('keydown', handleInteraction)
      window.removeEventListener('touchstart', handleInteraction)
      window.removeEventListener('click', handleInteraction)
      clearInterval(interval)
    }
  }, [isAutoDarkEnabled, autoDarkSeconds])

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
      const nextIdx = latestIndex < questions.length - 1 ? latestIndex + 1 : 0
      
      if (keepVisibleNums.size > 0) {
        targetOriginalNumRef.current = questions[nextIdx].originalNumber
        setKeepVisibleNums(new Set())
      } else {
        syncStateRef.current.currentIndex = nextIdx
        setCurrentIndex(nextIdx)
      }
      setShowingAnswer(false)
      triggerAnimation()
    }
  }, [questions, qOnlyMode, showingAnswer, keepVisibleNums])

  const handlePrev = useCallback(() => {
    if (questions.length === 0) return
    const latestIndex = syncStateRef.current.currentIndex
    const nextIdx = latestIndex > 0 ? latestIndex - 1 : questions.length - 1
    
    if (keepVisibleNums.size > 0) {
      targetOriginalNumRef.current = questions[nextIdx].originalNumber
      setKeepVisibleNums(new Set())
    } else {
      syncStateRef.current.currentIndex = nextIdx
      setCurrentIndex(nextIdx)
    }
    setShowingAnswer(false)
    triggerAnimation()
  }, [questions, keepVisibleNums])

  const handleCompleteToggle = useCallback(async () => {
    const card = questions[currentIndex]
    if (!sourceLinkId) {
      alert("Cannot complete custom text correctly without saving it properly yet.")
      return
    }
    try {
      const isNowCompleted = await toggleBookmarkState(sourceLinkId, card.originalNumber + 50000, card.prefix, card.q, card.a || '')
      
      setCompletedNums(prev => {
        const next = new Set(prev)
        if (isNowCompleted) next.add(card.originalNumber)
        else next.delete(card.originalNumber)
        return next
      })
      
      if (hideCompleted) {
        setKeepVisibleNums(prev => {
          const next = new Set(prev)
          if (isNowCompleted) next.add(card.originalNumber)
          else next.delete(card.originalNumber)
          return next
        })
      }
    } catch {
      alert('Failed to mark complete. Are you logged in?')
    }
  }, [questions, currentIndex, sourceLinkId, hideCompleted])

  const pressedKeys = useRef<Set<string>>(new Set())

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      pressedKeys.current.add(e.key.toLowerCase())

      if (allQuestions.length === 0) return
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'SELECT') return

      if (e.key === ' ' && pressedKeys.current.has('c')) {
        e.preventDefault()
        handleCompleteToggle()
      } else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      pressedKeys.current.delete(e.key.toLowerCase())
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [handleNext, handlePrev, handleCompleteToggle, allQuestions.length])

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
    } else if (selectedSection === 'CompletedQuestions') {
      if (completedNums.size === 0 && !bookmarksOnly) {
        setSelectedSection('All');
        return;
      }
      filtered = filtered.filter(q => completedNums.has(q.originalNumber));
    } else {
      if (selectedSection !== 'All') {
        filtered = filtered.filter(q => q.section === selectedSection);
      }
      filtered = filtered.filter(q => !flaggedNums.has(q.originalNumber));
    }

    if (hideCompleted) {
      filtered = filtered.filter(q => !completedNums.has(q.originalNumber) || keepVisibleNums.has(q.originalNumber));
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
      if (targetOriginalNumRef.current !== null) {
        const idx = filtered.findIndex(q => q.originalNumber === targetOriginalNumRef.current);
        targetOriginalNumRef.current = null;
        if (idx !== -1) return idx;
      }
      return Math.max(0, Math.min(prev, filtered.length - 1));
    });
  }, [selectedSection, attemptLaterNums, flaggedNums, allQuestions, bookmarksOnly, customOrder, completedNums, hideCompleted, keepVisibleNums]);

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
  const isCompleted = completedNums.has(card?.originalNumber)

  return (
    <div className="container">
      {isScreenDark && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'black',
            zIndex: 9999
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsScreenDark(false);
            lastInteractionTime.current = Date.now();
          }}
        />
      )}
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

      {showShortcutsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="panel" style={{ maxWidth: '400px', textAlign: 'center', padding: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>Keyboard Shortcuts</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '1.5rem 0', textAlign: 'left' }}>
              <li style={{ marginBottom: '1rem' }}><kbd>Space</kbd> or <kbd>Enter</kbd> : Next question / Show answer</li>
              <li style={{ marginBottom: '1rem' }}><kbd>←</kbd> : Previous question</li>
              <li style={{ marginBottom: '1rem' }}><kbd>C</kbd> + <kbd>Space</kbd> : Mark as complete</li>
            </ul>
            <button className="btn-primary" onClick={() => setShowShortcutsModal(false)}>Close</button>
          </div>
        </div>
      )}

      <div className="app-header">
        <h1>{bookmarksOnly ? 'Bookmarked Questions' : 'Quiz Session'}</h1>
        <div className="header-actions">
          <Link href={bookmarksOnly ? "/bookmarks" : "/take-quiz"} onClick={handleLinkClick} className="secondary-btn">Back</Link>
          <Link href="/dashboard" onClick={handleLinkClick} className="secondary-btn">Dashboard</Link>
          <button 
            className="secondary-btn" 
            onClick={() => setIsAutoDarkEnabled(prev => !prev)}
            onDoubleClick={() => {
              const val = prompt('Enter auto dark timeout in seconds:', autoDarkSeconds.toString())
              if (val) {
                const parsed = parseInt(val)
                if (!isNaN(parsed) && parsed > 0) {
                  setAutoDarkSeconds(parsed)
                }
              }
            }}
            title="Double click to set timeout"
          >
            🌙 Auto Dark: {isAutoDarkEnabled ? 'ON' : 'OFF'}
          </button>
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
                    if (keepVisibleNums.size > 0) {
                      targetOriginalNumRef.current = questions[val].originalNumber
                      setKeepVisibleNums(new Set())
                    } else {
                      setCurrentIndex(val)
                    }
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
                  setKeepVisibleNums(new Set())
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
                {completedNums.size > 0 && !bookmarksOnly && (
                  <option value="CompletedQuestions">✅ Completed ({completedNums.size})</option>
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
            <button 
              className="secondary-btn" 
              onClick={handleCompleteToggle} 
              title={isCompleted ? "Remove complete status" : "Mark as complete"}
              style={{ color: isCompleted ? '#22c55e' : 'inherit', borderColor: isCompleted ? '#22c55e' : 'inherit' }}
            >
              {isCompleted ? '✅ Completed' : '☑️ Complete'}
            </button>
            <div style={{ position: 'relative' }}>
              <button 
                className="secondary-btn" 
                onClick={() => setShowMoreOptions(!showMoreOptions)} 
                title="More options"
                style={{ minWidth: '40px', padding: '0.4rem 0.6rem' }}
              >
                ⋮
              </button>
              {showMoreOptions && (
                <div className="more-options-dropdown">
                  {!showCheckpointSubmenu ? (
                    <>
                      <button className="secondary-btn" onClick={() => {
                        const currentCard = questions[currentIndex]
                        if (currentCard) {
                          targetOriginalNumRef.current = currentCard.originalNumber
                        }
                        if (!hideCompleted) {
                          if (currentCard && completedNums.has(currentCard.originalNumber)) {
                            setKeepVisibleNums(new Set([currentCard.originalNumber]))
                          }
                        } else {
                          setKeepVisibleNums(new Set())
                        }
                        setHideCompleted(!hideCompleted)
                        setShowMoreOptions(false)
                        setShowingAnswer(false)
                        triggerAnimation()
                      }} title="Toggle hiding completed questions" style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'flex-start' }}>
                        {hideCompleted ? '👁️ Show Completed' : '🙈 Hide Completed'}
                      </button>
                      <button className="secondary-btn" onClick={() => {
                        const currentCard = questions[currentIndex]
                        setShowMoreOptions(false)
                        const shuffled = [...questions]
                        for (let i = shuffled.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                        }
                        const order = shuffled.map(q => q.originalNumber)
                        if (currentCard) {
                          targetOriginalNumRef.current = currentCard.originalNumber
                        }
                        setCustomOrder(order)
                        setQuestions(shuffled)
                        setShowingAnswer(false)
                        triggerAnimation()
                      }} title="Shuffle questions" style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'flex-start' }}>🔀 Shuffle</button>
                      
                      <button className="secondary-btn" onClick={() => {
                        setShowCheckpointSubmenu(true)
                      }} title="Checkpoint options" style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'flex-start' }}>
                        📍 Checkpoint
                      </button>

                      <button className="secondary-btn" onClick={() => {
                        setShowMoreOptions(false)
                        setShowSyncModal(true)
                      }} title="Sync state to other devices" style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'flex-start' }}>
                        🔄 Sync
                      </button>
                      <button className="secondary-btn" onClick={() => {
                        setShowMoreOptions(false)
                        setShowShortcutsModal(true)
                      }} title="View Keyboard Shortcuts" style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'flex-start' }}>
                        ⌨️ Shortcuts
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="secondary-btn" onClick={() => setShowCheckpointSubmenu(false)} style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'flex-start' }}>
                        ⬅️ Back
                      </button>
                      <button className="secondary-btn" onClick={async () => {
                        setShowMoreOptions(false)
                        setShowCheckpointSubmenu(false)
                        if (!sourceLinkId) {
                          alert("Cannot save checkpoint for custom text yet.")
                          return
                        }
                        const currentCard = questions[currentIndex]
                        if (!currentCard) return
                        try {
                          if (checkpointNum) {
                            await toggleBookmarkState(sourceLinkId, 25000 + checkpointNum, "CHK", "", "")
                          }
                          await toggleBookmarkState(sourceLinkId, 25000 + currentCard.originalNumber, currentCard.prefix, currentCard.q, currentCard.a || '')
                          setCheckpointNum(currentCard.originalNumber)
                        } catch {
                          alert('Failed to set checkpoint.')
                        }
                      }} title="Set current question as checkpoint" style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'flex-start' }}>
                        ➕ Add Checkpoint
                      </button>
                      {checkpointNum && (
                        <button className="secondary-btn" onClick={() => {
                          setShowMoreOptions(false)
                          setShowCheckpointSubmenu(false)
                          
                          if (selectedSection !== 'All' || hideCompleted) {
                            targetOriginalNumRef.current = checkpointNum
                            setSelectedSection('All')
                            setHideCompleted(false)
                          } else {
                            const idx = questions.findIndex(q => q.originalNumber === checkpointNum)
                            if (idx !== -1) {
                              setCurrentIndex(idx)
                            } else {
                              alert("Checkpoint not found!")
                            }
                          }
                          setShowingAnswer(false)
                          triggerAnimation()
                        }} title="Go to checkpoint" style={{ whiteSpace: 'nowrap', width: '100%', justifyContent: 'flex-start' }}>
                          🚀 Go To Checkpoint
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {questions.length > 0 ? (
          <div 
            className={`flashcard ${animating ? 'animating' : ''}`} 
            onDoubleClick={handleAttemptLaterToggle}
            style={{ borderColor: completedNums.has(card.originalNumber) ? '#22c55e' : 'var(--card-border)' }}
          >
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
              {completedNums.has(card.originalNumber) && (
                <span style={{ marginLeft: '10px', fontSize: '0.8em', color: '#16a34a', backgroundColor: '#dcfce7', padding: '2px 6px', borderRadius: '4px' }}>
                  ✅ Completed
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
          <button className="btn-nav" onClick={handleNext}>
            {(qOnlyMode || !card?.a || showingAnswer) ? 'Next Question →' : 'Show Answer →'}
          </button>
        </div>
      </div>
    </div>
  )
}
