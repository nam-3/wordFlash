/* ============================================================
   flashcard.js — TTS engine + FlashcardTest controller
   ============================================================ */

/* ============================================================
   TTS — Web Speech API wrapper
   ============================================================ */
class TTS {
  constructor() {
    this.synth   = window.speechSynthesis || null;
    this.voices  = [];
    this.rate    = 1.0;
    this.enabled = true;

    if (this.synth) {
      this._loadVoices();
      // Chrome loads voices asynchronously
      this.synth.addEventListener('voiceschanged', () => this._loadVoices());
    }
  }

  _loadVoices() {
    this.voices = this.synth ? this.synth.getVoices() : [];
  }

  /** Find best matching voice for a language tag (e.g. 'en-US') */
  _getVoice(lang) {
    if (!this.voices.length) this._loadVoices();
    // Exact match first, then prefix match
    return (
      this.voices.find(v => v.lang === lang) ||
      this.voices.find(v => v.lang.startsWith(lang.split('-')[0])) ||
      null
    );
  }

  /** Speak text in given language.
   *  onStart / onEnd are optional callbacks. */
  speak(text, lang, onStart, onEnd) {
    if (!this.synth || !this.enabled || !text) return;

    // Cancel any ongoing speech
    this.synth.cancel();

    const utt   = new SpeechSynthesisUtterance(text);
    utt.lang    = lang;
    utt.rate    = this.rate;
    const voice = this._getVoice(lang);
    if (voice) utt.voice = voice;

    if (onStart) utt.addEventListener('start', onStart);
    if (onEnd)   utt.addEventListener('end',   onEnd);

    // Workaround for Chrome bug: voices may not be ready immediately
    setTimeout(() => this.synth.speak(utt), 50);
  }

  cancel()             { if (this.synth) this.synth.cancel(); }
  setRate(r)           { this.rate    = r; }
  setEnabled(enabled)  { this.enabled = enabled; if (!enabled) this.cancel(); }
}


/* ============================================================
   FlashcardTest — manages one complete test session
   ============================================================ */
class FlashcardTest {
  /**
   * @param {Object[]} words    - Array of word objects
   * @param {string}   mode     - 'english' | 'chinese'
   * @param {Object}   settings - { ttsEnabled, ttsRate, cardCount, customCount }
   * @param {Object}   callbacks- { onComplete(wrongNotes) }
   */
  constructor(words, mode, settings, callbacks) {
    this.words     = words;
    this.mode      = mode;
    this.settings  = settings;
    this.callbacks = callbacks;

    this.queue              = [];
    this.currentIndex       = 0;
    this.wrongNotes         = [];
    this.isFlipped          = false;
    this.currentNoteAdded   = false;

    // TTS
    this.tts = new TTS();
    this.tts.setEnabled(settings.ttsEnabled);
    this.tts.setRate(settings.ttsRate);

    // Abort controller for event listeners (clean removal on destroy)
    this._ac = new AbortController();
    const sig = { signal: this._ac.signal };

    // Cache DOM refs
    this.cardInner          = document.getElementById('card-inner');
    this.cardWord           = document.getElementById('card-word');
    this.cardLangBadge      = document.getElementById('card-lang-badge');
    this.answerData         = document.getElementById('answer-data');
    this.userAnswerDisplay  = document.getElementById('user-answer-display');
    this.answerInput        = document.getElementById('answer-input');
    this.answerInputArea    = document.getElementById('answer-input-area');
    this.actionArea         = document.getElementById('action-area');
    this.btnCheck           = document.getElementById('btn-check');
    this.btnNext            = document.getElementById('btn-next');
    this.btnWrongNote       = document.getElementById('btn-wrong-note');
    this.ttsReplayBtn       = document.getElementById('tts-replay-btn');
    this.pinyinHint         = document.getElementById('pinyin-hint');
    this.pinyinPeekBtn      = document.getElementById('pinyin-peek-btn');
    this.testCounter        = document.getElementById('test-counter');
    this.wrongCount         = document.getElementById('wrong-count');
    this.progressBar        = document.getElementById('progress-bar');

    // Bind events with AbortSignal so they're removed on destroy()
    this.btnCheck.addEventListener('click',   () => this._flip(),            sig);
    this.btnNext.addEventListener('click',    () => this._next(),            sig);
    this.btnWrongNote.addEventListener('click', () => this._addToNotes(),   sig);
    this.ttsReplayBtn.addEventListener('click', () => this._speakCurrent(), sig);
    this.answerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._flip();
    }, sig);

    // Pinyin peek: show while held (mouse + touch)
    const showPinyin = () => {
      this.pinyinHint.classList.add('visible');
      this.pinyinPeekBtn.classList.add('peeking');
    };
    const hidePinyin = () => {
      this.pinyinHint.classList.remove('visible');
      this.pinyinPeekBtn.classList.remove('peeking');
    };
    this.pinyinPeekBtn.addEventListener('mousedown',   showPinyin, sig);
    this.pinyinPeekBtn.addEventListener('touchstart',  showPinyin, { ...sig, passive: true });
    this.pinyinPeekBtn.addEventListener('mouseup',     hidePinyin, sig);
    this.pinyinPeekBtn.addEventListener('mouseleave',  hidePinyin, sig);
    this.pinyinPeekBtn.addEventListener('touchend',    hidePinyin, sig);
    this.pinyinPeekBtn.addEventListener('touchcancel', hidePinyin, sig);
    // Prevent context-menu on long-press mobile
    this.pinyinPeekBtn.addEventListener('contextmenu', (e) => e.preventDefault(), sig);

    // Build queue and start
    this._buildQueue();
    this._showCard();
  }

  /* ── Shuffle and limit the word queue ── */
  _buildQueue() {
    let pool = [...this.words];
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (this.settings.cardCount === 'custom') {
      pool = pool.slice(0, Math.min(this.settings.customCount, pool.length));
    }
    this.queue = pool;
  }

  /* ── Show current card (or end test if done) ── */
  _showCard() {
    if (this.currentIndex >= this.queue.length) {
      // Update progress to 100% before completing
      this.progressBar.style.width = '100%';
      setTimeout(() => this.callbacks.onComplete(this.wrongNotes), 400);
      return;
    }

    const word = this.queue[this.currentIndex];
    this.isFlipped        = false;
    this.currentNoteAdded = false;

    // Reset UI state
    this.cardInner.classList.remove('flipped');
    this.answerInput.value = '';
    this.answerInputArea.style.display = 'flex';
    this.actionArea.style.display      = 'none';
    this.btnWrongNote.classList.remove('added');
    this.btnWrongNote.textContent = '📝 오답노트 추가';
    this.btnWrongNote.disabled    = false;

    // Progress
    const total   = this.queue.length;
    const current = this.currentIndex + 1;
    this.testCounter.textContent   = `${current} / ${total}`;
    this.progressBar.style.width   = `${(this.currentIndex / total) * 100}%`;
    this.wrongCount.textContent    = this.wrongNotes.length;

    // Card front content
    if (this.mode === 'english') {
      this.cardLangBadge.textContent    = '🇺🇸 영어';
      this.cardWord.textContent         = word.word;
      // Hide pinyin elements in English mode
      this.pinyinHint.textContent       = '';
      this.pinyinHint.classList.remove('visible');
      this.pinyinPeekBtn.style.display  = 'none';
    } else if (this.mode === 'chinese') {
      this.cardLangBadge.textContent    = '🇨🇳 중국어';
      this.cardWord.textContent         = word.hanzi;
      // Store pinyin for peek; always start hidden
      this.pinyinHint.textContent       = word.pinyin || '';
      this.pinyinHint.classList.remove('visible');
      this.pinyinPeekBtn.style.display  = 'flex';
      this.pinyinPeekBtn.textContent    = '👁 병음 보기';
      this.pinyinPeekBtn.classList.remove('peeking');
    } else { // japanese
      this.cardLangBadge.textContent    = '🇯🇵 일본어';
      this.cardWord.textContent         = word.kanji;
      // Show hiragana / katakana on peek
      const readings = [word.hiragana, word.katakana]
        .filter(Boolean).join('  ／  ');
      this.pinyinHint.textContent       = readings;
      this.pinyinHint.classList.remove('visible');
      this.pinyinPeekBtn.style.display  = 'flex';
      this.pinyinPeekBtn.textContent    = '👁 읽기 보기';
      this.pinyinPeekBtn.classList.remove('peeking');
    }

    // Auto-focus input
    setTimeout(() => this.answerInput.focus(), 100);

    // TTS auto-play
    if (this.settings.ttsEnabled) {
      setTimeout(() => this._speakCurrent(), 350);
    }
  }

  /* ── Speak the current card’s front word ── */
  _speakCurrent() {
    if (this.currentIndex >= this.queue.length) return;
    const word = this.queue[this.currentIndex];

    let lang, text;
    if (this.mode === 'english') {
      lang = 'en-US'; text = word.word;
    } else if (this.mode === 'chinese') {
      lang = 'zh-CN'; text = word.hanzi;
    } else { // japanese
      lang = 'ja-JP'; text = word.kanji;
    }

    this.ttsReplayBtn.classList.add('playing');
    this.tts.speak(
      text, lang,
      () => this.ttsReplayBtn.classList.add('playing'),
      () => this.ttsReplayBtn.classList.remove('playing')
    );
  }

  /* ── Flip card to show answer ── */
  _flip() {
    if (this.isFlipped) return;
    this.isFlipped = true;

    const word       = this.queue[this.currentIndex];
    const userAnswer = this.answerInput.value.trim();

    // Build answer display
    this.answerData.innerHTML = '';
    if (this.mode === 'english') {
      this.answerData.innerHTML = `
        <div class="ans-word">${this._esc(word.word)}</div>
        <div class="ans-meaning">${this._esc(word.meaning)}</div>
      `;
    } else if (this.mode === 'chinese') {
      this.answerData.innerHTML = `
        <div class="ans-word">${this._esc(word.hanzi)}</div>
        <div class="ans-pinyin">${this._esc(word.pinyin)}</div>
        <div class="ans-meaning">${this._esc(word.meaning)}</div>
      `;
    } else { // japanese
      this.answerData.innerHTML = `
        <div class="ans-word">${this._esc(word.kanji)}</div>
        <div class="ans-pinyin">${this._esc(word.hiragana)}　/　${this._esc(word.katakana)}</div>
        <div class="ans-meaning">${this._esc(word.meaning)}</div>
      `;
    }

    // Show user's answer (or placeholder)
    if (userAnswer) {
      this.userAnswerDisplay.textContent = userAnswer;
      this.userAnswerDisplay.classList.remove('empty');
    } else {
      this.userAnswerDisplay.textContent = '(입력 없음)';
      this.userAnswerDisplay.classList.add('empty');
    }

    // Flip animation
    this.cardInner.classList.add('flipped');

    // Swap input area → action area
    this.answerInputArea.style.display = 'none';
    setTimeout(() => {
      this.actionArea.style.display = 'flex';
      this.btnNext.focus();
    }, 380);
  }

  /* ── Add current word to wrong notes ── */
  _addToNotes() {
    if (this.currentNoteAdded) return;
    this.currentNoteAdded = true;

    const word = this.queue[this.currentIndex];
    this.wrongNotes.push(word);
    this.wrongCount.textContent = this.wrongNotes.length;

    this.btnWrongNote.textContent = '✅ 추가됨';
    this.btnWrongNote.classList.add('added');
    this.btnWrongNote.disabled = true;
  }

  /* ── Advance to next card ── */
  _next() {
    this.tts.cancel();
    this.currentIndex++;
    this._showCard();
  }

  /* ── HTML-escape helper ── */
  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Clean up all event listeners ── */
  destroy() {
    this._ac.abort();
    this.tts.cancel();
  }
}
