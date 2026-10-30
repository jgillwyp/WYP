'use client'

import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'

import NativeAudioSession from './nativeAudioSession'
import NativeSpeech from './nativeSpeech'

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

function isIOSNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

// NativeSpeechRecognitionAdapter (2026-10-31) — see nativeSpeech.ts's own
// header comment for why this exists (on-device SFSpeechRecognizer in
// place of the browser's own throttled Web Speech API). Implements the
// exact same SpeechRecognitionLike shape createRecognition() already
// builds against, so every other line in this file — mergeFinal,
// armSilenceTimer, finishSession, dictationNote, toggle() — works
// completely unmodified regardless of which engine is actually running
// underneath; only getRecognitionConstructor() (below) and this class
// know the difference exists.
//
// pushResult reconstructs a results array that grows the same way the
// real Web Speech API's own event.results does — a still-interim entry
// at the highest index gets replaced in place by the next update; once
// it finalizes, the next update opens a new index — because the native
// plugin only ever reports one transcript+isFinal pair at a time
// (NativeSpeechPlugin.swift's own notifyListeners("result", ...)), not a
// growing array of its own. Without this reconstruction,
// finalizedIndexesRef's existing "don't re-merge an already-finalized
// index" logic would treat every finalized phrase as index 0 and
// silently drop every one after the first.
class NativeSpeechRecognitionAdapter implements SpeechRecognitionLike {
  continuous = true
  interimResults = true
  lang = 'en-US'
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null
  onend: (() => void) | null = null

  private resultBuffer: Array<{ isFinal: boolean; transcript: string }> = []
  private listenersAttached = false

  // A brand new adapter instance is only ever constructed for a
  // genuinely new toggle()-initiated session (createRecognition, below)
  // — never for a same-instance mid-session restart, which calls start()
  // again on this SAME object instead. That makes the constructor the
  // one safe place to clear out whatever the *previous* session's own
  // adapter instance left attached: doing this inside the 'end'/'error'
  // handlers themselves would also strip this instance's own
  // just-(re)used listeners during a same-instance restart, since that
  // path calls start() -> attachListeners() (a no-op, already attached)
  // on the very instance whose 'end' just fired — removing them there
  // would leave the restarted session's own results with nothing to
  // report through. A stray already-finished-session event between here
  // and whatever the user does next is otherwise harmless either way —
  // onresult already early-returns once sessionRef is zeroed.
  constructor() {
    void NativeSpeech.removeAllListeners()
  }

  start(): void {
    this.resultBuffer = []
    this.attachListeners()
    NativeSpeech.start().catch(() => {
      this.onerror?.({ error: 'aborted' })
    })
  }

  stop(): void {
    NativeSpeech.stop().catch(() => {
      // Nothing more to do — a failed stop() call has no "end" coming
      // either, so there's no further cleanup this adapter can trigger
      // on its own; the caller's own stopWatchdogRef (useSpeechDictation
      // itself) is what forces the session to finish regardless.
    })
  }

  private attachListeners(): void {
    if (this.listenersAttached) return
    this.listenersAttached = true

    void NativeSpeech.addListener('result', ({ transcript, isFinal }) => {
      this.pushResult(transcript, isFinal)
    })
    void NativeSpeech.addListener('error', ({ code }) => {
      this.onerror?.({ error: code })
    })
    void NativeSpeech.addListener('end', () => {
      this.onend?.()
    })
  }

  private pushResult(transcript: string, isFinal: boolean): void {
    const lastIndex = this.resultBuffer.length - 1
    if (lastIndex >= 0 && !this.resultBuffer[lastIndex].isFinal) {
      this.resultBuffer[lastIndex] = { transcript, isFinal }
    } else {
      this.resultBuffer.push({ transcript, isFinal })
    }

    const results: SpeechRecognitionEventLike['results'] = { length: this.resultBuffer.length }
    this.resultBuffer.forEach((entry, index) => {
      results[index] = { isFinal: entry.isFinal, length: 1, 0: { transcript: entry.transcript } }
    })

    this.onresult?.({ resultIndex: this.resultBuffer.length - 1, results })
  }
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (isIOSNative()) return NativeSpeechRecognitionAdapter
  return getSpeechRecognition()
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
  // dictatingRef mirrors the `dictating` state into a ref so
  // armStopWatchdog (below) can check it from inside a setTimeout callback
  // without closing over a stale value of the state itself.
  const dictatingRef = useRef(false)
  // stopWatchdogRef (2026-10-30) — this app runs inside Capacitor's
  // WKWebView, not full mobile Safari; WKWebView's own Web Speech support
  // is newer and less mature, and a documented WebKit quirk is that
  // recognition.stop() can silently fail to fire onend at all in some
  // versions. Without this, that failure mode would leave the mic
  // permanently "red"/dictating with no way out short of leaving the
  // field — a plausible explanation for voice dictation reading as
  // "inconsistent" specifically in this native-app context. Armed right
  // after a deliberate stop() call succeeds; cancelled the moment onend
  // actually arrives (finishSession, below) and fires on its own, forcing
  // the session to finish, only if onend never shows up within 1.5s.
  const stopWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // captureFailedTimerRef (2026-10-30) — auto-clears captureFailed (below)
  // a few seconds after it's set, so the hint doesn't linger indefinitely
  // if the person doesn't immediately try again.
  const captureFailedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [supported, setSupported] = useState(false)
  const [dictating, setDictating] = useState(false)
  // captureFailed (2026-10-30) — owner-reported and confirmed over several
  // live tests: the very first dictation attempt after a fresh app launch
  // reliably works, but every attempt for a while after that aborts with
  // zero speech ever recognized, then on its own — no restart, no code
  // change — starts working again after a few minutes. That shape matches
  // Apple's own documented behavior for the Speech framework (a
  // recognition request can briefly fail outright while the on-device
  // service is temporarily unavailable, e.g. after recent heavy use —
  // see https://developer.apple.com/library/archive/qa/qa1951/_index.html
  // and multiple developer forum reports of the same "fails fast, then
  // recovers after a wait" pattern), not a bug in this app's own code or
  // in WebKit's Web Speech API shim — nothing here can make Apple's own
  // service respond faster. What this flag buys instead is turning a
  // silent, confusing "nothing happened" into an explained one: true
  // whenever a session ends having captured no text at all (whether that's
  // this exact failure or simply genuine silence the whole time — telling
  // those apart isn't possible from the browser's own generic error codes,
  // and the hint is harmless either way).
  const [captureFailed, setCaptureFailed] = useState(false)
  // awaitingFirstResult (2026-10-30, owner-reported) — true from the
  // moment a session actually starts until the first onresult event of
  // that session arrives, however long that takes. Apple's own speech
  // service can have a real delay (or, per captureFailed's own comment
  // above, simply be unavailable for a while) before the first word ever
  // shows up — during that gap the only visible sign anything is
  // happening was the mic icon turning red, which read as an "awkward"
  // silence. dictationNote (below) surfaces this as a plain status line
  // instead of leaving the person guessing.
  const [awaitingFirstResult, setAwaitingFirstResult] = useState(false)

  // dictationNote is the one thing every call site actually renders —
  // centralizing the wording here (rather than duplicating the strings
  // across all 11 mic-button call sites) means a future wording change
  // only has to happen once. The two states are mutually exclusive in
  // time: "capturing" only while a session is genuinely still running
  // and hasn't produced anything yet; "didn't catch" only once a session
  // has already ended with nothing to show.
  const dictationNote: string | null = dictating && awaitingFirstResult
    ? 'Your dictation is being captured, and will be displayed momentarily.'
    : captureFailed
      ? 'Didn’t catch that — try again in a moment.'
      : null

  function clearCaptureFailed(): void {
    if (captureFailedTimerRef.current !== null) {
      clearTimeout(captureFailedTimerRef.current)
      captureFailedTimerRef.current = null
    }
    setCaptureFailed(false)
  }

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
    const wasDictating = dictatingRef.current
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (stopWatchdogRef.current !== null) {
      clearTimeout(stopWatchdogRef.current)
      stopWatchdogRef.current = null
    }
    if (foldInterim && lastInterimTextRef.current) {
      mergeFinal(lastInterimTextRef.current)
      lastInterimTextRef.current = ''
    }
    renderTranscript('')
    dictatingRef.current = false
    setDictating(false)
    // See captureFailed's own comment above — only flagged when a session
    // genuinely ran (wasDictating) and came back with literally nothing,
    // never for a stray stop() with no session active to begin with.
    if (wasDictating && !committedTextRef.current) {
      setCaptureFailed(true)
      if (captureFailedTimerRef.current !== null) clearTimeout(captureFailedTimerRef.current)
      captureFailedTimerRef.current = setTimeout(() => {
        captureFailedTimerRef.current = null
        setCaptureFailed(false)
      }, 5000)
    }
  }

  // armStopWatchdog — see stopWatchdogRef's own comment above. Called only
  // right after a deliberate stop() call returns without throwing; a
  // normal onend finishes the session (via finishSession, which cancels
  // this) well before the 1.5s window, so this only ever actually fires
  // in the stuck case it exists for.
  function armStopWatchdog(): void {
    if (stopWatchdogRef.current !== null) clearTimeout(stopWatchdogRef.current)
    stopWatchdogRef.current = setTimeout(() => {
      stopWatchdogRef.current = null
      if (dictatingRef.current) {
        console.warn('[voice-dictation] stop() watchdog fired — onend never arrived, forcing finish')
        finishSession(true)
      }
    }, 1500)
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
        armStopWatchdog()
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
  // behavior in WebKit's implementation.
  //
  // Only called from a toggle()-initiated start (attemptStart below), not
  // from the much more frequent browser-forced short-pause restart inside
  // onend — an earlier version of this fix also rebuilt the instance on
  // every one of those (roughly once a second while actively talking),
  // which owner-testing showed made things worse: every attempt after the
  // first turned red for only a couple seconds and captured nothing,
  // consistent with iOS's own audio engine not getting enough real
  // teardown time between that many rapid rebuilds. A fresh instance only
  // where the original stuck-after-one-cycle symptom was actually
  // observed — at the start of a new session — avoids both problems.
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
      // something — re-arms the real 4-second stop timer, and clears the
      // "being captured" status note (dictationNote above) now that
      // there's real streamed text to look at instead.
      armSilenceTimer()
      setAwaitingFirstResult(false)

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
    // session on its own short internal timeout (typically every second
    // or so while actively talking); restart unconditionally and let the
    // independent timer be the only thing that decides when enough real
    // silence has actually passed.
    //
    // 2026-10-28, same-day correction: an earlier version of this restart
    // path built a brand-new recognizer instance here too, same as a
    // genuinely new toggle()-initiated session — reasoned, at the time, as
    // a mitigation for a stuck-after-one-cycle WebKit quirk (see
    // createRecognition's own comment). Owner-reported this made things
    // worse, not better: every attempt after the first now turned red for
    // only a couple seconds regardless of actual speech length and
    // captured nothing. Recreating the whole native audio pipeline on
    // every one-second restart, rather than only when the user explicitly
    // starts a new session, is the more likely explanation — iOS's own
    // audio engine needs real teardown time that a restart this frequent
    // doesn't give it. Reverted to reusing this same instance for a
    // same-session restart; a fresh instance is still built for every
    // toggle()-initiated start (attemptStart below), which is the much
    // rarer case the original mitigation was actually aimed at.
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
      try {
        recognition.start()
      } catch {
        finishSession(true)
      }
    }

    return recognition
  }

  useEffect(() => {
    const Recognition = getRecognitionConstructor()
    if (!Recognition) return
    recognitionCtorRef.current = Recognition
    queueMicrotask(() => setSupported(true))

    return () => {
      sessionRef.current = 0
      if (silenceTimerRef.current !== null) {
        clearTimeout(silenceTimerRef.current)
        silenceTimerRef.current = null
      }
      if (stopWatchdogRef.current !== null) {
        clearTimeout(stopWatchdogRef.current)
        stopWatchdogRef.current = null
      }
      if (captureFailedTimerRef.current !== null) {
        clearTimeout(captureFailedTimerRef.current)
        captureFailedTimerRef.current = null
      }
      recognitionRef.current?.stop()
      recognitionRef.current = null
    }
  }, [])

  function toggle(): void {
    // Owner-reported, 2026-10-30: tapping the mic button often scrolled
    // the screen up to show the on-screen keyboard. The mic button never
    // takes focus itself on iOS (a plain tap on a button doesn't move
    // focus there), so whatever text field was focused beforehand — most
    // often the very Description/Dialog textarea the mic sits inside the
    // corner of — stayed focused and kept the keyboard open underneath,
    // with the browser then scrolling that still-focused field into view
    // as dictated text streamed in and grew it. Blurring here, before
    // anything else, closes the keyboard the moment dictation is toggled
    // either way, regardless of which field happened to be focused.
    if (typeof document !== 'undefined') {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
    }

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
        armStopWatchdog()
      } catch {
        finishSession(true)
      }
      return
    }

    clearCaptureFailed()

    // iOS-observed, 2026-10-28, first real-device iOS test: a start()
    // called shortly after a previous session's own teardown can throw
    // synchronously (the mic icon never turns red at all) — iOS's speech
    // engine can briefly report itself still busy right after the last
    // session ended. One short, silent retry clears most of these without
    // the user needing to notice or tap again.
    let isRetry = false

    function beginRecognition(): void {
      const recognition = createRecognition()
      if (!recognition) {
        sessionRef.current = 0
        return
      }
      recognitionRef.current = recognition

      try {
        recognition.start()
        dictatingRef.current = true
        setDictating(true)
        setAwaitingFirstResult(true)
        // Starts the real 4-second countdown immediately — otherwise a
        // dictation session opened and then never spoken into at all
        // would sit listening forever instead of timing out like every
        // other silence does.
        armSilenceTimer()
      } catch {
        sessionRef.current = 0
        dictatingRef.current = false
        setDictating(false)
        if (!isRetry) {
          isRetry = true
          setTimeout(() => attemptStart(), 300)
        }
      }
    }

    function attemptStart(): void {
      baseTextRef.current = valueRef.current.trim()
      committedTextRef.current = ''
      finalizedIndexesRef.current.clear()
      lastInterimTextRef.current = ''
      sessionRef.current += 1

      // iOS-observed, 2026-10-30 — see nativeAudioSession.ts's own header
      // comment for the full reasoning: re-assert the native audio session
      // right before every single start(), not just once at app launch.
      // Best-effort — dictation still attempts to start even if this
      // rejects (e.g. on Android or in a plain browser, where this plugin
      // was never registered at all).
      if (isIOSNative()) {
        NativeAudioSession.ensureActive()
          .catch(() => {})
          .finally(() => beginRecognition())
        return
      }

      beginRecognition()
    }

    attemptStart()
  }

  return { supported, dictating, toggle, dictationNote }
}
