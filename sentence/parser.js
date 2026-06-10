/* ============================================================
   parser.js — Data parsing utilities (clipboard, XLSX, CSV)
   ============================================================ */

const Parser = {

  /* ----------------------------------------------------------
     Parse tab-separated clipboard text (Excel copy-paste)
  ---------------------------------------------------------- */
  parseClipboardText(text) {
    if (!text) return [];
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim()
      .split('\n')
      .map(line => line.split('\t').map(c => c.trim()))
      .filter(row => row.some(c => c.length > 0));
  },

  /* ----------------------------------------------------------
     Parse XLSX / XLS ArrayBuffer via SheetJS
  ---------------------------------------------------------- */
  parseXLSX(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return rows
      .map(row => row.map(cell => String(cell).trim()))
      .filter(row => row.some(c => c.length > 0));
  },

  /* ----------------------------------------------------------
     Parse CSV text
  ---------------------------------------------------------- */
  parseCSV(text) {
    if (!text) return [];
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim()
      .split('\n')
      .map(line => {
        // Handle quoted CSV fields
        const cells = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
          else { cur += ch; }
        }
        cells.push(cur.trim());
        return cells;
      })
      .filter(row => row.some(c => c.length > 0));
  },

  /* ----------------------------------------------------------
     Auto-detect mode from row data
     2 effective columns → 'english'
     3 effective columns → 'chinese'
     4+ effective columns → 'japanese'
  ---------------------------------------------------------- */
  detectMode(rows) {
    if (!rows || !rows.length) return 'english';
    const maxCols = Math.max(...rows.map(r =>
      r.filter(c => c && String(c).trim().length > 0).length
    ));
    if (maxCols >= 4) return 'japanese';
    if (maxCols >= 3) return 'chinese';
    return 'english';
  },

  /* ----------------------------------------------------------
     Convert raw rows → word objects
  ---------------------------------------------------------- */
  rowsToWords(rows, mode) {
    return rows
      .map(row => {
        if (mode === 'english') {
          return {
            word:    (row[0] || '').trim(),
            meaning: (row[1] || '').trim()
          };
        } else if (mode === 'chinese') {
          return {
            hanzi:   (row[0] || '').trim(),
            pinyin:  (row[1] || '').trim(),
            meaning: (row[2] || '').trim()
          };
        } else { // japanese
          return {
            kanji:    (row[0] || '').trim(),
            hiragana: (row[1] || '').trim(),
            katakana: (row[2] || '').trim(),
            meaning:  (row[3] || '').trim()
          };
        }
      })
      .filter(w => {
        if (mode === 'english')  return w.word    || w.meaning;
        if (mode === 'chinese')  return w.hanzi   || w.meaning;
        return w.kanji || w.meaning; // japanese
      });
  },

  /* ----------------------------------------------------------
     Convert word objects → raw rows (for Excel export)
  ---------------------------------------------------------- */
  wordsToRows(words, mode) {
    if (mode === 'english')  return words.map(w => [w.word,  w.meaning]);
    if (mode === 'chinese')  return words.map(w => [w.hanzi, w.pinyin, w.meaning]);
    return words.map(w => [w.kanji, w.hiragana, w.katakana, w.meaning]); // japanese
  },

  /* ----------------------------------------------------------
     Download wrong notes as .xlsx file
  ---------------------------------------------------------- */
  downloadWrongNotes(words, mode) {
    if (!words || words.length === 0) return;
    const rows = this.wordsToRows(words, mode);
    const ws   = XLSX.utils.aoa_to_sheet(rows);
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '오답노트');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    XLSX.writeFile(wb, `오답노트_${today}.xlsx`);
  }
};
