/* ============================================================
   app.js — Main application controller & state manager
   ============================================================ */

const App = {

  /* ── Application state ── */
  state: {
    words:      [],          // Parsed word objects
    mode:       'english',   // 'english' | 'chinese'
    wrongNotes: [],          // Words added to wrong-note list
    settings: {
      ttsEnabled:  true,
      ttsRate:     1.0,
      cardCount:   'all',    // 'all' | 'custom'
      customCount: 20
    }
  },

  spreadsheet:   null,   // Spreadsheet instance
  flashcardTest: null,   // FlashcardTest instance
  activeTab:     'sheet', // 'sheet' | 'upload'
  uploadedRows:  null,   // Raw rows from file upload

  /* ==========================================================
     INIT
  ========================================================== */
  init() {
    this.spreadsheet = new Spreadsheet({
      onDataChange: (rows) => this._onSheetChange(rows)
    });

    this._bindInputEvents();
    this._bindSettingsEvents();
    this._bindTestEvents();
    this._bindResultsEvents();
  },

  /* ==========================================================
     VIEW ROUTING
  ========================================================== */
  _showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(`view-${id}`);
    if (el) el.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'auto' });
  },

  /* ==========================================================
     INPUT VIEW
  ========================================================== */
  _bindInputEvents() {
    /* Tab switching */
    document.getElementById('tab-sheet').addEventListener('click', () => this._setTab('sheet'));
    document.getElementById('tab-upload').addEventListener('click', () => this._setTab('upload'));

    /* Mode toggle buttons (manual) */
    document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode;
        if (this.state.mode === newMode) return;
        this.state.mode = newMode;
        this._applyModeBtn(newMode);
        this.spreadsheet.setMode(newMode);
        // Re-evaluate word count with new mode
        this._updateWordCount(this.spreadsheet.getData());
      });
    });

    /* Sheet actions */
    document.getElementById('btn-add-row').addEventListener('click', () => {
      this.spreadsheet.addRow();
    });
    document.getElementById('btn-clear-sheet').addEventListener('click', () => {
      this.spreadsheet.clear();
      this._updateWordCount([]);
    });

    /* File upload */
    const uploadZone = document.getElementById('upload-zone');
    const fileInput  = document.getElementById('file-input');

    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) this._handleFile(file);
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this._handleFile(file);
      fileInput.value = ''; // allow re-selecting same file
    });
    document.getElementById('btn-remove-file').addEventListener('click', () => {
      this.uploadedRows = null;
      document.getElementById('upload-preview').style.display = 'none';
      document.getElementById('upload-zone').style.display    = 'flex';
      this._updateWordCount([]);
    });

    /* Start button */
    document.getElementById('btn-start').addEventListener('click', () => {
      this._goToSettings();
    });
  },

  _setTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById(`panel-${tab}`).classList.add('active');
  },

  _onSheetChange(rows) {
    // Do NOT auto-switch mode — user controls mode manually via buttons
    this._updateWordCount(rows);
  },

  /* Highlight the active mode button */
  _applyModeBtn(mode) {
    document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  },

  _updateWordCount(rows) {
    // Use manually selected mode (not auto-detect)
    const words = Parser.rowsToWords(rows, this.state.mode);
    const n     = words.length;
    const label = document.getElementById('word-count-label');
    const btn   = document.getElementById('btn-start');
    label.textContent = n > 0 ? `${n}개 단어 감지됨` : '';
    btn.disabled      = n === 0;
  },

  async _handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      let rows = [];
      if (ext === 'csv') {
        rows = Parser.parseCSV(await file.text());
      } else {
        rows = Parser.parseXLSX(await file.arrayBuffer());
      }

      if (!rows.length) { alert('파일에서 데이터를 읽을 수 없습니다.'); return; }

      this.uploadedRows = rows;
      // Auto-detect mode from file and sync toggle buttons
      const detectedMode = Parser.detectMode(rows);
      this.state.mode    = detectedMode;
      this._applyModeBtn(detectedMode);

      // Update upload UI
      document.getElementById('upload-zone').style.display    = 'none';
      document.getElementById('upload-preview').style.display = 'block';
      document.getElementById('preview-name').textContent     = file.name;
      const modeLabel = { english: '영어', chinese: '중국어', japanese: '일본어' };
      document.getElementById('preview-count').textContent    =
        `${rows.length}행 · ${modeLabel[detectedMode] || detectedMode} 모드`;

      this._updateWordCount(rows);
    } catch (err) {
      console.error(err);
      alert('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
    }
  },

  _getCurrentRows() {
    return (this.activeTab === 'upload' && this.uploadedRows)
      ? this.uploadedRows
      : this.spreadsheet.getData();
  },

  _goToSettings() {
    const rows  = this._getCurrentRows();
    // Use the manually selected mode (state.mode), not auto-detect
    const mode  = this.state.mode;
    const words = Parser.rowsToWords(rows, mode);

    if (!words.length) { alert('단어를 먼저 입력하세요.'); return; }

    this.state.words = words;

    document.getElementById('total-words-count').textContent = words.length;
    const countInput = document.getElementById('custom-count');
    countInput.max   = words.length;
    countInput.value = Math.min(this.state.settings.customCount, words.length);

    this._showView('settings');
  },

  /* ==========================================================
     SETTINGS VIEW
  ========================================================== */
  _bindSettingsEvents() {
    document.getElementById('btn-back-settings').addEventListener('click', () => {
      this._showView('input');
    });

    /* TTS toggle */
    const ttsChk = document.getElementById('tts-enabled');
    ttsChk.addEventListener('change', () => {
      this.state.settings.ttsEnabled = ttsChk.checked;
      document.getElementById('tts-speed-row').style.opacity = ttsChk.checked ? '1' : '.45';
    });

    /* Speed buttons */
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.settings.ttsRate = parseFloat(btn.dataset.rate);
      });
    });

    /* Card count */
    document.querySelectorAll('input[name="card-count"]').forEach(radio => {
      radio.addEventListener('change', () => {
        this.state.settings.cardCount = radio.value;
        const inp = document.getElementById('custom-count');
        inp.style.display = radio.value === 'custom' ? 'block' : 'none';
      });
    });
    document.getElementById('custom-count').addEventListener('input', (e) => {
      this.state.settings.customCount = Math.max(1, parseInt(e.target.value) || 20);
    });

    document.getElementById('btn-go-test').addEventListener('click', () => {
      this._startTest();
    });
  },

  /* ==========================================================
     TEST VIEW
  ========================================================== */
  _bindTestEvents() {
    document.getElementById('btn-back-test').addEventListener('click', () => {
      // 중단 시 결과 화면으로 이동 (오답노트 저장 가능)
      if (this.flashcardTest) {
        this.state.wrongNotes = this.flashcardTest.wrongNotes;
        this.flashcardTest.tts.cancel();
      }
      // Mark title as interrupted
      document.getElementById('results-title').textContent = '테스트 중단 🛑';
      this._showResults();
    });
  },

  _startTest() {
    // Destroy any previous session cleanly
    if (this.flashcardTest) { this.flashcardTest.destroy(); this.flashcardTest = null; }

    this.state.wrongNotes = [];
    this._showView('test');

    this.flashcardTest = new FlashcardTest(
      this.state.words,
      this.state.mode,
      { ...this.state.settings },
      {
        onComplete: (wrongNotes) => {
          this.state.wrongNotes = wrongNotes;
          // 정상 완료 — 제목 복구
          document.getElementById('results-title').textContent = '테스트 완료! 🎉';
          this._showResults(true);
        }
      }
    );
  },

  /* ==========================================================
     RESULTS VIEW
  ========================================================== */
  _showResults(completed = false) {
    this._showView('results');

    // completed=true → 전체 큐, false(중단) → 지금까지 진행한 카드 수
    const total = this.flashcardTest
      ? (completed ? this.flashcardTest.queue.length : this.flashcardTest.currentIndex)
      : 0;
    const wrong = this.state.wrongNotes.length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-wrong').textContent = wrong;

    this._renderWrongNotes();

    const dlBtn = document.getElementById('btn-download');
    dlBtn.disabled = wrong === 0;
  },

  _renderWrongNotes() {
    const notes  = this.state.wrongNotes;
    const mode   = this.state.mode;
    const table  = document.getElementById('wrong-notes-table');
    const thead  = document.getElementById('wrong-notes-thead');
    const tbody  = document.getElementById('wrong-notes-tbody');
    const noNote = document.getElementById('no-wrong-notes');

    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (notes.length === 0) {
      table.style.display  = 'none';
      noNote.style.display = 'block';
      return;
    }

    noNote.style.display = 'none';
    table.style.display  = 'table';

    // Header
    const htr = document.createElement('tr');
    const cols =
      mode === 'english'  ? ['단어', '뜻'] :
      mode === 'chinese'  ? ['한자', '병음', '뜻'] :
                            ['한자/단어', '히라가나', '가타카나', '뜻'];
    cols.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col;
      htr.appendChild(th);
    });
    thead.appendChild(htr);

    // Rows
    notes.forEach(word => {
      const tr  = document.createElement('tr');
      const vals =
        mode === 'english'  ? [word.word,  word.meaning] :
        mode === 'chinese'  ? [word.hanzi, word.pinyin,   word.meaning] :
                              [word.kanji, word.hiragana, word.katakana, word.meaning];
      vals.forEach(val => {
        const td = document.createElement('td');
        td.textContent = val;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  },

  _bindResultsEvents() {
    document.getElementById('btn-download').addEventListener('click', () => {
      Parser.downloadWrongNotes(this.state.wrongNotes, this.state.mode);
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
      this._startTest();
    });

    document.getElementById('btn-home').addEventListener('click', () => {
      if (this.flashcardTest) { this.flashcardTest.destroy(); this.flashcardTest = null; }
      this._showView('input');
    });
  }
};

/* ── Bootstrap ── */
document.addEventListener('DOMContentLoaded', () => App.init());
