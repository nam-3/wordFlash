/* ============================================================
   spreadsheet.js — In-browser editable grid component
   ============================================================ */

class Spreadsheet {
  constructor(options = {}) {
    this.onDataChange = options.onDataChange || (() => { });
    this.minRows = 8;
    this.mode = 'english';  // 'english' | 'chinese' | 'japanese'

    this.wrapperEl = document.getElementById('sheet-wrapper');
    this.theadEl = document.getElementById('sheet-thead');
    this.tbodyEl = document.getElementById('sheet-tbody');

    this._renderHeader();
    this._renderRows(this.minRows);
    this._bindEvents();
  }

  /* ── Column definitions by mode ── */
  get _cols() {
    if (this.mode === 'english') {
      return [
        { label: '단어 / Word', placeholder: '예) apple' },
        { label: '뜻 / Meaning', placeholder: '예) 사과' }
      ];
    }
    if (this.mode === 'chinese') {
      return [
        { label: '한자', placeholder: '예) 苹果' },
        { label: '병음 / Pinyin', placeholder: '예) píngguǒ' },
        { label: '뜻 / Meaning', placeholder: '예) 사과' }
      ];
    }
    // japanese
    return [
      { label: '한자 / 단어', placeholder: '예) 桜' },
      { label: '히라가나', placeholder: '예) さくら' },
      { label: '가타카나', placeholder: '예) サクラ' },
      { label: '뜻 / Meaning', placeholder: '예) 벚꽃' }
    ];
  }

  /* ── Render table header ── */
  _renderHeader() {
    this.theadEl.innerHTML = '';
    const tr = document.createElement('tr');

    // Row-number column
    const numTh = document.createElement('th');
    numTh.className = 'col-num';
    numTh.textContent = '#';
    tr.appendChild(numTh);

    this._cols.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      tr.appendChild(th);
    });
    this.theadEl.appendChild(tr);
  }

  /* ── Render N empty rows ── */
  _renderRows(count) {
    this.tbodyEl.innerHTML = '';
    for (let i = 0; i < count; i++) this._appendRow(i + 1, []);
  }

  /* ── Append single row (with optional pre-filled data) ── */
  _appendRow(rowNum, data = []) {
    const tr = document.createElement('tr');
    tr.dataset.row = rowNum;

    // Row number cell (read-only)
    const numTd = document.createElement('td');
    numTd.className = 'col-num';
    const numCell = document.createElement('div');
    numCell.className = 'cell';
    numCell.textContent = rowNum;
    numTd.appendChild(numCell);
    tr.appendChild(numTd);

    // Data cells
    this._cols.forEach((col, ci) => {
      const td = document.createElement('td');

      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.contentEditable = 'true';
      cell.dataset.placeholder = col.placeholder;
      cell.dataset.col = ci;
      if (data[ci] !== undefined && data[ci] !== '') {
        cell.textContent = data[ci];
      }
      td.appendChild(cell);

      // Delete-row button on last column
      if (ci === this._cols.length - 1) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-del-row';
        delBtn.innerHTML = '✕';
        delBtn.title = '행 삭제';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          tr.remove();
          // Pad back up to minRows with empty rows if needed
          const remaining = this.tbodyEl.querySelectorAll('tr').length;
          for (let i = remaining; i < this.minRows; i++) {
            this._appendRow(i + 1, []);
          }
          this._renumber();
          this.onDataChange(this.getData());
        });
        td.appendChild(delBtn);
      }

      tr.appendChild(td);
    });

    this.tbodyEl.appendChild(tr);
  }

  /* ── Re-number row indicators ── */
  _renumber() {
    Array.from(this.tbodyEl.querySelectorAll('tr')).forEach((row, i) => {
      const numDiv = row.querySelector('.col-num .cell');
      if (numDiv) numDiv.textContent = i + 1;
    });
  }

  /* ── Event binding ── */
  _bindEvents() {
    /* Paste: intercept clipboard text and fill cells */
    this.wrapperEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;

      const rows = Parser.parseClipboardText(text);
      if (!rows.length) return;

      // Find start position (focused cell or 0,0)
      let startRow = 0;
      let startCol = 0;
      const focused = document.activeElement;
      if (focused && focused.classList.contains('cell') && focused.contentEditable === 'true') {
        const allTrs = Array.from(this.tbodyEl.querySelectorAll('tr'));
        const focusTr = focused.closest('tr');
        const dataCells = Array.from(focusTr.querySelectorAll('.cell[contenteditable]'));
        startRow = allTrs.indexOf(focusTr);
        startCol = parseInt(focused.dataset.col) || 0;
        if (startRow < 0) startRow = 0;
      }

      // Ensure enough rows exist
      const needed = startRow + rows.length;
      while (this.tbodyEl.querySelectorAll('tr').length < needed) {
        const n = this.tbodyEl.querySelectorAll('tr').length;
        this._appendRow(n + 1, []);
      }

      // Fill data
      const allTrs = Array.from(this.tbodyEl.querySelectorAll('tr'));
      rows.forEach((rowData, ri) => {
        const tr = allTrs[startRow + ri];
        if (!tr) return;
        const cells = Array.from(tr.querySelectorAll('.cell[contenteditable]'));
        rowData.forEach((val, ci) => {
          const cell = cells[startCol + ci];
          if (cell) cell.textContent = val;
        });
      });

      this.onDataChange(this.getData());
    });

    /* Input: update on every keystroke */
    this.wrapperEl.addEventListener('input', () => {
      this.onDataChange(this.getData());
    });

    /* Keyboard: Tab / Enter navigation */
    this.wrapperEl.addEventListener('keydown', (e) => {
      const editCells = () =>
        Array.from(this.wrapperEl.querySelectorAll('.cell[contenteditable]'));

      if (e.key === 'Tab') {
        e.preventDefault();
        const cells = editCells();
        const idx = cells.indexOf(document.activeElement);
        if (idx < 0) return;
        const next = e.shiftKey ? cells[idx - 1] : cells[idx + 1];
        if (next) {
          next.focus();
        } else if (!e.shiftKey) {
          // Add row and focus its first cell
          this.addRow();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cells = editCells();
        const idx = cells.indexOf(document.activeElement);
        if (idx < 0) return;
        const colLen = this._cols.length;
        const colIdx = idx % colLen;
        const nextIdx = idx - colIdx + colLen; // first cell of next row
        if (nextIdx < cells.length) {
          cells[nextIdx].focus();
        } else {
          this.addRow();
        }
      }
    });
  }

  /* ============================================================
     Public API
  ============================================================ */

  /** Get all non-empty row data as string[][] */
  getData() {
    const result = [];
    this.tbodyEl.querySelectorAll('tr').forEach(tr => {
      const cells = tr.querySelectorAll('.cell[contenteditable]');
      const rowData = Array.from(cells).map(c => c.textContent.trim());
      if (rowData.some(c => c.length > 0)) result.push(rowData);
    });
    return result;
  }

  /** Fill grid with rows of data */
  setData(rows) {
    const count = Math.max(rows.length, this.minRows);
    this._renderRows(count);
    const allTrs = Array.from(this.tbodyEl.querySelectorAll('tr'));
    rows.forEach((rowData, ri) => {
      const tr = allTrs[ri];
      if (!tr) return;
      const cells = tr.querySelectorAll('.cell[contenteditable]');
      rowData.forEach((val, ci) => {
        if (cells[ci]) cells[ci].textContent = val;
      });
    });
  }

  /** Switch mode (english ↔ chinese) and re-render header */
  setMode(newMode) {
    if (this.mode === newMode) return;
    const oldData = this.getData();
    this.mode = newMode;
    this._renderHeader();
    // Keep existing rows but re-render so new placeholder appears
    const rowCount = Math.max(this.tbodyEl.querySelectorAll('tr').length, this.minRows);
    this._renderRows(rowCount);
    this.setData(oldData);
  }

  /** Add one blank row and focus it */
  addRow() {
    const count = this.tbodyEl.querySelectorAll('tr').length;
    this._appendRow(count + 1, []);
    const allCells = this.wrapperEl.querySelectorAll('.cell[contenteditable]');
    const lastRowStart = allCells[allCells.length - this._cols.length];
    if (lastRowStart) lastRowStart.focus();
  }

  /** Clear all rows back to minimum */
  clear() {
    this._renderRows(this.minRows);
    this.onDataChange([]);
  }
}
