'use client'

import { useEffect, useRef, useState } from 'react'

type SpeechRecognitionResultLike = {
  isFinal: boolean
  length: number
  [index: number]: { transcript: string }
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: { length: number; [index: number]: SpeechRecognitionResultLike }
}

type SpeechRecognitionErrorEventLike = { error?: string }

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

// Owner-reported, 2026-09-28: dictated text was landing glued directly onto
// the end of whatever Description already held, no separating space —
// "the first word adjacent to the last word." Every part passed in here is
// already individually trimmed before this runs (baseTextRef.current at
// assignment, each committed/interim transcript at capture), so a plain
// `.filter(Boolean).join(' ')` should already separate them — but that
// relies on every future caller keeping its own part pre-trimmed, which is
// exactly the kind of implicit contract that's easy to violate without
// noticing. Trimming again here, right at the join, makes a leading or
// trailing space on any one part harmless instead of load-bearing, and is
// the one change that directly guarantees what was reported: never zero
// spaces between two non-empty parts, and never a stray double space either.
function joinParts(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(' ')
}

// How long a pause has to last, total, before dictation actually turns off
// — see armSilenceTimer's own comment below for why this is a real JS
// timer layered on top of (not a replacement for) the browser's own much
// shorter internal pause timeout.
const SILENCE_TIMEOUT_MS = 4000

// A recoverable error (currently just 'no-speech') is deliberately a no-op
// here — the onend that follows it is what actually decides to
// restart-or-finish, so there's exactly one place making that call rather
// than two paths that could disagree.
function isRecoverableError(errorCode: string | undefined): boolean {
  return errorCode === 'no-speech'
}

export function useSpeechDictation(value: string, setValue: (value: string) => void) {
  const valueRef = useRef(value)
  const setValueRef = useRef(setValue)
  const recognitionCtorRef = useRef<SpeechRecognitionConstructor | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const baseTextRef = useRef('')
  // committedTextRef (2026-09-28, replaces the old per-index
  // Map<number,string> — see mergeFinal below) is the single running
  // "everything finalized so far this session" string. finalizedIndexesRef
  // just remembers which result indices have already been folded in, so a
  // later event re-reporting the same already-final index (the browser is
  // allowed to keep echoing old entries in event.results) is a no-op
  // instead of being merged again.
  const committedTextRef = useRef('')
  const finalizedIndexesRef = useRef(new Set<number>())
  // Tracks whatever interim (not-yet-final) text was on screen as of the
  // last onresult event. 2026-10-28 (first real-device iOS test,
  // owner-reported): this used to be folded into committedTextRef only on
  // a browser-imposed restart (handleEnd's "still dictating" branch), never
  // on a genuine finish (manual stop, or the 4-second silence timer) — so
  // stopping right after speaking, before iOS had finalized that last
  // phrase on its own, silently discarded it instead of keeping it. Now
  // folded in on every path that ends a session, not just a restart.
  const lastInterimTextRef = useRef('')
  const sessionRef = useRef(0)
  // silenceTimerRef (2026-09-28, revised same day — see armSilenceTimer's
  // own comment below) drives the actual 4-second decision directly via a
  // real JS timer, rather than comparing elapsed time at whatever moment
  // the browser's own onend happens to fire.
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [supported, setSupported] = useState(false)
  const [dictating, setDictating] = useState(false)

  useEffect(() => {
    valueRef.current = value
    setValueRef.current = setValue
  }, [value, setValue])

  // mergeFinal folds a newly-finalized transcript into committedTextRef.
  // Owner-reported, 2026-09-28: dictated text was coming out as a
  // "staircase" — each new bit of speech re-appending everything already
  // said, e.g. "Hello" -> "Hello Hello world" -> "Hello Hello world Hello
  // world today". The previous version (per-index Map, blind join)
  // assumed every browser reports each result index as its own
  // self-contained incremental phrase; some report each new final result
  // as the *whole growing transcript so far*, which the blind join then
  // appends on top of everything already committed instead of replacing
  // it. Checking for overlap first, in both directions, makes this safe
  // regardless of which convention the browser actually uses, without
  // needing to know which one it is:
  //   - nothing committed yet -> just take it
  //   - the new transcript already starts with everything committed ->
  //     it's the cumulative case; replace, don't append
  //   - what's committed already starts with the new transcript -> the
  //     browser re-sent an old, shorter final; already accounted for,
  //     drop it
  //   - neither contains the other -> genuinely new incremental content;
  //     append it
  function mergeFinal(transcript: string): void {
    const t = transcript.trim()
    if (!t) return
    const committed = committedTextRef.current
    const tLower = t.toLowerCase()
    const committedLower = committed.toLowerCase()
    if (!committed) {
      committedTextRef.current = t
    } else if (tLower.startsWith(committedLower)) {
      committedTextRef.current = t
    } else if (committedLower.startsWith(tLower)) {
      // already fully accounted for — nothing new to add
    } else {
      committedTextRef.current = joinParts(committed, t)
    }
  }

  function renderTranscript(currentInterimText: string): void {
    lastInterimTextRef.current = currentInterimText
    setValueRef.current(joinParts(baseTextRef.current, committedTextRef.current, currentInterimText))
  }

  // foldInterim covers every path that ends a session outright (manual
  // stop, the 4-second silence timer, a non-recoverable onerror, or a
  // final onend with nothing left to restart into) — see
  // lastInterimTextRef's own comment above for why this folding has to
  // happen here now, not only on a mid-session restart.
  function finishSession(foldInterim: boolean): void {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (foldInterim && lastInterimTextRef.current) {
      mergeFinal(lastInterimTextRef.current)
      lastInterimTextRef.current = ''
    }
    renderTranscript('')
    setDictating(false)
  }

  // armSilenceTimer re-arms the real 4-second stop timer — called from
  // onresult on every burst of speech (interim or final) and once when
  // dictation first starts. Its own firing is the ONLY thing that sets
  // sessionRef.current = 0 while still dictating (besides an explicit user
  // stop or a fatal error) — everything else (a short browser-imposed
  // onend) just restarts.
  //
  // Owner-reported, 2026-09-28: a brief hesitation (his own estimate,
  // "only a 1 second hesitation") was turning dictation off entirely.
  // Confirmed he likes the auto-turn-off itself, just wanted more grace
  // before it fires — landed on 4 seconds (SILENCE_TIMEOUT_MS above). The
  // Web Speech API gives no standard, cross-browser way to configure the
  // browser's own internal pause threshold directly — it's the
  // browser/OS's own speech endpointer, outside this codebase's control
  // even with `continuous = true` set. What IS controllable is how this
  // hook reacts to that short browser-imposed cutoff: restart listening
  // every time, and let this independent timer be the only thing that
  // decides when to actually stop.
  function armSilenceTimer(): void {
    if (silenceTimerRef.current !== null) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null
      sessionRef.current = 0
      const recognition = recognitionRef.current
      if (!recognition) {
        finishSession(true)
        return
      }
      try {
        recognition.stop()
      } catch {
        finishSession(true)
      }
    }, SILENCE_TIMEOUT_MS)
  }

  // createRecognition builds a fresh SpeechRecognition instance with its
  // handlers attached, rather than this hook keeping one single instance
  // for its whole lifetime and calling start()/stop() on it repeatedly.
  //
  // iOS-observed, 2026-10-28 (first real-device iOS test, owner-reported):
  // after one full dictate-and-stop cycle, later attempts would show the
  // mic turn red (listening) but never deliver any onresult events at
  // all — no error, just silently stuck. Reusing one long-lived
  // SpeechRecognition object across many start()/stop() cycles is a
  // documented source of exactly this kind of degraded, no-results
  // behavior in WebKit's implementation. A brand-new instance — built the
  // same way here for a user-initiated start and for every browser-forced
  // short-pause restart — is the standard mitigation, and costs nothing
  // on browsers where reuse was never a problem.
  function createRecognition(): SpeechRecognitionLike | null {
    const Recognition = recognitionCtorRef.current
    if (!Recognition) return null

    const recognition = new Recognition()
    // continuous keeps listening across pauses instead of stopping after
    // one phrase; interimResults is what makes words appear live as
    // they're recognized, before the phrase finalizes. Both required for
    // streaming.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      if (sessionRef.current === 0) return

      // Any onresult event means the recognizer is actively hearing
      // something — re-arms the real 4-second stop timer.
      armSilenceTimer()

      // Scanned from 0, not event.resultIndex — a final result can in
      // principle be reported again in a later event (see mergeFinal's
      // own comment); finalizedIndexesRef is what actually prevents
      // re-merging it, not the scan's own starting point.
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal && !finalizedIndexesRef.current.has(index)) {
          finalizedIndexesRef.current.add(index)
          mergeFinal(result[0]?.transcript ?? '')
        }
      }

      // Interim text is rebuilt from this event's full results snapshot
      // every time — nothing interim is ever written to a ref/state, so a
      // segment that just finalized has no leftover tail on this or any
      // later render. Scanning the whole array (not just from
      // resultIndex) is what keeps words streaming live: every onresult
      // event re-derives whatever is still in progress right now, however
      // many results are pending.
      const currentInterim: string[] = []
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (!result.isFinal) {
          currentInterim.push((result[0]?.transcript ?? '').trim())
        }
      }
      renderTranscript(joinParts(...currentInterim))
    }

    recognition.onerror = (event) => {
      if (sessionRef.current !== 0 && isRecoverableError(event?.error)) return
      // A real error ('not-allowed', 'audio-capture', etc.) — zero
      // sessionRef before finishing, same signal a manual stop already
      // sets, so the onend that follows this (browsers fire both) sees
      // sessionRef.current === 0 and finishes cleanly too instead of
      // trying to restart a recognizer that just failed for a reason a
      // restart can't fix.
      sessionRef.current = 0
      finishSession(true)
    }

    // sessionRef.current === 0 only when a manual stop zeroed it first, a
    // non-recoverable onerror doing the same, or the silence timer above
    // firing — that's the one case this actually finishes outright. Any
    // other time onend fires, it's just the browser ending the underlying
    // session on its own short internal timeout; restart unconditionally
    // (on a fresh instance — see createRecognition's own comment) and let
    // the independent timer be the only thing that decides when enough
    // real silence has actually passed.
    recognition.onend = () => {
      if (sessionRef.current === 0) {
        finishSession(true)
        return
      }
      // Fold in whatever was still interim (never finalized) at the exact
      // moment the browser cut the session off — otherwise the next
      // session's own first render would silently overwrite it, since
      // renderTranscript always replaces the whole value from scratch.
      if (lastInterimTextRef.current) {
        mergeFinal(lastInterimTextRef.current)
        lastInterimTextRef.current = ''
      }
      // A restarted recognition instance numbers its own results from 0
      // again — finalizedIndexesRef has to reset with it, or the new
      // session's own index 0/1/2… reads as "already merged" and its real
      // speech is silently dropped. committedTextRef (the actual
      // accumulated text) is untouched — only the per-session index
      // bookkeeping resets.
      finalizedIndexesRef.current.clear()

      const next = createRecognition()
      if (!next) {
        finishSession(true)
        return
      }
      recognitionRef.current = next
      try {
        next.start()
      } catch {
        finishSession(true)
      }
    }

    return recognition
  }

  useEffect(() => {
    const Recognition = getSpeechRecognition()
    if (!Recognition) return
    recognitionCtorRef.current = Recognition
    queueMicrotask(() => setSupported(true))

    return () => {
      sessionRef.current = 0
      if (silenceTimerRef.current !== null) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
  }, [])

  function toggle(): void {
    if (dictating) {
      sessionRef.current = 0
      if (silenceTimerRef.current !== null) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      // Deliberately doesn't flip `dictating` or render here — stop()'s
      // own onend (above) is the single place that both folds in any
      // still-interim text and flips the UI off, so a manual stop and a
      // natural silence-timeout finish the exact same way.
      const recognition = recognitionRef.current
      if (!recognition) {
        finishSession(true)
        return
      }
      try {
        recognition.stop()
      } catch {
        finishSession(true)
      }
      return
    }

    // iOS-observed, 2026-10-28, first real-device iOS test: a start()
    // called shortly after a previous session's own teardown can throw
    // synchronously (the mic icon never turns red at all) — iOS's speech
    // engine can briefly report itself still busy right after the last
    // session ended. One short, silent retry clears most of these without
    // the user needing to notice or tap again.
    function attemptStart(isRetry: boolean): void {
      baseTextRef.current = valueRef.current.trim()
      committedTextRef.current = ''
      finalizedIndexesRef.current.clear()
      lastInterimTextRef.current = ''
      sessionRef.current += 1

      const recognition = createRecognition()
      if (!recognition) {
        sessionRef.current = 0
        return
      }
      recognitionRef.current = recognition

      try {
        recognition.start()
        setDictating(true)
        // Starts the real 4-second countdown immediately — otherwise a
        // dictation session opened and then never spoken into at all
        // would sit listening forever instead of timing out like every
        // other silence does.
        armSilenceTimer()
      } catch {
        sessionRef.current = 0
        setDictating(false)
        if (!isRetry) {
          setTimeout(() => attemptStart(true), 300)
        }
      }
    }

    attemptStart(false)
  }

  return { supported, dictating, toggle }
}
