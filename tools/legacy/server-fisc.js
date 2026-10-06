// FISC journal — DMI PDF parser and ecritures generator

function parseDMIItems(pdfItems) {
  const result = {
    mois: null, annee: null,
    retenue_salaires: 0, css: 0, retenue_loyers: 0, retenue_marches: 0,
    tfp_du: 0, foprolos_du: 0,
    tva_collectee: 0, tva_deductible: 0, tva_report_precedent: 0,
    tva_resultat: 0, tva_signe: null,
    timbre_fiscal: 0, tcl_du: 0, total_general: 0,
  };

  const byPage = {};
  for (const item of pdfItems) {
    if (!byPage[item.page]) byPage[item.page] = [];
    byPage[item.page].push(item);
  }

  function getDecimalsWithY(page) {
    const seen = new Set();
    const items = [];
    for (const item of (byPage[page] || [])) {
      const raw = item.str.trim();
      if (!raw) continue;
      const hasArabicDecimal = raw.includes('٫');
      const hasDot = raw.includes('.');
      if (!hasDot && !hasArabicDecimal) continue;
      const s = raw.replace(/٬/g, '').replace(/٫/g, '.');
      const cleaned = s.replace(/ /g, '');
      const val = parseFloat(cleaned);
      if (!isNaN(val) && val > 0 && !seen.has(val)) { seen.add(val); items.push({ val, y: item.y }); }
    }
    items.sort((a, b) => b.y - a.y);
    return items;
  }

  function getDecimals(page) {
    return getDecimalsWithY(page).map(i => i.val);
  }

  function getDecimalsWithYAndX(page) {
    const seen = new Set();
    const items = [];
    for (const item of (byPage[page] || [])) {
      const raw = item.str.trim();
      if (!raw) continue;
      const hasArabicDecimal = raw.includes('٫');
      const hasDot = raw.includes('.');
      if (!hasDot && !hasArabicDecimal) continue;
      const s = raw.replace(/٬/g, '').replace(/٫/g, '.');
      const cleaned = s.replace(/ /g, '');
      const val = parseFloat(cleaned);
      if (!isNaN(val) && val > 0 && !seen.has(val)) {
        seen.add(val);
        items.push({ val, y: item.y, x: item.x });
      }
    }
    items.sort((a, b) => b.y - a.y);
    return items;
  }

  // Month/Year
  for (const item of byPage[1] || []) {
    const m1 = item.str.match(/mois\s+0(\d)-20(\d{2})/);
    if (m1) { result.mois = '0' + m1[1]; result.annee = '20' + m1[2]; break; }
    const m2 = item.str.match(/annee=(\d{4}).*moiss=(\d{2})/);
    if (m2 && !result.annee) { result.annee = m2[1]; result.mois = m2[2]; }
  }

  // Page 1: retenue_salaires (432100), css (432101), optionally retenue_loyers (432300), retenue_marches (432400)
  // Use range 500-2000 for salaires to exclude summary totals (e.g. 4970)
  const p1 = getDecimalsWithY(1);
  const salCand = p1.filter(i => i.val >= 500 && i.val <= 2000);
  if (salCand.length > 0) result.retenue_salaires = salCand[0].val;
  const cssCand = p1.filter(i => i.val >= 10 && i.val <= 100 && i.val !== result.retenue_salaires);
  if (cssCand.length > 0) result.css = cssCand[0].val;

  // retenue_loyers: value on page 1 that is NOT retenue_salaires, NOT css, in range 50-2000
  const retCand = p1.filter(i => i.val >= 50 && i.val <= 2000 && i.val !== result.retenue_salaires && i.val !== result.css);
  if (retCand.length > 0) result.retenue_loyers = retCand[0].val;

  // Page 10: Timbre — extract FIRST (needed to exclude from page 12)
  const p10 = getDecimals(10);
  const timbreCand = p10.filter(n => n >= 40 && n <= 200);
  if (timbreCand.length > 0) result.timbre_fiscal = timbreCand[0];

  // Page 5: TVA collectée — use DETAIL row (lower Y position), not the largest value
  // Page 5 has two rows: top row = summary, bottom row = detail with actual TVA collectée
  const p5items = getDecimalsWithY(5);
  if (p5items.length > 0) {
    // Group by Y position (rounded to nearest 5 to handle slight variations)
    const yGroups = {};
    for (const item of p5items) {
      const yKey = Math.round(item.y / 5) * 5;
      if (!yGroups[yKey]) yGroups[yKey] = [];
      yGroups[yKey].push(item.val);
    }
    const sortedYKeys = Object.keys(yGroups).map(Number).sort((a, b) => a - b);
    // Use the FIRST group (lowest Y = bottom of page = detail row with actual values)
    // In PDF coordinates, Y increases upward, so lowest Y = furthest down the page
    const detailGroup = yGroups[sortedYKeys[0]];
    if (detailGroup && detailGroup.length > 0) {
      result.tva_collectee = Math.max(...detailGroup);
    }
  }
  // tva_deductible is CALCULATED from balance equation in generateFISCecritures

  // Page 6: TVA result — sort by Y position (highest Y = subtotal, then report, then result)
  const p6items = (byPage[6] || []).filter(item => {
    const raw = item.str.trim();
    const hasArabicDecimal = raw.includes('٫');
    const hasDot = raw.includes('.');
    if (!hasDot && !hasArabicDecimal) return false;
    const s = raw.replace(/٬/g, '').replace(/٫/g, '.');
    const cleaned = s.replace(/ /g, '');
    const val = parseFloat(cleaned);
    return !isNaN(val) && val > 5 && val < 100000;
  }).map(item => {
    const s = item.str.trim().replace(/٬/g, '').replace(/٫/g, '.').replace(/ /g, '');
    return { val: parseFloat(s), y: item.y };
  });
  p6items.sort((a, b) => b.y - a.y);
  if (p6items.length >= 3) {
    result.tva_report_precedent = p6items[1].val;
    result.tva_resultat = p6items[2].val;
    const subtotal = p6items[0].val;
    result.tva_signe = subtotal < result.tva_report_precedent ? 'ف' : 'ب';
  } else if (p6items.length === 2) {
    result.tva_report_precedent = p6items[0].val;
    result.tva_resultat = p6items[1].val;
    result.tva_signe = 'ب';
  } else if (p6items.length === 1) {
    result.tva_resultat = p6items[0].val;
    result.tva_signe = 'ب';
  }

  // Page 12: TCL + TFP + FOPROLOS — exclude timbre_fiscal value (already extracted from page 10)
  // Page 12 has summary rows with multiple columns; values repeat per row.
  // Filter: 50-500, exclude timbre_fiscal, then pick top 3 unique values by Y position
  const p12items = getDecimalsWithY(12);
  const p12vals = p12items.map(i => i.val).filter(n =>
    n >= 50 && n <= 500 && n !== result.timbre_fiscal && n !== result.tcl_du
  );
  // Take unique values only
  const p12unique = [...new Set(p12vals)];
  if (p12unique.length >= 3) {
    result.tcl_du = p12unique[0];
    result.tfp_du = p12unique[1];
    result.foprolos_du = p12unique[2];
  } else if (p12unique.length === 2) {
    result.tcl_du = p12unique[0];
    result.tfp_du = p12unique[1];
  } else if (p12unique.length === 1) {
    result.tcl_du = p12unique[0];
  }

  // Page 13: Total general
  const p13 = getDecimals(13);
  const totalCand = p13.filter(n => n >= 1000 && n <= 100000);
  if (totalCand.length > 0) result.total_general = totalCand[totalCand.length - 1];

  return result;
}

function generateFISCecritures(dmi, dossierId, societeId) {
  const journal = 'FISC';
  const datePiece = `${dmi.annee}-${dmi.mois}-21`;
  const libelle = `DMI ${dmi.mois}-${dmi.annee.slice(-2)}`;
  const entries = [];
  let numPiece = 1;

  function addEntry(compte, sens, montant, tresorerie, libOverride) {
    if (montant === 0) return;
    const useLib = libOverride || libelle;
    entries.push({
      dossier_id: dossierId, societe_id: societeId, journal_code: journal,
      date_operation: datePiece, date_piece: datePiece,
      numero_doc: `${useLib} P${numPiece}`, libelle: useLib,
      compte, sens, montant: Math.round(montant * 1000) / 1000, tresorerie,
    });
  }

  if (!dmi.total_general || dmi.total_general === 0) {
    return { error: 'Montant total general non trouve', entries: [] };
  }

  // Piece A: constatation globale
  addEntry('457100', 'D', dmi.total_general, `CTS ${libelle}`);
  if (dmi.retenue_salaires > 0) addEntry('432100', 'C', dmi.retenue_salaires, `CTS ${libelle}`);
  if (dmi.css > 0) addEntry('432101', 'C', dmi.css, `CTS ${libelle}`);
  if (dmi.retenue_loyers > 0) addEntry('432300', 'C', dmi.retenue_loyers, `CTS ${libelle}`);
  if (dmi.retenue_marches > 0) addEntry('432400', 'C', dmi.retenue_marches, `CTS ${libelle}`);
  if (dmi.tfp_du > 0) addEntry('437300', 'C', dmi.tfp_du, `CTS ${libelle}`);
  if (dmi.foprolos_du > 0) addEntry('437200', 'C', dmi.foprolos_du, `CTS ${libelle}`);
  if (dmi.timbre_fiscal > 0) addEntry('437500', 'C', dmi.timbre_fiscal, `CTS ${libelle}`);
  if (dmi.tcl_du > 0) addEntry('437400', 'C', dmi.tcl_du, `CTS ${libelle}`);

  // TVA in piece A = balancing figure (total_general - sum of other credits)
  const sumC = entries.filter(e => e.numero_doc === `${libelle} P1` && e.sens === 'C')
    .reduce((s, e) => s + e.montant, 0);
  const tvaA = Math.round((dmi.total_general - sumC) * 1000) / 1000;
  if (tvaA > 0) {
    addEntry('436510', 'C', tvaA, `CTS ${libelle}`);
  } else if (tvaA < 0) {
    addEntry('436670', 'D', Math.abs(tvaA), `CTS ${libelle}`);
  }

  // Verify Piece A balance
  const pieceA = entries.filter(e => e.numero_doc === `${libelle} P1`);
  const totalDA = pieceA.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
  const totalCA = pieceA.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
  if (Math.abs(totalDA - totalCA) > 0.01) {
    return { error: `Piece A desequilibree: D=${totalDA.toFixed(3)} C=${totalCA.toFixed(3)} diff=${(totalDA - totalCA).toFixed(3)}`, entries: [], dmi };
  }
  numPiece++;

  const shortDate = `${dmi.mois}-${dmi.annee.slice(-2)}`;

  // Piece B: TFP (661100→437300)
  if (dmi.tfp_du > 0) {
    addEntry('661100', 'D', dmi.tfp_du, `CTS TFP ${shortDate}`);
    addEntry('437300', 'C', dmi.tfp_du, `CTS TFP ${shortDate}`);
    numPiece++;
  }

  // Piece C: FOPROLOS (661200→437200)
  if (dmi.foprolos_du > 0) {
    addEntry('661200', 'D', dmi.foprolos_du, `CTS FOPROLOSS ${shortDate}`);
    addEntry('437200', 'C', dmi.foprolos_du, `CTS FOPROLOSS ${shortDate}`);
    numPiece++;
  }

  // Piece D: TCL (661300→437400)
  if (dmi.tcl_du > 0) {
    addEntry('661300', 'D', dmi.tcl_du, `CTS TCL ${shortDate}`);
    addEntry('437400', 'C', dmi.tcl_du, `CTS TCL ${shortDate}`);
    numPiece++;
  }

  // Piece E: RECLASS TVA (4 lines)
  // TVA déductible is calculated from balance equation, NOT extracted from PDF
  // ف (credit): D(collectée+resultat) = C(déductible+report) → déductible = collectée + résultat - report
  // ب (due): D(collectée) = C(déductible+report+résultat) → déductible = collectée - report - résultat
  let tvaDedCalc = 0;
  if (dmi.tva_signe === 'ف') {
    tvaDedCalc = dmi.tva_collectee + dmi.tva_resultat - dmi.tva_report_precedent;
  } else if (dmi.tva_signe === 'ب') {
    tvaDedCalc = dmi.tva_collectee - dmi.tva_report_precedent - dmi.tva_resultat;
  } else if (dmi.tva_collectee > 0 && dmi.tva_report_precedent > 0) {
    tvaDedCalc = dmi.tva_collectee - dmi.tva_report_precedent;
  }
  tvaDedCalc = Math.round(tvaDedCalc * 1000) / 1000;

  const pieceDEntries = [];
  if (dmi.tva_collectee > 0) pieceDEntries.push({ compte: '436710', sens: 'D', montant: dmi.tva_collectee });
  if (tvaDedCalc > 0) pieceDEntries.push({ compte: '436660', sens: 'C', montant: tvaDedCalc });
  if (dmi.tva_report_precedent > 0) pieceDEntries.push({ compte: '436670', sens: 'C', montant: dmi.tva_report_precedent });
  if (dmi.tva_signe === 'ب' && dmi.tva_resultat > 0) {
    pieceDEntries.push({ compte: '436510', sens: 'C', montant: dmi.tva_resultat });
  } else if (dmi.tva_signe === 'ف' && dmi.tva_resultat > 0) {
    pieceDEntries.push({ compte: '436670', sens: 'D', montant: dmi.tva_resultat });
  }

  if (pieceDEntries.length > 0) {
    const totalDE = pieceDEntries.filter(e => e.sens === 'D').reduce((s, e) => s + e.montant, 0);
    const totalCE = pieceDEntries.filter(e => e.sens === 'C').reduce((s, e) => s + e.montant, 0);
    if (Math.abs(totalDE - totalCE) < 0.01) {
      for (const e of pieceDEntries) addEntry(e.compte, e.sens, e.montant, 'RECLASS TVA', 'RECLASS TVA');
      numPiece++;
    }
  }

  return { entries, dmi };
}

module.exports = { parseDMIItems, generateFISCecritures };
